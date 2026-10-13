// Summary modes and their output token budgets (shared by the content scripts' cost estimate and
// the background prompt builders, so the estimate matches what is requested).

export type SummaryMode = 'BULLETS_3' | 'BULLETS_5' | 'BULLETS_10' | 'TLDR_12_CONCLUSION';

// max_tokens for one map-stage chunk summary.
export const MAP_CHUNK_MAX_OUTPUT_TOKENS = 220;

const MODE_MAX_OUTPUT_TOKENS: Record<SummaryMode, number> = {
  BULLETS_3: 450,
  BULLETS_5: 700,
  BULLETS_10: 1200,
  TLDR_12_CONCLUSION: 1600
};

// max_tokens for the final summary (single pass, reduce and repair).
export function modeMaxOutputTokens(mode: SummaryMode): number {
  return MODE_MAX_OUTPUT_TOKENS[mode];
}
