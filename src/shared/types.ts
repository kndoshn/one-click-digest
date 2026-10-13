// Shared type definitions across extension contexts (background, options, content).

import { DEFAULT_FINAL_MODEL, DEFAULT_MAP_MODEL } from './models.ts';

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
  modelMap: DEFAULT_MAP_MODEL,
  modelFinal: DEFAULT_FINAL_MODEL,
  promptCachingEnabled: true,
  promptCachingTtl: '5m',
  hardCostLimitUsd: 1.0,
  approvalThresholdUsd: 1.0,
  approvalThresholdChars: 100_000,
  minArticleChars: 600,
  maxArticleCharsToSend: 200_000,
  uiLanguage: 'auto'
};

// How the result screen marks bullet points. The model always writes "- "; the overlay swaps the
// marker for display and copy. Stored on its own (STORAGE_KEYS.BULLET_STYLE), outside
// RuntimeSettings, so saving the options page never overwrites the style picked in the overlay.
export type BulletStyle = 'dash' | 'dot' | 'number';

export const BULLET_STYLES: readonly BulletStyle[] = ['dash', 'dot', 'number'];

export const DEFAULT_BULLET_STYLE: BulletStyle = 'dash';
