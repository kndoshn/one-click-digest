/// <reference types="chrome" />
// Background service worker (MV3)
//
// Responsibilities
// - Inject content scripts on action click (no persistent content_scripts)
// - Provide privileged capabilities via messaging:
//   - Read Claude API key from chrome.storage.local
//   - Call Anthropic Token Count API (preflight refinement)
//   - Call Anthropic Messages API (summarization pipeline)

import { STORAGE_KEYS } from '../shared/constants.js';
import { normalizeApprovalThresholds } from '../shared/approval.js';
import { createAbortRegistry } from './abort_registry.js';
import { CacheTtl, RuntimeSettings, DEFAULT_SETTINGS } from '../shared/types.js';
import { parseNumberOr } from '../shared/utils.js';

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

// NOTE: We inject multiple classic scripts in a deterministic order.
// This keeps content scripts simple and avoids bundling constraints.
const CONTENT_FILES: string[] = [
  // Third-party extraction helper (global Readability constructor)
  'third_party/readability/Readability.js',

  // App scripts
  'content/runtime.js',
  'content/i18n.js',
  'content/models.js',
  'content/state_machine.js',
  'content/chunk.js',
  'content/format.js',
  'content/extract.js',
  'content/estimate.js',
  'content/overlay.js',
  'content/controller.js',
  'content/bootstrap.js'
];

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
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

const SETTINGS_STORAGE_KEYS = [
  STORAGE_KEYS.MODEL_MAP,
  STORAGE_KEYS.MODEL_FINAL,
  STORAGE_KEYS.PROMPT_CACHING_ENABLED,
  STORAGE_KEYS.PROMPT_CACHING_TTL,
  STORAGE_KEYS.HARD_COST_LIMIT_USD,
  STORAGE_KEYS.APPROVAL_THRESHOLD_USD,
  STORAGE_KEYS.APPROVAL_THRESHOLD_CHARS,
  STORAGE_KEYS.MIN_ARTICLE_CHARS,
  STORAGE_KEYS.MAX_ARTICLE_CHARS_TO_SEND,
  STORAGE_KEYS.UI_LANGUAGE
] as const;

let settingsCache: RuntimeSettings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;

async function refreshSettingsCache(): Promise<void> {
  const res = await chrome.storage.local.get([...SETTINGS_STORAGE_KEYS]);

  const modelMap = (res?.[STORAGE_KEYS.MODEL_MAP] as string) || DEFAULT_SETTINGS.modelMap;
  const modelFinal = (res?.[STORAGE_KEYS.MODEL_FINAL] as string) || DEFAULT_SETTINGS.modelFinal;
  const promptCachingEnabled =
    typeof res?.[STORAGE_KEYS.PROMPT_CACHING_ENABLED] === 'boolean'
      ? Boolean(res?.[STORAGE_KEYS.PROMPT_CACHING_ENABLED])
      : DEFAULT_SETTINGS.promptCachingEnabled;
  const promptCachingTtl = (res?.[STORAGE_KEYS.PROMPT_CACHING_TTL] as CacheTtl) || DEFAULT_SETTINGS.promptCachingTtl;

  const rawApprovalUsd = res?.[STORAGE_KEYS.APPROVAL_THRESHOLD_USD];
  const rawApprovalChars = res?.[STORAGE_KEYS.APPROVAL_THRESHOLD_CHARS];
  const { approvalThresholdUsd, approvalThresholdChars, migratedUsd, migratedChars } = normalizeApprovalThresholds({
    rawUsd: rawApprovalUsd,
    rawChars: rawApprovalChars,
    defaultUsd: DEFAULT_SETTINGS.approvalThresholdUsd,
    defaultChars: DEFAULT_SETTINGS.approvalThresholdChars
  });
  const migrateApprovalUsd = migratedUsd;
  const migrateApprovalChars = migratedChars;

  if (migrateApprovalUsd || migrateApprovalChars) {
    await chrome.storage.local.set({
      ...(migrateApprovalUsd ? { [STORAGE_KEYS.APPROVAL_THRESHOLD_USD]: approvalThresholdUsd } : {}),
      ...(migrateApprovalChars ? { [STORAGE_KEYS.APPROVAL_THRESHOLD_CHARS]: approvalThresholdChars } : {})
    });
  }

  settingsCache = {
    modelMap,
    modelFinal,
    promptCachingEnabled,
    promptCachingTtl: promptCachingTtl === '1h' ? '1h' : '5m',
    hardCostLimitUsd: parseNumberOr(res?.[STORAGE_KEYS.HARD_COST_LIMIT_USD], DEFAULT_SETTINGS.hardCostLimitUsd),
    approvalThresholdUsd,
    approvalThresholdChars,
    minArticleChars: Math.floor(parseNumberOr(res?.[STORAGE_KEYS.MIN_ARTICLE_CHARS], DEFAULT_SETTINGS.minArticleChars)),
    maxArticleCharsToSend: Math.floor(
      parseNumberOr(res?.[STORAGE_KEYS.MAX_ARTICLE_CHARS_TO_SEND], DEFAULT_SETTINGS.maxArticleCharsToSend)
    ),
    uiLanguage: (res?.[STORAGE_KEYS.UI_LANGUAGE] as string) || DEFAULT_SETTINGS.uiLanguage
  };
  settingsLoaded = true;
}

async function ensureSettingsLoaded(): Promise<void> {
  if (settingsLoaded) return;
  try {
    await refreshSettingsCache();
  } catch {
    // Keep defaults.
    settingsLoaded = true;
  }
}

// Keep cache up-to-date while the service worker is alive.
chrome.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
  if (areaName !== 'local') return;

  // API key cache update
  if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY_API_KEY)) {
    const nv = changes[STORAGE_KEY_API_KEY]?.newValue;
    if (typeof nv === 'string' && nv.trim().length > 0) apiKeyCache = nv.trim();
    else apiKeyCache = undefined;
    apiKeyLoaded = true;
  }

  for (const k of SETTINGS_STORAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(changes, k)) {
      // Fire and forget.
      ensureSettingsLoaded()
        .then(() => refreshSettingsCache())
        .catch(() => {
          // ignore
        });
      break;
    }
  }
});

async function getApiKey(): Promise<string | undefined> {
  if (!apiKeyLoaded) {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_API_KEY]);
      const value = result?.[STORAGE_KEY_API_KEY];
      if (typeof value === 'string' && value.trim().length > 0) apiKeyCache = value.trim();
      else apiKeyCache = undefined;
    } catch {
      // ignore
      apiKeyCache = undefined;
    }
    apiKeyLoaded = true;
  }
  return apiKeyCache;
}

// -----------------------------
// Anthropic API helpers
// -----------------------------

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
// Per official examples, anthropic-version is required.
const ANTHROPIC_VERSION = '2023-06-01';
// Required for direct browser/extension requests.
const ANTHROPIC_BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';

type FetchJsonResult =
  | { ok: true; status: number; json: any }
  | { ok: false; status: number; json: any };

function safeJsonParse(text: string): any {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return { raw: text };
  }
}

function combineAbortSignals(external: AbortSignal | undefined, internal: AbortController): () => void {
  if (!external) return () => {};
  const handler = () => internal.abort();
  try {
    external.addEventListener('abort', handler, { once: true });
  } catch {
    // ignore
  }
  return () => {
    try {
      external.removeEventListener('abort', handler);
    } catch {
      // ignore
    }
  };
}

async function postJsonWithTimeout(args: {
  url: string;
  apiKey: string;
  body: any;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const remove = combineAbortSignals(args.abortSignal, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, args.timeoutMs);

  try {
    try {
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': args.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true'
        },
        body: JSON.stringify(args.body),
        signal: controller.signal
      });

      const text = await resp.text();
      const json = safeJsonParse(text);
      if (resp.ok) return { ok: true, status: resp.status, json };
      return { ok: false, status: resp.status, json };
    } catch (err: any) {
      // Normalize network/abort errors into the same {error:{type,message}} shape.
      const name = err?.name ? String(err.name) : '';
      const isAbort = name === 'AbortError';
      const type = isAbort ? (timedOut ? 'timeout' : 'aborted') : 'network_error';
      const message =
        (timedOut && 'Request timed out') ||
        (isAbort && 'Request aborted') ||
        (err?.message ? String(err.message) : 'Network error');
      return { ok: false, status: 0, json: { error: { type, message } } };
    }
  } finally {
    clearTimeout(timer);
    remove();
  }
}

type NormalizedApiError = { ok: false; code: string; message: string; status?: number };

function normalizeApiError(res: { status: number; json: any }, fallback: string): NormalizedApiError {
  const msg = res.json?.error?.message || res.json?.message || fallback;
  const type = res.json?.error?.type || res.json?.error?.error_type || 'api_error';
  return { ok: false, code: String(type), message: String(msg), status: res.status };
}

function extractTextBlocks(content: any): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

// -----------------------------
// Prompt builders
// -----------------------------

type SummaryMode = 'BULLETS_3' | 'BULLETS_5' | 'BULLETS_10' | 'TLDR_12_CONCLUSION';

const MAP_CHUNK_MAX_OUTPUT_TOKENS = 220;

type CacheControlEphemeral = { type: 'ephemeral'; ttl?: CacheTtl };

function currentCacheControl(): CacheControlEphemeral | undefined {
  if (!settingsCache.promptCachingEnabled) return undefined;
  // ttl defaults to 5m per docs, but we set it explicitly for clarity.
  return { type: 'ephemeral', ttl: settingsCache.promptCachingTtl };
}

function modeSpec(mode: SummaryMode): { maxTokens: number } {
  switch (mode) {
    case 'BULLETS_3':
      return { maxTokens: 450 };
    case 'BULLETS_5':
      return { maxTokens: 700 };
    case 'BULLETS_10':
      return { maxTokens: 1200 };
    case 'TLDR_12_CONCLUSION':
      return { maxTokens: 1600 };
  }
}

function normalizeLang(language: string): string {
  return String(language || '').trim().toLowerCase();
}

function headerLabelsFor(language: string): { summary: string; conclusion: string } {
  const lang = normalizeLang(language);
  if (lang.startsWith('ja')) return { summary: '要約', conclusion: '結論' };
  if (lang.startsWith('fr')) return { summary: 'Résumé', conclusion: 'Conclusion' };
  if (lang.startsWith('de')) return { summary: 'Zusammenfassung', conclusion: 'Fazit' };
  if (lang.startsWith('es')) return { summary: 'Resumen', conclusion: 'Conclusion' };
  if (lang.startsWith('it')) return { summary: 'Sintesi', conclusion: 'Conclusione' };
  if (lang.startsWith('pt')) return { summary: 'Resumo', conclusion: 'Conclusão' };
  if (lang.startsWith('zh')) {
    if (lang.includes('tw') || lang.includes('hk') || lang.includes('mo')) return { summary: '摘要', conclusion: '結論' };
    return { summary: '摘要', conclusion: '结论' };
  }
  if (lang.startsWith('ko')) return { summary: '요약', conclusion: '결론' };
  return { summary: 'Summary', conclusion: 'Conclusion' };
}

function formatHintFor(mode: SummaryMode, language: string): string {
  if (mode === 'BULLETS_3') return 'Return exactly 3 bullet points, each starting with "- ".';
  if (mode === 'BULLETS_5') return 'Return exactly 5 bullet points, each starting with "- ".';
  if (mode === 'BULLETS_10') return 'Return exactly 10 bullet points, each starting with "- ".';

  const labels = headerLabelsFor(language);
  return (
    'Return EXACTLY 16 lines in this order:\n' +
    `1) ${labels.summary}: <one line>\n` +
    '2) <blank line>\n' +
    '3-14) 12 bullet lines, each starting with "- "\n' +
    '15) <blank line>\n' +
    `16) ${labels.conclusion}: <one line>\n` +
    'No headings, no extra text.'
  );
}

function buildTokenCountPrompt(args: { title: string; url: string; articleText: string }): string {
  // Keep minimal for speed and to reduce unrelated prompt tokens.
  return [`Title: ${args.title}`, `URL: ${args.url}`, '', 'Article:', args.articleText].join('\n');
}

function buildSinglePrompt(args: { title: string; url: string; language: string; mode: SummaryMode; articleText: string }): string {
  const formatHint = formatHintFor(args.mode, args.language);
  return [
    `Summarize the following web article for quick understanding.`,
    `Output language: ${args.language}.`,
    `${formatHint}`,
    `Keep each bullet readable (no overly long lines).`,
    `Do not include extra commentary.`,
    '',
    `Title: ${args.title}`,
    `URL: ${args.url}`,
    '',
    `Article:`,
    args.articleText
  ].join('\n');
}

function buildMapSystem(args: { language: string }): string {
  return (
    `You are an assistant that extracts key points from article chunks.\n` +
    `Output language: ${args.language}.\n` +
    `Return 5 concise bullet points, each starting with "- ".\n` +
    `Focus on facts, claims, and important context. Avoid repetition.\n` +
    `Do not add disclaimers or meta commentary.`
  );
}

function buildMapPrompt(args: {
  title: string;
  url: string;
  chunkIndex: number;
  chunkCount: number;
  chunkText: string;
}): string {
  return [
    `Title: ${args.title}`,
    `URL: ${args.url}`,
    `Chunk: ${args.chunkIndex}/${args.chunkCount}`,
    '',
    `Chunk text:`,
    args.chunkText
  ].join('\n');
}

type TextBlock = { type: 'text'; text: string; cache_control?: CacheControlEphemeral };

function buildJoinedChunkSummaries(chunkSummaries: string[]): string {
  return chunkSummaries.map((s, i) => `Chunk ${i + 1}:\n${s}`).join('\n\n');
}

function buildReducePrefixBlocks(args: {
  title: string;
  url: string;
  language: string;
  mode: SummaryMode;
  chunkSummaries: string[];
}): TextBlock[] {
  const formatHint = formatHintFor(args.mode, args.language);
  const prefix = [
    `You are an assistant that composes a final summary from multiple chunk summaries.`,
    `Output language: ${args.language}.`,
    `${formatHint}`,
    `Keep each bullet readable (no overly long lines).`,
    `Do not invent details not present in the chunk summaries.`,
    '',
    `Title: ${args.title}`,
    `URL: ${args.url}`,
    '',
    `Chunk summaries:`
  ].join('\n');

  const joined = buildJoinedChunkSummaries(args.chunkSummaries);

  const cc = currentCacheControl();
  return cc
    ? [{ type: 'text', text: prefix }, { type: 'text', text: `\n${joined}`, cache_control: cc }]
    : [{ type: 'text', text: prefix }, { type: 'text', text: `\n${joined}` }];
}

function buildReducePrompt(args: {
  title: string;
  url: string;
  language: string;
  mode: SummaryMode;
  chunkSummaries: string[];
}): any {
  const prefixBlocks = buildReducePrefixBlocks(args);
  const suffix = [
    '',
    `Now write the final output.`,
    `Only return the summary itself (no preamble).`
  ].join('\n');
  return [...prefixBlocks, { type: 'text', text: `\n${suffix}` }];
}

function buildRepairPrompt(args: {
  language: string;
  mode: SummaryMode;
  badOutput: string;
  title?: string;
  url?: string;
  chunkSummaries?: string[];
  fixTruncation?: boolean;
}): any {
  const formatHint = formatHintFor(args.mode, args.language);
  const truncationHint = args.fixTruncation
    ? `If the output looks cut off, complete the last bullet without adding new facts. Keep the bullet count unchanged.`
    : '';

  // If we have chunk summaries, include them as a cached prefix to speed up the repair pass.
  if (args.title && args.url && args.chunkSummaries && args.chunkSummaries.length > 0) {
    const prefixBlocks = buildReducePrefixBlocks({
      title: args.title,
      url: args.url,
      language: args.language,
      mode: args.mode,
      chunkSummaries: args.chunkSummaries
    });
    const suffix = [
      '',
      `Original output:`,
      args.badOutput,
      '',
      `Reformat the output to match the required format.`,
      `${formatHint}`,
      truncationHint,
      `Only return the corrected summary.`
    ].join('\n');
    return [...prefixBlocks, { type: 'text', text: `\n${suffix}` }];
  }

  return [
    `Reformat the summary to match the required format.`,
    `Output language: ${args.language}.`,
    `${formatHint}`,
    truncationHint,
    `Only return the corrected summary.`,
    '',
    `Original output:`,
    args.badOutput
  ].join('\n');
}

// -----------------------------
// API calls
// -----------------------------

async function countTokens(args: {
  apiKey: string;
  model: string;
  userPrompt: string;
  abortSignal?: AbortSignal;
}): Promise<{ ok: true; inputTokens: number } | NormalizedApiError> {
  const body: any = {
    model: args.model,
    messages: [{ role: 'user', content: args.userPrompt }]
  };

  const res = await postJsonWithTimeout({
    url: `${ANTHROPIC_API_BASE}/v1/messages/count_tokens`,
    apiKey: args.apiKey,
    body,
    timeoutMs: 30_000,
    abortSignal: args.abortSignal
  });

  if (!res.ok) return normalizeApiError(res, 'Token count request failed.');
  const inputTokens = res.json?.input_tokens;
  if (typeof inputTokens !== 'number') {
    return { ok: false, code: 'parse_error', message: 'Token count response missing input_tokens.' };
  }
  return { ok: true, inputTokens };
}

async function runMessages(args: {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: any;
  userPrompt: any;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<
  { ok: true; text: string; usage?: { input_tokens?: number; output_tokens?: number }; stopReason?: string } | NormalizedApiError
> {
  const body: any = {
    model: args.model,
    max_tokens: args.maxTokens,
    messages: [{ role: 'user', content: args.userPrompt }]
  };
  if (args.system) body.system = args.system;

  const res = await postJsonWithTimeout({
    url: `${ANTHROPIC_API_BASE}/v1/messages`,
    apiKey: args.apiKey,
    body,
    timeoutMs: args.timeoutMs,
    abortSignal: args.abortSignal
  });

  if (!res.ok) return normalizeApiError(res, 'Messages request failed.');

  const text = extractTextBlocks(res.json?.content);
  const usage = res.json?.usage;
  const stopReason = typeof res.json?.stop_reason === 'string' ? String(res.json.stop_reason) : undefined;
  return { ok: true, text, usage, stopReason };
}

async function runMessagesWithRetry(args: {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: any;
  userPrompt: any;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  maxTokensCap?: number;
}): Promise<{ ok: true; text: string; usage?: { input_tokens?: number; output_tokens?: number } } | NormalizedApiError> {
  const maxRetries = Math.max(0, args.maxRetries ?? 2);
  const cap = Math.max(args.maxTokens, args.maxTokensCap ?? 6000);
  let maxTokens = args.maxTokens;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const r = await runMessages({ ...args, maxTokens });
    if (!r.ok) return r;
    if (r.stopReason !== 'max_tokens') return r;

    const nextTokens = Math.min(cap, Math.max(maxTokens + 1, Math.floor(maxTokens * 1.5)));
    if (nextTokens <= maxTokens) return r;
    maxTokens = nextTokens;
  }

  return await runMessages({ ...args, maxTokens });
}

// -----------------------------
// Abort registry (best-effort)
// -----------------------------

// IMPORTANT: multiple requests may overlap for a single runId (e.g., COUNT_TOKENS
// and a subsequent summarization request if the user proceeds quickly).
// We must abort *all* in-flight requests for that runId on ABORT_RUN.
const abortRegistry = createAbortRegistry();

// -----------------------------
// Messaging
// -----------------------------

type MsgGetSettings = { type: 'GET_SETTINGS' };
type MsgOpenOptions = { type: 'OPEN_OPTIONS' };

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

type AnyMsg =
  | MsgGetSettings
  | MsgOpenOptions
  | MsgCountTokens
  | MsgAbortRun
  | MsgRunSingle
  | MsgRunMap
  | MsgRunReduce
  | MsgRunRepair
  | { type: string; payload?: any };

chrome.runtime.onMessage.addListener((msg: AnyMsg, _sender: chrome.runtime.MessageSender, sendResponse: (resp: unknown) => void) => {
  (async () => {
    try {
      if (!msg || typeof msg.type !== 'string') {
        sendResponse({ ok: false, code: 'bad_request', message: 'Invalid message' });
        return;
      }

      // Load cached preferences (best-effort). This avoids hitting storage on every request.
      await ensureSettingsLoaded();

      if (msg.type === 'GET_SETTINGS') {
        const key = await getApiKey();
        sendResponse({ ok: true, apiKeySet: Boolean(key), settings: settingsCache });
        return;
      }

      if (msg.type === 'OPEN_OPTIONS') {
        try {
          if (chrome?.runtime?.openOptionsPage) {
            await chrome.runtime.openOptionsPage();
            sendResponse({ ok: true });
            return;
          }
        } catch {
          // ignore
        }
        sendResponse({ ok: false, code: 'open_options_failed', message: 'Failed to open options page.' });
        return;
      }

      if (msg.type === 'ABORT_RUN') {
        const runId = String((msg as MsgAbortRun).payload?.runId || '');
        const aborted = runId ? abortRegistry.abortRun(runId) : false;
        sendResponse({ ok: true, aborted });
        return;
      }

      // All API calls require an API key.
      const apiKey = await getApiKey();
      if (!apiKey) {
        sendResponse({ ok: false, code: 'api_key_missing', message: 'API key is not set.' });
        return;
      }

      if (msg.type === 'COUNT_TOKENS') {
        const p = (msg as MsgCountTokens).payload;
        const runId = String(p.runId || '');

        const controller = new AbortController();
        if (runId) abortRegistry.register(runId, controller);

        const userPrompt = buildTokenCountPrompt({ title: p.title, url: p.url, articleText: p.articleText });
        const r = await countTokens({ apiKey, model: p.model, userPrompt, abortSignal: controller.signal });
        if (runId) abortRegistry.unregister(runId, controller);

        if (!r.ok) {
          sendResponse({ ok: false, code: r.code, message: r.message, status: r.status });
          return;
        }
        sendResponse({ ok: true, inputTokens: r.inputTokens });
        return;
      }

      if (msg.type === 'RUN_SUMMARY_SINGLE') {
        const p = (msg as MsgRunSingle).payload;
        const runId = String(p.runId || '');

        const controller = new AbortController();
        if (runId) abortRegistry.register(runId, controller);

        const spec = modeSpec(p.mode);
        const userPrompt = buildSinglePrompt({
          title: p.title,
          url: p.url,
          language: p.language,
          mode: p.mode,
          articleText: p.articleText
        });

        const r = await runMessagesWithRetry({
          apiKey,
          model: p.model,
          maxTokens: spec.maxTokens,
          userPrompt,
          timeoutMs: 75_000,
          abortSignal: controller.signal,
          maxRetries: 2,
          maxTokensCap: 6000
        });

        if (runId) abortRegistry.unregister(runId, controller);

        if (!r.ok) {
          sendResponse({ ok: false, code: r.code, message: r.message, status: r.status });
          return;
        }

        sendResponse({ ok: true, text: r.text, usage: r.usage });
        return;
      }

      if (msg.type === 'RUN_SUMMARY_MAP') {
        const p = (msg as MsgRunMap).payload;
        const runId = String(p.runId || '');

        const controller = new AbortController();
        if (runId) abortRegistry.register(runId, controller);

        const system = buildMapSystem({ language: p.language });
        const userPrompt = buildMapPrompt({
          title: p.title,
          url: p.url,
          chunkIndex: p.chunkIndex,
          chunkCount: p.chunkCount,
          chunkText: p.chunkText
        });

        const r = await runMessagesWithRetry({
          apiKey,
          model: p.model,
          maxTokens: MAP_CHUNK_MAX_OUTPUT_TOKENS,
          system,
          userPrompt,
          timeoutMs: 75_000,
          abortSignal: controller.signal,
          maxRetries: 0
        });

        if (runId) abortRegistry.unregister(runId, controller);

        if (!r.ok) {
          sendResponse({ ok: false, code: r.code, message: r.message, status: r.status });
          return;
        }

        sendResponse({ ok: true, text: r.text, usage: r.usage });
        return;
      }

      if (msg.type === 'RUN_SUMMARY_REDUCE') {
        const p = (msg as MsgRunReduce).payload;
        const runId = String(p.runId || '');

        const controller = new AbortController();
        if (runId) abortRegistry.register(runId, controller);

        const spec = modeSpec(p.mode);
        const userPrompt = buildReducePrompt({
          title: p.title,
          url: p.url,
          language: p.language,
          mode: p.mode,
          chunkSummaries: p.chunkSummaries
        });

        const r = await runMessagesWithRetry({
          apiKey,
          model: p.model,
          maxTokens: spec.maxTokens,
          userPrompt,
          timeoutMs: 90_000,
          abortSignal: controller.signal,
          maxRetries: 2,
          maxTokensCap: 6000
        });

        if (runId) abortRegistry.unregister(runId, controller);

        if (!r.ok) {
          sendResponse({ ok: false, code: r.code, message: r.message, status: r.status });
          return;
        }

        sendResponse({ ok: true, text: r.text, usage: r.usage });
        return;
      }

      if (msg.type === 'RUN_SUMMARY_REPAIR') {
        const p = (msg as MsgRunRepair).payload;
        const runId = String(p.runId || '');

        const controller = new AbortController();
        if (runId) abortRegistry.register(runId, controller);

        const userPrompt = buildRepairPrompt({
          title: p.title,
          url: p.url,
          chunkSummaries: p.chunkSummaries,
          language: p.language,
          mode: p.mode,
          badOutput: p.badOutput,
          fixTruncation: p.fixTruncation
        });
        const r = await runMessagesWithRetry({
          apiKey,
          model: p.model,
          maxTokens: modeSpec(p.mode).maxTokens,
          userPrompt,
          timeoutMs: 60_000,
          abortSignal: controller.signal,
          maxRetries: 2,
          maxTokensCap: 6000
        });

        if (runId) abortRegistry.unregister(runId, controller);

        if (!r.ok) {
          sendResponse({ ok: false, code: r.code, message: r.message, status: r.status });
          return;
        }

        sendResponse({ ok: true, text: r.text, usage: r.usage });
        return;
      }

      sendResponse({ ok: false, code: 'unknown_type', message: `Unknown message type: ${msg.type}` });
    } catch (err) {
      // Avoid leaking sensitive data.
      console.error('[ArticleSummarizer] background message handler failed', err);
      sendResponse({ ok: false, code: 'internal_error', message: 'Internal error' });
    }
  })();

  // Indicate async response.
  return true;
});
