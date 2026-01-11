// Shared constants across extension contexts (background, options UI).

export const STORAGE_KEYS = {
  CLAUDE_API_KEY: 'claudeApiKey',
  // Non-sensitive preferences (stored in chrome.storage.local)
  MODEL_MAP: 'modelMap',
  MODEL_FINAL: 'modelFinal',
  PROMPT_CACHING_ENABLED: 'promptCachingEnabled',
  PROMPT_CACHING_TTL: 'promptCachingTtl',
  HARD_COST_LIMIT_USD: 'hardCostLimitUsd',
  APPROVAL_THRESHOLD_USD: 'approvalThresholdUsd',
  APPROVAL_THRESHOLD_CHARS: 'approvalThresholdChars',
  MIN_ARTICLE_CHARS: 'minArticleChars',
  MAX_ARTICLE_CHARS_TO_SEND: 'maxArticleCharsToSend',
  UI_LANGUAGE: 'uiLanguage'
} as const;
