/// <reference types="chrome" />
// Background service worker (MV3)
//
// Responsibilities
// - Inject content scripts on action click (no persistent content_scripts)
// - Provide privileged capabilities via messaging:
//   - Read Claude API key from chrome.storage.local
//   - Call Anthropic Token Count API (preflight refinement)
//   - Call Anthropic Messages API (summarization pipeline)

import { STORAGE_KEYS } from '../shared/constants.ts';
import { type BulletStyle, DEFAULT_BULLET_STYLE, type RuntimeSettings, DEFAULT_SETTINGS } from '../shared/types.ts';
import { SETTINGS_STORAGE_KEYS, isBulletStyle, parseBulletStyle, parseStoredSettings } from '../shared/settings.ts';
import { createAbortRegistry } from './abort_registry.ts';
import { type MessagesRequest, countTokens, runMessagesWithRetry } from './anthropic.ts';
import { MAP_CHUNK_MAX_OUTPUT_TOKENS, type SummaryMode, modeMaxOutputTokens } from '../shared/summary_modes.ts';
import {
  type CacheControlEphemeral,
  buildMapPrompt,
  buildMapSystem,
  buildReducePrompt,
  buildRepairPrompt,
  buildSinglePrompt,
  buildTokenCountPrompt
} from './prompts.ts';

// -----------------------------
// Script injection
// -----------------------------

const DISALLOWED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge://',
  'brave://',
  'opera://',
  'file://',
  'view-source:',
  'devtools://'
];

function isInjectableUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  for (const p of DISALLOWED_URL_PREFIXES) {
    if (url.startsWith(p)) return false;
  }
  return true;
}

// Injected in this order on every toolbar click, as classic scripts. Readability.js is the
// unmodified upstream file and defines a global `Readability`; content/main.js is the bundled
// content script (see scripts/build.mjs).
const CONTENT_FILES: string[] = ['third_party/readability/Readability.js', 'content/main.js'];

async function injectContentScripts(tab: chrome.tabs.Tab): Promise<void> {
  try {
    const tabId = tab?.id;
    const url = tab?.url;
    if (typeof tabId !== 'number') return;

    // Avoid injecting into restricted pages.
    if (!isInjectableUrl(url)) return;

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: CONTENT_FILES
    });
  } catch (err) {
    // Avoid logging sensitive data.
    console.error('[ArticleSummarizer] Failed to inject content scripts', err);
  }
}

chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  // injectContentScripts never rejects (it logs its own errors).
  void injectContentScripts(tab);
});

// -----------------------------
// Settings storage
// -----------------------------

const STORAGE_KEY_API_KEY = STORAGE_KEYS.CLAUDE_API_KEY;

// Cache the API key while the MV3 service worker is alive.
// Rationale:
// - Map-reduce can issue many background requests (one per chunk).
// - Reading chrome.storage.local on every request adds avoidable latency.
// - The worker may be suspended at any time; we treat the cache as best-effort
//   and refresh on demand.
let apiKeyCache: string | undefined;
let apiKeyLoaded = false;

let settingsCache: RuntimeSettings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;

async function refreshSettingsCache(): Promise<void> {
  const res = await chrome.storage.local.get([...SETTINGS_STORAGE_KEYS]);
  const { settings, migration } = parseStoredSettings(res);
  settingsCache = settings;
  settingsLoaded = true;
  if (migration) {
    try {
      await chrome.storage.local.set(migration);
    } catch {
      // Best-effort write-back; the migrated values are already in use.
    }
  }
}

async function ensureSettingsLoaded(): Promise<void> {
  if (settingsLoaded) return;
  try {
    await refreshSettingsCache();
  } catch {
    // Use the defaults for this request and read storage again on the next one
    // (do not cache a transient failure for the worker's lifetime).
  }
}

function normalizeApiKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

// Keep cache up-to-date while the service worker is alive.
chrome.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
  if (areaName !== 'local') return;

  if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY_API_KEY)) {
    apiKeyCache = normalizeApiKey(changes[STORAGE_KEY_API_KEY]?.newValue);
    apiKeyLoaded = true;
  }

  if (SETTINGS_STORAGE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(changes, k))) {
    // Fire and forget.
    ensureSettingsLoaded()
      .then(() => refreshSettingsCache())
      .catch(() => {
        // ignore
      });
  }
});

async function getApiKey(): Promise<string | undefined> {
  if (!apiKeyLoaded) {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_API_KEY]);
      apiKeyCache = normalizeApiKey(result?.[STORAGE_KEY_API_KEY]);
      apiKeyLoaded = true;
    } catch {
      // Treat as missing for this request only; read storage again on the next one.
      return undefined;
    }
  }
  return apiKeyCache;
}

// Read on demand: only GET_SETTINGS needs it, and only the overlay changes it.
async function getBulletStyle(): Promise<BulletStyle> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.BULLET_STYLE]);
    return parseBulletStyle(result?.[STORAGE_KEYS.BULLET_STYLE]);
  } catch {
    return DEFAULT_BULLET_STYLE;
  }
}

function currentCacheControl(): CacheControlEphemeral | undefined {
  if (!settingsCache.promptCachingEnabled) return undefined;
  // ttl defaults to 5m per docs, but we set it explicitly for clarity.
  return { type: 'ephemeral', ttl: settingsCache.promptCachingTtl };
}

// -----------------------------
// Abort registry (best-effort)
// -----------------------------

// IMPORTANT: multiple requests may overlap for a single runId (e.g., COUNT_TOKENS
// and a subsequent summarization request if the user proceeds quickly).
// We must abort *all* in-flight requests for that runId on ABORT_RUN.
const abortRegistry = createAbortRegistry();

// Runs `fn` with an AbortSignal that ABORT_RUN for `runId` can cancel.
async function withRunAbort<T>(runId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const id = String(runId || '');
  const controller = new AbortController();
  abortRegistry.register(id, controller);
  try {
    return await fn(controller.signal);
  } finally {
    abortRegistry.unregister(id, controller);
  }
}

// -----------------------------
// Messaging
// -----------------------------

type MsgGetSettings = { type: 'GET_SETTINGS' };
type MsgOpenOptions = { type: 'OPEN_OPTIONS' };
type MsgSetBulletStyle = { type: 'SET_BULLET_STYLE'; payload: { style: BulletStyle } };

type MsgCountTokens = {
  type: 'COUNT_TOKENS';
  payload: {
    runId: string;
    title: string;
    url: string;
    articleText: string;
    model: string;
  };
};

type MsgAbortRun = { type: 'ABORT_RUN'; payload: { runId: string } };

type MsgRunSingle = {
  type: 'RUN_SUMMARY_SINGLE';
  payload: {
    runId: string;
    title: string;
    url: string;
    language: string;
    mode: SummaryMode;
    articleText: string;
    model: string;
  };
};

type MsgRunMap = {
  type: 'RUN_SUMMARY_MAP';
  payload: {
    runId: string;
    title: string;
    url: string;
    language: string;
    chunkIndex: number;
    chunkCount: number;
    chunkText: string;
    model: string;
  };
};

type MsgRunReduce = {
  type: 'RUN_SUMMARY_REDUCE';
  payload: {
    runId: string;
    title: string;
    url: string;
    language: string;
    mode: SummaryMode;
    chunkSummaries: string[];
    model: string;
  };
};

type MsgRunRepair = {
  type: 'RUN_SUMMARY_REPAIR';
  payload: {
    runId: string;
    language: string;
    mode: SummaryMode;
    badOutput: string;
    model: string;
    title?: string;
    url?: string;
    chunkSummaries?: string[];
    fixTruncation?: boolean;
  };
};

type SummaryMsg = MsgRunSingle | MsgRunMap | MsgRunReduce | MsgRunRepair;

type AnyMsg =
  | MsgGetSettings
  | MsgOpenOptions
  | MsgSetBulletStyle
  | MsgCountTokens
  | MsgAbortRun
  | SummaryMsg
  | { type: string; payload?: any };

// A Messages API call for one summarization step (everything except the API key and abort signal).
type SummaryRequest = Omit<MessagesRequest, 'apiKey' | 'abortSignal'> & { maxRetries: number; maxTokensCap?: number };

function buildSummaryRequest(msg: AnyMsg): SummaryRequest | undefined {
  switch (msg.type) {
    case 'RUN_SUMMARY_SINGLE': {
      const p = (msg as MsgRunSingle).payload;
      return {
        model: p.model,
        maxTokens: modeMaxOutputTokens(p.mode),
        userPrompt: buildSinglePrompt({
          title: p.title,
          url: p.url,
          language: p.language,
          mode: p.mode,
          articleText: p.articleText
        }),
        timeoutMs: 75_000,
        maxRetries: 2,
        maxTokensCap: 6000
      };
    }
    case 'RUN_SUMMARY_MAP': {
      const p = (msg as MsgRunMap).payload;
      return {
        model: p.model,
        maxTokens: MAP_CHUNK_MAX_OUTPUT_TOKENS,
        system: buildMapSystem({ language: p.language }),
        userPrompt: buildMapPrompt({
          title: p.title,
          url: p.url,
          chunkIndex: p.chunkIndex,
          chunkCount: p.chunkCount,
          chunkText: p.chunkText
        }),
        timeoutMs: 75_000,
        maxRetries: 0
      };
    }
    case 'RUN_SUMMARY_REDUCE': {
      const p = (msg as MsgRunReduce).payload;
      return {
        model: p.model,
        maxTokens: modeMaxOutputTokens(p.mode),
        userPrompt: buildReducePrompt({
          title: p.title,
          url: p.url,
          language: p.language,
          mode: p.mode,
          chunkSummaries: p.chunkSummaries,
          cacheControl: currentCacheControl()
        }),
        timeoutMs: 90_000,
        maxRetries: 2,
        maxTokensCap: 6000
      };
    }
    case 'RUN_SUMMARY_REPAIR': {
      const p = (msg as MsgRunRepair).payload;
      return {
        model: p.model,
        maxTokens: modeMaxOutputTokens(p.mode),
        userPrompt: buildRepairPrompt({
          title: p.title,
          url: p.url,
          chunkSummaries: p.chunkSummaries,
          language: p.language,
          mode: p.mode,
          badOutput: p.badOutput,
          fixTruncation: p.fixTruncation,
          cacheControl: currentCacheControl()
        }),
        timeoutMs: 60_000,
        maxRetries: 2,
        maxTokensCap: 6000
      };
    }
    default:
      return undefined;
  }
}

async function handleMessage(msg: AnyMsg): Promise<unknown> {
  if (!msg || typeof msg.type !== 'string') {
    return { ok: false, code: 'bad_request', message: 'Invalid message' };
  }

  // Load cached preferences (best-effort). This avoids hitting storage on every request.
  await ensureSettingsLoaded();

  if (msg.type === 'GET_SETTINGS') {
    const key = await getApiKey();
    return { ok: true, apiKeySet: Boolean(key), settings: settingsCache, bulletStyle: await getBulletStyle() };
  }

  if (msg.type === 'SET_BULLET_STYLE') {
    const style = (msg as MsgSetBulletStyle).payload?.style;
    if (!isBulletStyle(style)) {
      return { ok: false, code: 'bad_request', message: 'Invalid bullet style' };
    }
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.BULLET_STYLE]: style });
      return { ok: true };
    } catch {
      return { ok: false, code: 'storage_failed', message: 'Failed to save the bullet style.' };
    }
  }

  if (msg.type === 'OPEN_OPTIONS') {
    try {
      if (chrome?.runtime?.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      }
    } catch {
      // ignore
    }
    return { ok: false, code: 'open_options_failed', message: 'Failed to open options page.' };
  }

  if (msg.type === 'ABORT_RUN') {
    const runId = String((msg as MsgAbortRun).payload?.runId || '');
    return { ok: true, aborted: abortRegistry.abortRun(runId) };
  }

  // All API calls require an API key.
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, code: 'api_key_missing', message: 'API key is not set.' };
  }

  if (msg.type === 'COUNT_TOKENS') {
    const p = (msg as MsgCountTokens).payload;
    const userPrompt = buildTokenCountPrompt({ title: p.title, url: p.url, articleText: p.articleText });
    const r = await withRunAbort(p.runId, (abortSignal) =>
      countTokens({ apiKey, model: p.model, userPrompt, abortSignal })
    );
    return r.ok ? { ok: true, inputTokens: r.inputTokens } : r;
  }

  const request = buildSummaryRequest(msg);
  if (request) {
    const runId = (msg as SummaryMsg).payload.runId;
    const r = await withRunAbort(runId, (abortSignal) => runMessagesWithRetry({ ...request, apiKey, abortSignal }));
    return r.ok ? { ok: true, text: r.text, usage: r.usage } : r;
  }

  return { ok: false, code: 'unknown_type', message: `Unknown message type: ${msg.type}` };
}

chrome.runtime.onMessage.addListener(
  (msg: AnyMsg, _sender: chrome.runtime.MessageSender, sendResponse: (resp: unknown) => void) => {
    void (async () => {
      try {
        sendResponse(await handleMessage(msg));
      } catch (err) {
        // Avoid leaking sensitive data.
        console.error('[ArticleSummarizer] background message handler failed', err);
        sendResponse({ ok: false, code: 'internal_error', message: 'Internal error' });
      }
    })();

    // Indicate async response.
    return true;
  }
);
