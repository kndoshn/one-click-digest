// The Claude models the extension offers, and what the cost estimate and API requests need to know
// about each. To add or retire a model, edit MODELS: the options page, the estimate and the request
// parameters all read from here.
//
// The Models API (GET /v1/models) lists model IDs and limits but not prices. Check prices against
// https://platform.claude.com/docs/en/about-claude/pricing and update PRICING_CHECKED_ON.

export const PRICING_CHECKED_ON = '2026-10-13';

export type ModelPricing = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  // Higher rates applied when a single request's input exceeds the threshold.
  longContext?: { thresholdInputTokens: number; inputUsdPerMTok: number; outputUsdPerMTok: number };
};

export type ModelInfo = {
  id: string;
  name: string;
  pricing: ModelPricing;
  // Models on the newer tokenizer (introduced with Claude Opus 4.7) produce ~30% more tokens for
  // the same text. Applied to the rough char-based estimate only; exact counts come from the Token
  // Count API with the target model.
  tokenizerInflation: number;
  // Minimum cacheable prompt prefix (tokens). Shorter prefixes are not cached even with
  // cache_control.
  cacheMinTokens: number;
  // Extra Messages API parameters. Policy: keep each pipeline stage's thinking behavior unchanged
  // across model upgrades.
  requestParams?: () => Record<string, unknown>;
};

// Listed in the options page in this order (after the default for each role).
export const MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    // $0.10/$0.50 per MTok for prompts up to 100K tokens; $0.50/$2.50 above.
    pricing: {
      inputUsdPerMTok: 0.1,
      outputUsdPerMTok: 0.5,
      longContext: { thresholdInputTokens: 100_000, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 }
    },
    tokenizerInflation: 1.3,
    cacheMinTokens: 512,
    // Map/single-pass ran on Claude Haiku 4.5 without thinking; Haiku 5.5 thinks by default, which
    // would consume the small max_tokens budgets (220 for map chunks) and trigger retries.
    // "disabled" is accepted only at effort high or below; the default effort (medium) qualifies.
    requestParams: () => ({ thinking: { type: 'disabled' } })
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    pricing: { inputUsdPerMTok: 2.0, outputUsdPerMTok: 10.0 },
    tokenizerInflation: 1.3,
    cacheMinTokens: 512,
    // Reduce/repair ran on Claude Sonnet 5 with adaptive thinking (its default). Sonnet 5.5 rejects
    // thinking.type "disabled" with a 400, so keep adaptive and pin effort below its `high` default
    // to bound thinking tokens.
    requestParams: () => ({ output_config: { effort: 'medium' } })
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    // The launch price became the standard price (the scheduled increase to $3/$15 was cancelled).
    pricing: { inputUsdPerMTok: 2.0, outputUsdPerMTok: 10.0 },
    tokenizerInflation: 1.3,
    cacheMinTokens: 1024
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    pricing: { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 },
    tokenizerInflation: 1,
    cacheMinTokens: 1024
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    pricing: { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 },
    tokenizerInflation: 1,
    cacheMinTokens: 1024
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    pricing: { inputUsdPerMTok: 1.0, outputUsdPerMTok: 5.0 },
    tokenizerInflation: 1,
    cacheMinTokens: 4096
  }
];

// Model strategy: single-pass summaries and map chunks use the map model (cost-effective); the
// reduce and repair passes of chunked articles use the final model.
export const DEFAULT_MAP_MODEL = 'claude-haiku-5-5';
export const DEFAULT_FINAL_MODEL = 'claude-sonnet-5-5';

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function isKnownModel(id: unknown): id is string {
  return typeof id === 'string' && findModel(id) !== undefined;
}

// Extra Messages API parameters for `model` (a fresh object; empty for models without any).
export function modelRequestParams(model: string): Record<string, unknown> {
  return findModel(model)?.requestParams?.() ?? {};
}
