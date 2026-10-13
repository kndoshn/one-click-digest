// Summary modes and their output token budgets (shared by the content scripts' cost estimate and
// the background prompt builders, so the estimate matches what is requested).

export const SUMMARY_MODES = ['BULLETS_3', 'BULLETS_5', 'BULLETS_10', 'TLDR_12_CONCLUSION'] as const;

export type SummaryMode = (typeof SUMMARY_MODES)[number];

// max_tokens for one map-stage chunk summary (five bullets from a chunk of up to
// CHUNK_TARGET_INPUT_TOKENS). Claude Haiku 5.5 needs about 330+ tokens for that, so a smaller budget
// cuts the summary off and the reduce step loses the rest of the chunk.
export const MAP_CHUNK_MAX_OUTPUT_TOKENS = 800;

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
