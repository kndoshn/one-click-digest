"use strict";
var AS;
(function (AS) {
    // -----------------------------
    // Summary modes
    // -----------------------------
    AS.MODE_OPTIONS = [
        { mode: 'BULLETS_3', labelKey: 'mode3Label', descKey: 'mode3Desc' },
        { mode: 'BULLETS_5', labelKey: 'mode5Label', descKey: 'mode5Desc' },
        { mode: 'BULLETS_10', labelKey: 'mode10Label', descKey: 'mode10Desc' },
        { mode: 'TLDR_12_CONCLUSION', labelKey: 'modeDLabel', descKey: 'modeDDesc' }
    ];
    AS.DEFAULT_MODE = 'BULLETS_5';
    function getModeRuntimeSpec(mode) {
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
    AS.getModeRuntimeSpec = getModeRuntimeSpec;
    // -----------------------------
    // Models (initial milestone)
    // -----------------------------
    // Model strategy
    // - Single-pass summaries: Haiku (cost-effective)
    // - Chunked map-reduce: Haiku (map) -> Sonnet (reduce/repair)
    AS.MODEL_MAP = 'claude-haiku-4-5';
    AS.MODEL_SINGLE = AS.MODEL_MAP;
    AS.MODEL_FINAL = 'claude-sonnet-4-5';
    // Token count uses the same model as the intended summary for the best alignment.
    // Token counting uses Haiku. This keeps the tokenization close to map-stage accounting.
    AS.MODEL_TOKEN_COUNT = AS.MODEL_MAP;
    // Map stage max output. The map prompt asks for up to ~6 short bullets.
    AS.MAP_CHUNK_MAX_OUTPUT_TOKENS = 220;
    // Repair pass output upper bound (format-only). For final output we still use the mode max.
    AS.REPAIR_MAX_OUTPUT_TOKENS = 250;
    // -----------------------------
    // Limits & thresholds
    // -----------------------------
    // Hard upper bound: if estimated worst-case cost exceeds this, the run is blocked.
    AS.HARD_COST_LIMIT_USD = 1.0;
    // Send upper bound (safety). This is separate from cost controls.
    AS.MAX_ARTICLE_CHARS_TO_SEND = 200_000;
    // If the extracted article is too short, do not summarize.
    AS.MIN_ARTICLE_CHARS = 600;
    // Rough approval thresholds (v1). Tune with real-world feedback.
    AS.APPROVAL_THRESHOLD_USD = 1.0;
    AS.APPROVAL_THRESHOLD_CHARS = 100_000;
    // Prompt caching controls (affects reduce/repair prompts and cost estimation)
    AS.PROMPT_CACHING_ENABLED = true;
    AS.PROMPT_CACHING_TTL = '5m';
    // Chunking thresholds
    AS.CHUNK_TARGET_INPUT_TOKENS = 8_000;
    AS.PRICING = {
        // Claude Haiku 4.5: $1/MTok input, $5/MTok output
        'claude-haiku-4-5': { inputUsdPerMTok: 1.0, outputUsdPerMTok: 5.0 },
        // Claude Sonnet 4.5: $3/MTok input, $15/MTok output
        'claude-sonnet-4-5': { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 }
    };
    // Prompt caching multipliers
    AS.CACHE_MULTIPLIERS = {
        read: 0.1,
        write5m: 1.25,
        write1h: 2.0
    };
    // Minimum cacheable prompt prefix length by model (tokens).
    // If the cached prefix is shorter than this, the API will not cache it even if marked with cache_control.
    // (Source: Claude prompt caching docs.)
    AS.MODEL_CACHE_MIN_TOKENS = {
        // Haiku 4.5 requires a longer prefix.
        'claude-haiku-4-5': 4096,
        // Sonnet 4.5 caches shorter prefixes.
        'claude-sonnet-4-5': 1024
    };
    // Apply runtime settings from background/options. This mutates the exported variables above.
    function applyRuntimeSettings(settings) {
        if (!settings)
            return;
        // Models
        if (typeof settings.modelMap === 'string' && settings.modelMap.trim()) {
            AS.MODEL_MAP = settings.modelMap.trim();
            AS.MODEL_SINGLE = AS.MODEL_MAP;
            AS.MODEL_TOKEN_COUNT = AS.MODEL_MAP;
        }
        if (typeof settings.modelFinal === 'string' && settings.modelFinal.trim()) {
            AS.MODEL_FINAL = settings.modelFinal.trim();
        }
        // Cost thresholds
        if (typeof settings.hardCostLimitUsd === 'number' && isFinite(settings.hardCostLimitUsd) && settings.hardCostLimitUsd > 0) {
            AS.HARD_COST_LIMIT_USD = settings.hardCostLimitUsd;
        }
        if (typeof settings.approvalThresholdUsd === 'number' &&
            isFinite(settings.approvalThresholdUsd) &&
            settings.approvalThresholdUsd >= 0) {
            AS.APPROVAL_THRESHOLD_USD = settings.approvalThresholdUsd;
        }
        if (typeof settings.approvalThresholdChars === 'number' &&
            isFinite(settings.approvalThresholdChars) &&
            settings.approvalThresholdChars >= 0) {
            AS.APPROVAL_THRESHOLD_CHARS = Math.floor(settings.approvalThresholdChars);
        }
        // Extraction/send limits
        if (typeof settings.minArticleChars === 'number' && isFinite(settings.minArticleChars) && settings.minArticleChars >= 0) {
            AS.MIN_ARTICLE_CHARS = Math.floor(settings.minArticleChars);
        }
        if (typeof settings.maxArticleCharsToSend === 'number' &&
            isFinite(settings.maxArticleCharsToSend) &&
            settings.maxArticleCharsToSend > 0) {
            AS.MAX_ARTICLE_CHARS_TO_SEND = Math.floor(settings.maxArticleCharsToSend);
        }
        // Prompt caching
        if (typeof settings.promptCachingEnabled === 'boolean') {
            AS.PROMPT_CACHING_ENABLED = settings.promptCachingEnabled;
        }
        const ttl = settings.promptCachingTtl;
        if (ttl && (ttl === '5m' || ttl === '1h')) {
            AS.PROMPT_CACHING_TTL = ttl;
        }
    }
    AS.applyRuntimeSettings = applyRuntimeSettings;
    function isBusy(state) {
        return state.phase === 'EXTRACTING' || state.phase === 'PREFLIGHT' || state.phase === 'CONFIRM' || state.phase === 'SUMMARIZING';
    }
    AS.isBusy = isBusy;
})(AS || (AS = {}));
