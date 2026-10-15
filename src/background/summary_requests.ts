// Turns a summarization message from the content script into a Messages API call (prompt, model,
// output budget, timeouts and retries). Used by the background worker and by the eval harness.

import type { SummaryRequestMessage } from '../shared/messages.ts';
import { MAP_CHUNK_MAX_OUTPUT_TOKENS, modeMaxOutputTokens } from '../shared/summary_modes.ts';
import type { MessagesRequest } from './anthropic.ts';
import {
  type CacheControlEphemeral,
  buildMapPrompt,
  buildMapSystem,
  buildReducePrompt,
  buildRepairPrompt,
  buildSinglePrompt
} from './prompts.ts';

// A Messages API call for one summarization step (everything except the API key and abort signal).
export type SummaryRequest = Omit<MessagesRequest, 'apiKey' | 'abortSignal'> & {
  maxRetries: number;
  maxTokensCap?: number;
};

export function buildSummaryRequest(
  msg: SummaryRequestMessage,
  cacheControl: CacheControlEphemeral | undefined
): SummaryRequest {
  switch (msg.type) {
    case 'RUN_SUMMARY_SINGLE': {
      const p = msg.payload;
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
      const p = msg.payload;
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
      const p = msg.payload;
      return {
        model: p.model,
        maxTokens: modeMaxOutputTokens(p.mode),
        userPrompt: buildReducePrompt({
          title: p.title,
          url: p.url,
          language: p.language,
          mode: p.mode,
          chunkSummaries: p.chunkSummaries,
          cacheControl
        }),
        timeoutMs: 90_000,
        maxRetries: 2,
        maxTokensCap: 6000
      };
    }
    case 'RUN_SUMMARY_REPAIR': {
      const p = msg.payload;
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
          bulletCount: p.bulletCount,
          foreignLines: p.foreignLines,
          cacheControl
        }),
        timeoutMs: 60_000,
        maxRetries: 2,
        maxTokensCap: 6000
      };
    }
  }
}
