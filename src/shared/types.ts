// Shared type definitions across extension contexts (background, options, content).

export type CacheTtl = '5m' | '1h';

export type RuntimeSettings = {
  modelMap: string;
  modelFinal: string;
  promptCachingEnabled: boolean;
  promptCachingTtl: CacheTtl;
  hardCostLimitUsd: number;
  approvalThresholdUsd: number;
  approvalThresholdChars: number;
  minArticleChars: number;
  maxArticleCharsToSend: number;
  uiLanguage: string;
};

export const DEFAULT_SETTINGS: RuntimeSettings = {
  modelMap: 'claude-haiku-4-5',
  modelFinal: 'claude-sonnet-4-5',
  promptCachingEnabled: true,
  promptCachingTtl: '5m',
  hardCostLimitUsd: 1.0,
  approvalThresholdUsd: 1.0,
  approvalThresholdChars: 100_000,
  minArticleChars: 600,
  maxArticleCharsToSend: 200_000,
  uiLanguage: 'auto'
};
