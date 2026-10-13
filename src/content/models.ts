import { modeMaxOutputTokens, type SummaryMode } from '../shared/summary_modes.ts';
import { DEFAULT_FINAL_MODEL, DEFAULT_MAP_MODEL, MODELS, type ModelPricing } from '../shared/models.ts';
import type { BulletStyle, CacheTtl, RuntimeSettings } from '../shared/types.ts';

// -----------------------------
// Summary modes
// -----------------------------

export type ModeOption = {
  mode: SummaryMode;
  labelKey: string;
  descKey: string;
};

export const MODE_OPTIONS: ModeOption[] = [
  { mode: 'BULLETS_3', labelKey: 'mode3Label', descKey: 'mode3Desc' },
  { mode: 'BULLETS_5', labelKey: 'mode5Label', descKey: 'mode5Desc' },
  { mode: 'BULLETS_10', labelKey: 'mode10Label', descKey: 'mode10Desc' },
  { mode: 'TLDR_12_CONCLUSION', labelKey: 'modeDLabel', descKey: 'modeDDesc' }
];

export const DEFAULT_MODE: SummaryMode = 'BULLETS_5';

// -----------------------------
// Bullet styles
// -----------------------------

// How the result screen marks bullet points (BulletStyle in src/shared/types.ts). The model always
// writes "- "; the overlay swaps the marker for display and copy (Format.applyBulletStyle).
export type BulletStyleOption = {
  style: BulletStyle;
  // Shown on the button as is (not translated).
  marker: string;
  labelKey: string;
};

export const BULLET_STYLE_OPTIONS: BulletStyleOption[] = [
  { style: 'dash', marker: '-', labelKey: 'bulletStyleDash' },
  { style: 'dot', marker: '・', labelKey: 'bulletStyleDot' },
  { style: 'number', marker: '1.', labelKey: 'bulletStyleNumber' }
];

export type ModeRuntimeSpec = {
  mode: SummaryMode;
  maxOutputTokens: number;
  bulletCount: number;
  hasTldrLine: boolean;
  hasConclusionLine: boolean;
};

export function getModeRuntimeSpec(mode: SummaryMode): ModeRuntimeSpec {
  switch (mode) {
    case 'BULLETS_3':
      return {
        mode,
        maxOutputTokens: modeMaxOutputTokens(mode),
        bulletCount: 3,
        hasTldrLine: false,
        hasConclusionLine: false
      };
    case 'BULLETS_5':
      return {
        mode,
        maxOutputTokens: modeMaxOutputTokens(mode),
        bulletCount: 5,
        hasTldrLine: false,
        hasConclusionLine: false
      };
    case 'BULLETS_10':
      return {
        mode,
        maxOutputTokens: modeMaxOutputTokens(mode),
        bulletCount: 10,
        hasTldrLine: false,
        hasConclusionLine: false
      };
    case 'TLDR_12_CONCLUSION':
      return {
        mode,
        maxOutputTokens: modeMaxOutputTokens(mode),
        bulletCount: 12,
        hasTldrLine: true,
        hasConclusionLine: true
      };
  }
}

// -----------------------------
// Models
// -----------------------------

// Map and final models (see src/shared/models.ts); replaced by applyRuntimeSettings().
export let MODEL_MAP = DEFAULT_MAP_MODEL;
export let MODEL_FINAL = DEFAULT_FINAL_MODEL;
// Token counting uses the map model, which is also the single-pass model. This keeps the
// tokenization close to map-stage accounting.
export let MODEL_TOKEN_COUNT = MODEL_MAP;

// -----------------------------
// Limits & thresholds
// -----------------------------

// Hard upper bound: if estimated worst-case cost exceeds this, the run is blocked.
export let HARD_COST_LIMIT_USD = 1.0;

// Send upper bound (safety). This is separate from cost controls.
export let MAX_ARTICLE_CHARS_TO_SEND = 200_000;

// If the extracted article is too short, do not summarize.
export let MIN_ARTICLE_CHARS = 600;

// Rough approval thresholds (v1). Tune with real-world feedback.
export let APPROVAL_THRESHOLD_USD = 1.0;
export let APPROVAL_THRESHOLD_CHARS = 100_000;

// Prompt caching controls (affects reduce/repair prompts and cost estimation)
export let PROMPT_CACHING_ENABLED = true;
export let PROMPT_CACHING_TTL: CacheTtl = '5m';

// Chunking thresholds
export const CHUNK_TARGET_INPUT_TOKENS = 8_000;

// -----------------------------
// Per-model tables (from src/shared/models.ts)
// -----------------------------

export const PRICING: Record<string, ModelPricing> = Object.fromEntries(MODELS.map((m) => [m.id, m.pricing]));

// Resolve the rates billed for one request with the given input size.
// Returns undefined for unknown models.
export function resolvePricing(model: string, requestInputTokens: number): ModelPricing | undefined {
  const pricing = PRICING[model];
  if (!pricing) return undefined;
  return applyPricingTier(pricing, requestInputTokens);
}

export function applyPricingTier(pricing: ModelPricing, requestInputTokens: number): ModelPricing {
  const lc = pricing.longContext;
  if (lc && requestInputTokens > lc.thresholdInputTokens) {
    return { inputUsdPerMTok: lc.inputUsdPerMTok, outputUsdPerMTok: lc.outputUsdPerMTok };
  }
  return pricing;
}

export const TOKENIZER_INFLATION: Record<string, number> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.tokenizerInflation])
);

// Prompt caching multipliers
export const CACHE_MULTIPLIERS = {
  read: 0.1,
  write5m: 1.25,
  write1h: 2.0
} as const;

export const MODEL_CACHE_MIN_TOKENS: Record<string, number> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.cacheMinTokens])
);

// Apply runtime settings from background/options. This mutates the exported variables above.
export function applyRuntimeSettings(settings?: Partial<RuntimeSettings>): void {
  if (!settings) return;

  // Models
  if (typeof settings.modelMap === 'string' && settings.modelMap.trim()) {
    MODEL_MAP = settings.modelMap.trim();
    MODEL_TOKEN_COUNT = MODEL_MAP;
  }
  if (typeof settings.modelFinal === 'string' && settings.modelFinal.trim()) {
    MODEL_FINAL = settings.modelFinal.trim();
  }

  // Cost thresholds
  if (
    typeof settings.hardCostLimitUsd === 'number' &&
    isFinite(settings.hardCostLimitUsd) &&
    settings.hardCostLimitUsd > 0
  ) {
    HARD_COST_LIMIT_USD = settings.hardCostLimitUsd;
  }
  if (
    typeof settings.approvalThresholdUsd === 'number' &&
    isFinite(settings.approvalThresholdUsd) &&
    settings.approvalThresholdUsd >= 0
  ) {
    APPROVAL_THRESHOLD_USD = settings.approvalThresholdUsd;
  }
  if (
    typeof settings.approvalThresholdChars === 'number' &&
    isFinite(settings.approvalThresholdChars) &&
    settings.approvalThresholdChars >= 0
  ) {
    APPROVAL_THRESHOLD_CHARS = Math.floor(settings.approvalThresholdChars);
  }

  // Extraction/send limits
  if (
    typeof settings.minArticleChars === 'number' &&
    isFinite(settings.minArticleChars) &&
    settings.minArticleChars >= 0
  ) {
    MIN_ARTICLE_CHARS = Math.floor(settings.minArticleChars);
  }
  if (
    typeof settings.maxArticleCharsToSend === 'number' &&
    isFinite(settings.maxArticleCharsToSend) &&
    settings.maxArticleCharsToSend > 0
  ) {
    MAX_ARTICLE_CHARS_TO_SEND = Math.floor(settings.maxArticleCharsToSend);
  }

  // Prompt caching
  if (typeof settings.promptCachingEnabled === 'boolean') {
    PROMPT_CACHING_ENABLED = settings.promptCachingEnabled;
  }
  const ttl = settings.promptCachingTtl as CacheTtl;
  if (ttl && (ttl === '5m' || ttl === '1h')) {
    PROMPT_CACHING_TTL = ttl;
  }
}

// -----------------------------
// UI state model
// -----------------------------

export type UiPhase = 'IDLE' | 'EXTRACTING' | 'PREFLIGHT' | 'CONFIRM' | 'SUMMARIZING' | 'DONE' | 'ERROR' | 'BLOCKED';

export type UiStateBase = {
  phase: UiPhase;
  selectedLanguage: string; // 'auto' or BCP-47
  selectedMode: SummaryMode;
  bulletStyle: BulletStyle;
  apiKeySet: boolean;
  // If not empty, shown as a non-blocking banner.
  banner?: string;
};

export type IdleState = UiStateBase & {
  phase: 'IDLE';
};

export type ExtractingState = UiStateBase & {
  phase: 'EXTRACTING';
  runId: string;
};

export type PreflightState = UiStateBase & {
  phase: 'PREFLIGHT';
  runId: string;
  article: ExtractOk;
  estimate: CostEstimate;
  refining: boolean;
};

export type ConfirmState = UiStateBase & {
  phase: 'CONFIRM';
  runId: string;
  article: ExtractOk;
  estimate: CostEstimate;
  note?: string;
};

export type SummarizingState = UiStateBase & {
  phase: 'SUMMARIZING';
  runId: string;
  article: ExtractOk;
  estimate: CostEstimate;
  progress?: {
    stage: 'SINGLE' | 'MAP' | 'REDUCE' | 'REPAIR';
    current?: number;
    total?: number;
  };
};

export type DoneState = UiStateBase & {
  phase: 'DONE';
  runId: string;
  article: ExtractOk;
  summaryText: string;
  // Messages API usage object. When prompt caching is in play, Claude may also
  // return cache_* token counters.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export type ErrorState = UiStateBase & {
  phase: 'ERROR';
  message: string;
};

export type BlockedState = UiStateBase & {
  phase: 'BLOCKED';
  runId: string;
  estimate: CostEstimate;
  reason: string;
};

export type UiState =
  | IdleState
  | ExtractingState
  | PreflightState
  | ConfirmState
  | SummarizingState
  | DoneState
  | ErrorState
  | BlockedState;

// Results
export type ExtractOk = {
  ok: true;
  title: string;
  url: string;
  text: string;
  charCount: number;
  linkDensity: number;
};

export type ExtractFail = {
  ok: false;
  code: 'TOO_SHORT' | 'NO_MAIN_TEXT' | 'LINK_HEAVY' | 'UNKNOWN';
  message: string;
  charCount?: number;
  linkDensity?: number;
};

export type ExtractResult = ExtractOk | ExtractFail;

export type CostEstimate = {
  charCount: number;
  tokenLow: number;
  tokenHigh: number;
  tokenExact?: number;
  chunkCount: number;
  // Rough cost range (USD).
  costLowUsd: number;
  costHighUsd: number;
  costWorstUsd: number;
  // Time range (seconds).
  timeLowSec: number;
  timeHighSec: number;
  // For display.
  model: string;
  // Underlying model IDs (for clarity in the estimate screen).
  mapModel: string;
  finalModel: string;
  maxOutputTokens: number;
  truncated: boolean;
  sentCharCount: number;
};

export type UiEvent =
  | { type: 'BOOTSTRAP'; language: string; mode: SummaryMode }
  | { type: 'SETTINGS_LOADED'; apiKeySet: boolean }
  | { type: 'LANGUAGE_CHANGED'; language: string }
  | { type: 'MODE_CHANGED'; mode: SummaryMode }
  | { type: 'BULLET_STYLE_CHANGED'; bulletStyle: BulletStyle }
  | { type: 'START_RUN'; runId: string }
  | { type: 'EXTRACT_OK'; runId: string; article: ExtractOk }
  | { type: 'EXTRACT_FAIL'; runId: string; message: string }
  | { type: 'PREFLIGHT_READY'; runId: string; estimate: CostEstimate; refining: boolean }
  | { type: 'TOKENS_REFINED'; runId: string; estimate: CostEstimate }
  | { type: 'NEEDS_CONFIRM'; runId: string; estimate: CostEstimate; note?: string }
  | { type: 'BLOCKED'; runId: string; estimate: CostEstimate; reason: string }
  | { type: 'START_SUMMARY'; runId: string }
  | {
      type: 'SUMMARY_PROGRESS';
      runId: string;
      stage: 'SINGLE' | 'MAP' | 'REDUCE' | 'REPAIR';
      current?: number;
      total?: number;
    }
  | { type: 'SUMMARY_DONE'; runId: string; summaryText: string; usage?: any }
  | { type: 'SUMMARY_ERROR'; runId: string; message: string }
  | { type: 'RESET'; banner?: string };

export function isBusy(state: UiState): boolean {
  return (
    state.phase === 'EXTRACTING' ||
    state.phase === 'PREFLIGHT' ||
    state.phase === 'CONFIRM' ||
    state.phase === 'SUMMARIZING'
  );
}
