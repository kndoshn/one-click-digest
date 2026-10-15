// Messages from the content script to the background worker (chrome.runtime.sendMessage), and the
// responses. The background validates every incoming message against these schemas; the content
// script imports only the types (valibot stays out of the content bundle).

import * as v from 'valibot';
import { SUMMARY_MODES } from './summary_modes.ts';
import { BULLET_STYLES, type BulletStyle, type RuntimeSettings } from './types.ts';

const text = v.string();
const nonEmpty = v.pipe(v.string(), v.minLength(1));
const mode = v.picklist(SUMMARY_MODES);
// Identifies one summary run, so ABORT_RUN can cancel all of its requests.
const runId = nonEmpty;
const model = nonEmpty;

export const GetSettingsSchema = v.object({ type: v.literal('GET_SETTINGS') });
export const OpenOptionsSchema = v.object({ type: v.literal('OPEN_OPTIONS') });
export const SetBulletStyleSchema = v.object({
  type: v.literal('SET_BULLET_STYLE'),
  payload: v.object({ style: v.picklist(BULLET_STYLES) })
});
export const AbortRunSchema = v.object({ type: v.literal('ABORT_RUN'), payload: v.object({ runId }) });
export const CountTokensSchema = v.object({
  type: v.literal('COUNT_TOKENS'),
  payload: v.object({ runId, title: text, url: text, articleText: text, model })
});
export const RunSingleSchema = v.object({
  type: v.literal('RUN_SUMMARY_SINGLE'),
  payload: v.object({ runId, title: text, url: text, language: text, mode, articleText: text, model })
});
export const RunMapSchema = v.object({
  type: v.literal('RUN_SUMMARY_MAP'),
  payload: v.object({
    runId,
    title: text,
    url: text,
    language: text,
    chunkIndex: v.pipe(v.number(), v.integer(), v.minValue(1)),
    chunkCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
    chunkText: text,
    model
  })
});
export const RunReduceSchema = v.object({
  type: v.literal('RUN_SUMMARY_REDUCE'),
  payload: v.object({
    runId,
    title: text,
    url: text,
    language: text,
    mode,
    chunkSummaries: v.array(text),
    model
  })
});
export const RunRepairSchema = v.object({
  type: v.literal('RUN_SUMMARY_REPAIR'),
  payload: v.object({
    runId,
    language: text,
    mode,
    badOutput: text,
    model,
    title: v.optional(text),
    url: v.optional(text),
    // Map-reduce runs pass the chunk summaries so the repair prompt can reuse the reduce cache.
    chunkSummaries: v.optional(v.array(text)),
    fixTruncation: v.optional(v.boolean()),
    // Bullets in badOutput, for a format repair; the prompt says so when the count is wrong.
    bulletCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    // Lines of badOutput that are not in the output language, for a format repair.
    foreignLines: v.optional(v.array(text))
  })
});

export const RequestSchema = v.variant('type', [
  GetSettingsSchema,
  OpenOptionsSchema,
  SetBulletStyleSchema,
  AbortRunSchema,
  CountTokensSchema,
  RunSingleSchema,
  RunMapSchema,
  RunReduceSchema,
  RunRepairSchema
]);

export type Request = v.InferOutput<typeof RequestSchema>;
export type RequestType = Request['type'];
export type SummaryRequestMessage = v.InferOutput<
  typeof RunSingleSchema | typeof RunMapSchema | typeof RunReduceSchema | typeof RunRepairSchema
>;

export const REQUEST_TYPES: readonly RequestType[] = RequestSchema.options.map((o) => o.entries.type.literal);

// Every request can fail with an error response (bad request, missing API key, API errors, ...).
export type ErrorResponse = { ok: false; code: string; message: string; status?: number };

// Messages API usage. With prompt caching, the API also reports cache_* token counts.
export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type SuccessFor<T extends RequestType> = T extends 'GET_SETTINGS'
  ? { ok: true; apiKeySet: boolean; settings: RuntimeSettings; bulletStyle: BulletStyle }
  : T extends 'ABORT_RUN'
    ? { ok: true; aborted: boolean }
    : T extends 'COUNT_TOKENS'
      ? { ok: true; inputTokens: number }
      : T extends SummaryRequestMessage['type']
        ? { ok: true; text: string; usage?: Usage }
        : { ok: true };

export type ResponseFor<T extends RequestType> = SuccessFor<T> | ErrorResponse;
