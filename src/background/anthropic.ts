// Minimal Anthropic API client (Token Count API and Messages API) for the background worker.

import { modelRequestParams } from '../shared/model_params.ts';
import { type UserContent } from './prompts.ts';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
// Per official examples, anthropic-version is required.
const ANTHROPIC_VERSION = '2023-06-01';
// Required for direct browser/extension requests.
const ANTHROPIC_BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';

export type NormalizedApiError = { ok: false; code: string; message: string; status?: number };

export type Usage = { input_tokens?: number; output_tokens?: number };

export type MessagesResult = { ok: true; text: string; usage?: Usage; stopReason?: string } | NormalizedApiError;

type FetchJsonResult = { ok: boolean; status: number; json: any };

function safeJsonParse(text: string): any {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return { raw: text };
  }
}

function combineAbortSignals(external: AbortSignal | undefined, internal: AbortController): () => void {
  if (!external) return () => {};
  // The 'abort' event has already fired (e.g. ABORT_RUN arrived between max_tokens retries).
  if (external.aborted) {
    internal.abort();
    return () => {};
  }
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
  path: string;
  apiKey: string;
  body: unknown;
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
    const resp = await fetch(`${ANTHROPIC_API_BASE}${args.path}`, {
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

    const json = safeJsonParse(await resp.text());
    return { ok: resp.ok, status: resp.status, json };
  } catch (err: any) {
    // Normalize network/abort errors into the same {error:{type,message}} shape.
    const isAbort = err?.name === 'AbortError';
    const type = isAbort ? (timedOut ? 'timeout' : 'aborted') : 'network_error';
    const message =
      (timedOut && 'Request timed out') ||
      (isAbort && 'Request aborted') ||
      (err?.message ? String(err.message) : 'Network error');
    return { ok: false, status: 0, json: { error: { type, message } } };
  } finally {
    clearTimeout(timer);
    remove();
  }
}

function normalizeApiError(res: FetchJsonResult, fallback: string): NormalizedApiError {
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

export async function countTokens(args: {
  apiKey: string;
  model: string;
  userPrompt: string;
  abortSignal?: AbortSignal;
}): Promise<{ ok: true; inputTokens: number } | NormalizedApiError> {
  const res = await postJsonWithTimeout({
    path: '/v1/messages/count_tokens',
    apiKey: args.apiKey,
    body: {
      model: args.model,
      messages: [{ role: 'user', content: args.userPrompt }]
    },
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

export type MessagesRequest = {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  userPrompt: UserContent;
  timeoutMs: number;
  abortSignal?: AbortSignal;
};

async function runMessages(args: MessagesRequest): Promise<MessagesResult> {
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens,
    messages: [{ role: 'user', content: args.userPrompt }],
    ...modelRequestParams(args.model)
  };
  if (args.system) body.system = args.system;

  const res = await postJsonWithTimeout({
    path: '/v1/messages',
    apiKey: args.apiKey,
    body,
    timeoutMs: args.timeoutMs,
    abortSignal: args.abortSignal
  });

  if (!res.ok) return normalizeApiError(res, 'Messages request failed.');

  const stopReason = typeof res.json?.stop_reason === 'string' ? String(res.json.stop_reason) : undefined;
  // Safety classifiers can decline with HTTP 200; there is no usable summary in that case.
  if (stopReason === 'refusal') {
    return { ok: false, code: 'refusal', message: 'The model declined to respond.' };
  }

  return { ok: true, text: extractTextBlocks(res.json?.content), usage: res.json?.usage, stopReason };
}

// Runs a Messages request, growing max_tokens by 1.5x (up to maxTokensCap) while the response stops
// at max_tokens. After maxRetries retries, one final request is made with the last budget.
export async function runMessagesWithRetry(
  args: MessagesRequest & { maxRetries?: number; maxTokensCap?: number }
): Promise<MessagesResult> {
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
