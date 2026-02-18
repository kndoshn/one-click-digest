namespace AS {
  // -----------------------------
  // Summary modes
  // -----------------------------

  export type SummaryMode = 'BULLETS_3' | 'BULLETS_5' | 'BULLETS_10' | 'TLDR_12_CONCLUSION';

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

  export let DEFAULT_MODE: SummaryMode = 'BULLETS_5';

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
        return { mode, maxOutputTokens: 450, bulletCount: 3, hasTldrLine: false, hasConclusionLine: false };
      case 'BULLETS_5':
        return { mode, maxOutputTokens: 700, bulletCount: 5, hasTldrLine: false, hasConclusionLine: false };
      case 'BULLETS_10':
        return { mode, maxOutputTokens: 1200, bulletCount: 10, hasTldrLine: false, hasConclusionLine: false };
      case 'TLDR_12_CONCLUSION':
        return { mode, maxOutputTokens: 1600, bulletCount: 12, hasTldrLine: true, hasConclusionLine: true };
    }
  }

  // -----------------------------
  // Models (initial milestone)
  // -----------------------------

  // Model strategy
  // - Single-pass summaries: Haiku (cost-effective)
  // - Chunked map-reduce: Haiku (map) -> Sonnet (reduce/repair)
  export let MODEL_MAP = 'claude-haiku-4-5';
  export let MODEL_SINGLE = MODEL_MAP;
  export let MODEL_FINAL = 'claude-sonnet-4-6';
  // Token count uses the same model as the intended summary for the best alignment.
  // Token counting uses Haiku. This keeps the tokenization close to map-stage accounting.
  export let MODEL_TOKEN_COUNT = MODEL_MAP;

  // Map stage max output. The map prompt asks for up to ~6 short bullets.
  export const MAP_CHUNK_MAX_OUTPUT_TOKENS = 220;
  // Repair pass output upper bound (format-only). For final output we still use the mode max.
  export const REPAIR_MAX_OUTPUT_TOKENS = 250;

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
  // Pricing snapshot (USD per 1M tokens)
  // (Keep the values in sync with official docs.)
  // -----------------------------

  export type ModelPricing = { inputUsdPerMTok: number; outputUsdPerMTok: number };

  export const PRICING: Record<string, ModelPricing> = {
    // Claude Haiku 4.5: $1/MTok input, $5/MTok output
    'claude-haiku-4-5': { inputUsdPerMTok: 1.0, outputUsdPerMTok: 5.0 },
    // Claude Sonnet 4.5: $3/MTok input, $15/MTok output
    'claude-sonnet-4-5': { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 },
    // Claude Sonnet 4.6: $3/MTok input, $15/MTok output
    'claude-sonnet-4-6': { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 }
  };

  // Prompt caching multipliers
  export const CACHE_MULTIPLIERS = {
    read: 0.1,
    write5m: 1.25,
    write1h: 2.0
  } as const;

  // Minimum cacheable prompt prefix length by model (tokens).
  // If the cached prefix is shorter than this, the API will not cache it even if marked with cache_control.
  // (Source: Claude prompt caching docs.)
  export const MODEL_CACHE_MIN_TOKENS: Record<string, number> = {
    // Haiku 4.5 requires a longer prefix.
    'claude-haiku-4-5': 4096,
    // Sonnet 4.5 caches shorter prefixes.
    'claude-sonnet-4-5': 1024,
    // Sonnet 4.6 caches shorter prefixes.
    'claude-sonnet-4-6': 1024
  };

  // Apply runtime settings from background/options. This mutates the exported variables above.
  export function applyRuntimeSettings(settings?: Partial<RuntimeSettings>): void {
    if (!settings) return;

    // Models
    if (typeof settings.modelMap === 'string' && settings.modelMap.trim()) {
      MODEL_MAP = settings.modelMap.trim();
      MODEL_SINGLE = MODEL_MAP;
      MODEL_TOKEN_COUNT = MODEL_MAP;
    }
    if (typeof settings.modelFinal === 'string' && settings.modelFinal.trim()) {
      MODEL_FINAL = settings.modelFinal.trim();
    }

    // Cost thresholds
    if (typeof settings.hardCostLimitUsd === 'number' && isFinite(settings.hardCostLimitUsd) && settings.hardCostLimitUsd > 0) {
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
    if (typeof settings.minArticleChars === 'number' && isFinite(settings.minArticleChars) && settings.minArticleChars >= 0) {
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
    estimate: Estimate;
    refining: boolean;
  };

  export type ConfirmState = UiStateBase & {
    phase: 'CONFIRM';
    runId: string;
    article: ExtractOk;
    estimate: Estimate;
    note?: string;
  };

  export type SummarizingState = UiStateBase & {
    phase: 'SUMMARIZING';
    runId: string;
    article: ExtractOk;
    estimate: Estimate;
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
    estimate: Estimate;
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

  export type Estimate = {
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
    | { type: 'START_RUN'; runId: string }
    | { type: 'EXTRACT_OK'; runId: string; article: ExtractOk }
    | { type: 'EXTRACT_FAIL'; runId: string; message: string }
    | { type: 'PREFLIGHT_READY'; runId: string; estimate: Estimate; refining: boolean }
    | { type: 'TOKENS_REFINED'; runId: string; estimate: Estimate }
    | { type: 'NEEDS_CONFIRM'; runId: string; estimate: Estimate; note?: string }
    | { type: 'BLOCKED'; runId: string; estimate: Estimate; reason: string }
    | { type: 'START_SUMMARY'; runId: string }
    | { type: 'SUMMARY_PROGRESS'; runId: string; stage: 'SINGLE' | 'MAP' | 'REDUCE' | 'REPAIR'; current?: number; total?: number }
    | { type: 'SUMMARY_DONE'; runId: string; summaryText: string; usage?: any }
    | { type: 'SUMMARY_ERROR'; runId: string; message: string }
    | { type: 'RESET'; banner?: string };

  export function isBusy(state: UiState): boolean {
    return state.phase === 'EXTRACTING' || state.phase === 'PREFLIGHT' || state.phase === 'CONFIRM' || state.phase === 'SUMMARIZING';
  }
}
