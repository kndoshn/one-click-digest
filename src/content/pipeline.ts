// The summarization pipeline: one request for a short article, map-reduce for a long one, then up
// to two repair passes (invalid format, then a likely truncated ending). It does not know about the
// overlay or how requests reach the API: the content script sends them through the background
// worker, and the eval harness (eval/) calls the API client directly.

import type { ErrorResponse, ResponseFor, SummaryRequestMessage, Usage } from '../shared/messages.ts';
import type { SummaryMode } from '../shared/summary_modes.ts';
import * as Chunker from './chunk.ts';
import * as Format from './format.ts';

export type PipelineArticle = { title: string; url: string; text: string };

export type PipelineOptions = {
  runId: string;
  mode: SummaryMode;
  language: string;
  // Single pass and map chunks use the map model; reduce and repair of chunked runs use the final model.
  mapModel: string;
  finalModel: string;
  chunkTargetTokens: number;
};

export type SendSummaryRequest = <T extends SummaryRequestMessage>(msg: T) => Promise<ResponseFor<T['type']>>;

export type PipelineStage = 'SINGLE' | 'MAP' | 'REDUCE' | 'REPAIR';

export type PipelineHooks = {
  onProgress?: (stage: PipelineStage, current?: number, total?: number) => void;
  // Checked after every request; once false the pipeline stops without sending more requests.
  isActive?: () => boolean;
};

export type RepairKind = 'format' | 'truncation';

// What happened along the way (for the eval harness; the overlay ignores it).
export type PipelineTrace = {
  chunks: number;
  // Whether the first draft (single pass or reduce) already had a valid format.
  draftValid: boolean;
  repairs: { kind: RepairKind; accepted: boolean }[];
};

export type PipelineResult =
  | { status: 'done'; text: string; usage?: Usage; trace: PipelineTrace }
  // `error` is undefined when the worker sent no response.
  | { status: 'error'; error: ErrorResponse | undefined; trace: PipelineTrace }
  | { status: 'cancelled' };

type SummaryResponse = ResponseFor<SummaryRequestMessage['type']>;

function textOf(resp: SummaryResponse | undefined): (SummaryResponse & { ok: true }) | undefined {
  return resp && resp.ok === true && typeof resp.text === 'string' ? resp : undefined;
}

function errorOf(resp: SummaryResponse | undefined): ErrorResponse | undefined {
  return resp && resp.ok === false ? resp : undefined;
}

export async function runPipeline(
  article: PipelineArticle,
  opts: PipelineOptions,
  send: SendSummaryRequest,
  hooks: PipelineHooks = {}
): Promise<PipelineResult> {
  const isActive = hooks.isActive ?? (() => true);
  const progress = hooks.onProgress ?? (() => {});
  const { runId, mode, language } = opts;
  const chunks = Chunker.chunkText(article.text, opts.chunkTargetTokens);
  const trace: PipelineTrace = { chunks: chunks.length, draftValid: false, repairs: [] };

  // The first draft: a single pass, or map + reduce.
  let draft: SummaryResponse & { ok: true };
  let repairModel: string;
  let chunkSummaries: string[] | undefined;
  if (chunks.length > 1) {
    chunkSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
      if (!isActive()) return { status: 'cancelled' };
      progress('MAP', i + 1, chunks.length);
      const resp = await send({
        type: 'RUN_SUMMARY_MAP',
        payload: {
          runId,
          title: article.title,
          url: article.url,
          language,
          chunkText: chunks[i],
          chunkIndex: i + 1,
          chunkCount: chunks.length,
          model: opts.mapModel
        }
      });
      if (!isActive()) return { status: 'cancelled' };
      const ok = textOf(resp);
      if (!ok) return { status: 'error', error: errorOf(resp), trace };
      chunkSummaries.push(ok.text);
    }

    if (!isActive()) return { status: 'cancelled' };
    progress('REDUCE');
    const reduced = await send({
      type: 'RUN_SUMMARY_REDUCE',
      payload: {
        runId,
        title: article.title,
        url: article.url,
        language,
        mode,
        chunkSummaries,
        model: opts.finalModel
      }
    });
    if (!isActive()) return { status: 'cancelled' };
    const ok = textOf(reduced);
    if (!ok) return { status: 'error', error: errorOf(reduced), trace };
    draft = ok;
    repairModel = opts.finalModel;
  } else {
    progress('SINGLE');
    const resp = await send({
      type: 'RUN_SUMMARY_SINGLE',
      payload: {
        runId,
        title: article.title,
        url: article.url,
        language,
        mode,
        articleText: article.text,
        // Must match the cost estimate: single-pass uses the map model.
        model: opts.mapModel
      }
    });
    if (!isActive()) return { status: 'cancelled' };
    const ok = textOf(resp);
    if (!ok) return { status: 'error', error: errorOf(resp), trace };
    draft = ok;
    repairModel = opts.mapModel;
  }

  // Asks for a rewrite of `text` and keeps `text` unless the rewrite passes format validation.
  const repair = async (text: string, kind: RepairKind): Promise<string> => {
    progress('REPAIR');
    const resp = await send({
      type: 'RUN_SUMMARY_REPAIR',
      payload: {
        runId,
        language,
        mode,
        badOutput: text,
        model: repairModel,
        title: article.title,
        url: article.url,
        // Map-reduce runs pass the chunk summaries so the repair pass can reuse the reduce prompt cache.
        chunkSummaries,
        ...(kind === 'truncation' ? { fixTruncation: true } : {})
      }
    });
    if (!isActive()) return text;
    const ok = textOf(resp);
    const accepted = Boolean(ok && Format.validate(mode, ok.text).ok);
    trace.repairs.push({ kind, accepted });
    return accepted && ok ? ok.text : text;
  };

  let text = draft.text;
  trace.draftValid = Format.validate(mode, text).ok;
  if (!trace.draftValid) {
    text = await repair(text, 'format');
    if (!isActive()) return { status: 'cancelled' };
  }
  if (Format.isLikelyTruncatedOutput(text, language)) {
    text = await repair(text, 'truncation');
  }
  if (!isActive()) return { status: 'cancelled' };
  return { status: 'done', text: Format.normalizeSummaryText(text), usage: draft.usage, trace };
}
