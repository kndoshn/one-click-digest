// Shared type definitions across extension contexts (background, options, content).
export const DEFAULT_SETTINGS = {
    modelMap: 'claude-haiku-4-5',
    modelFinal: 'claude-sonnet-5',
    promptCachingEnabled: true,
    promptCachingTtl: '5m',
    hardCostLimitUsd: 1.0,
    approvalThresholdUsd: 1.0,
    approvalThresholdChars: 100_000,
    minArticleChars: 600,
    maxArticleCharsToSend: 200_000,
    uiLanguage: 'auto'
};
