// Reading/writing runtime settings in chrome.storage.local (shared by background and options).

import { STORAGE_KEYS } from './constants.ts';
import { normalizeApprovalThresholds } from './approval.ts';
import {
  BULLET_STYLES,
  type BulletStyle,
  DEFAULT_BULLET_STYLE,
  type RuntimeSettings,
  DEFAULT_SETTINGS
} from './types.ts';
import { parseNumberOr } from './utils.ts';

// Storage keys backing RuntimeSettings (the API key is stored separately).
export const SETTINGS_STORAGE_KEYS = [
  STORAGE_KEYS.MODEL_MAP,
  STORAGE_KEYS.MODEL_FINAL,
  STORAGE_KEYS.PROMPT_CACHING_ENABLED,
  STORAGE_KEYS.PROMPT_CACHING_TTL,
  STORAGE_KEYS.HARD_COST_LIMIT_USD,
  STORAGE_KEYS.APPROVAL_THRESHOLD_USD,
  STORAGE_KEYS.APPROVAL_THRESHOLD_CHARS,
  STORAGE_KEYS.MIN_ARTICLE_CHARS,
  STORAGE_KEYS.MAX_ARTICLE_CHARS_TO_SEND,
  STORAGE_KEYS.UI_LANGUAGE
] as const;

export type StoredSettings = {
  settings: RuntimeSettings;
  // Values to write back when legacy defaults were migrated; undefined when nothing changed.
  migration?: Record<string, number>;
};

export function parseStoredSettings(res: Record<string, any> | undefined): StoredSettings {
  const { approvalThresholdUsd, approvalThresholdChars, migratedUsd, migratedChars } = normalizeApprovalThresholds({
    rawUsd: res?.[STORAGE_KEYS.APPROVAL_THRESHOLD_USD],
    rawChars: res?.[STORAGE_KEYS.APPROVAL_THRESHOLD_CHARS],
    defaultUsd: DEFAULT_SETTINGS.approvalThresholdUsd,
    defaultChars: DEFAULT_SETTINGS.approvalThresholdChars
  });

  const ttl = res?.[STORAGE_KEYS.PROMPT_CACHING_TTL];
  const settings: RuntimeSettings = {
    modelMap: (res?.[STORAGE_KEYS.MODEL_MAP] as string) || DEFAULT_SETTINGS.modelMap,
    modelFinal: (res?.[STORAGE_KEYS.MODEL_FINAL] as string) || DEFAULT_SETTINGS.modelFinal,
    promptCachingEnabled:
      typeof res?.[STORAGE_KEYS.PROMPT_CACHING_ENABLED] === 'boolean'
        ? res[STORAGE_KEYS.PROMPT_CACHING_ENABLED]
        : DEFAULT_SETTINGS.promptCachingEnabled,
    promptCachingTtl: ttl === '5m' || ttl === '1h' ? ttl : DEFAULT_SETTINGS.promptCachingTtl,
    hardCostLimitUsd: parseNumberOr(res?.[STORAGE_KEYS.HARD_COST_LIMIT_USD], DEFAULT_SETTINGS.hardCostLimitUsd),
    approvalThresholdUsd,
    approvalThresholdChars,
    minArticleChars: Math.floor(parseNumberOr(res?.[STORAGE_KEYS.MIN_ARTICLE_CHARS], DEFAULT_SETTINGS.minArticleChars)),
    maxArticleCharsToSend: Math.floor(
      parseNumberOr(res?.[STORAGE_KEYS.MAX_ARTICLE_CHARS_TO_SEND], DEFAULT_SETTINGS.maxArticleCharsToSend)
    ),
    uiLanguage: (res?.[STORAGE_KEYS.UI_LANGUAGE] as string) || DEFAULT_SETTINGS.uiLanguage
  };

  if (!migratedUsd && !migratedChars) return { settings };
  return {
    settings,
    migration: {
      ...(migratedUsd ? { [STORAGE_KEYS.APPROVAL_THRESHOLD_USD]: approvalThresholdUsd } : {}),
      ...(migratedChars ? { [STORAGE_KEYS.APPROVAL_THRESHOLD_CHARS]: approvalThresholdChars } : {})
    }
  };
}

export function settingsToStorage(settings: RuntimeSettings): Record<string, unknown> {
  return {
    [STORAGE_KEYS.MODEL_MAP]: settings.modelMap,
    [STORAGE_KEYS.MODEL_FINAL]: settings.modelFinal,
    [STORAGE_KEYS.PROMPT_CACHING_ENABLED]: settings.promptCachingEnabled,
    [STORAGE_KEYS.PROMPT_CACHING_TTL]: settings.promptCachingTtl,
    [STORAGE_KEYS.HARD_COST_LIMIT_USD]: settings.hardCostLimitUsd,
    [STORAGE_KEYS.APPROVAL_THRESHOLD_USD]: settings.approvalThresholdUsd,
    [STORAGE_KEYS.APPROVAL_THRESHOLD_CHARS]: settings.approvalThresholdChars,
    [STORAGE_KEYS.MIN_ARTICLE_CHARS]: settings.minArticleChars,
    [STORAGE_KEYS.MAX_ARTICLE_CHARS_TO_SEND]: settings.maxArticleCharsToSend,
    [STORAGE_KEYS.UI_LANGUAGE]: settings.uiLanguage || 'auto'
  };
}

export function isBulletStyle(value: unknown): value is BulletStyle {
  return (BULLET_STYLES as readonly unknown[]).includes(value);
}

export function parseBulletStyle(value: unknown): BulletStyle {
  return isBulletStyle(value) ? value : DEFAULT_BULLET_STYLE;
}
