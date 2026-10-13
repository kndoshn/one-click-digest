import test from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_KEYS } from '../src/shared/constants.ts';
import { DEFAULT_SETTINGS } from '../src/shared/types.ts';
import {
  SETTINGS_STORAGE_KEYS,
  parseBulletStyle,
  parseStoredSettings,
  settingsToStorage
} from '../src/shared/settings.ts';

test('SETTINGS_STORAGE_KEYS covers every setting key but not the API key or the bullet style', () => {
  // The bullet style is saved from the overlay; keeping it out of the settings means saving the
  // options page never overwrites it with a stale value.
  const expected = Object.values(STORAGE_KEYS).filter(
    (k) => k !== STORAGE_KEYS.CLAUDE_API_KEY && k !== STORAGE_KEYS.BULLET_STYLE
  );
  assert.deepEqual([...SETTINGS_STORAGE_KEYS].sort(), expected.sort());
});

test('parseStoredSettings: empty storage yields defaults without migration', () => {
  assert.deepEqual(parseStoredSettings({}), { settings: DEFAULT_SETTINGS });
  assert.deepEqual(parseStoredSettings(undefined), { settings: DEFAULT_SETTINGS });
});

test('parseStoredSettings: replaces models that are no longer offered with the defaults', () => {
  const { settings, unavailableModels, migration } = parseStoredSettings({
    modelMap: 'claude-3-haiku',
    modelFinal: 'claude-3-opus'
  });
  assert.equal(settings.modelMap, DEFAULT_SETTINGS.modelMap);
  assert.equal(settings.modelFinal, DEFAULT_SETTINGS.modelFinal);
  assert.deepEqual(unavailableModels, ['claude-3-haiku', 'claude-3-opus']);
  // Not written back: the options page asks the user to save.
  assert.equal(migration, undefined);

  // Non-string or empty values are not reported (they just fall back).
  assert.deepEqual(parseStoredSettings({ modelMap: '', modelFinal: 42 }), { settings: DEFAULT_SETTINGS });
});

test('parseStoredSettings: keeps valid stored values', () => {
  const stored = {
    modelMap: 'claude-haiku-4-5',
    modelFinal: 'claude-sonnet-5',
    promptCachingEnabled: false,
    promptCachingTtl: '1h',
    hardCostLimitUsd: 0.5,
    approvalThresholdUsd: 0.3,
    approvalThresholdChars: 40_000,
    minArticleChars: 300,
    maxArticleCharsToSend: 50_000,
    uiLanguage: 'ja'
  };
  assert.deepEqual(parseStoredSettings(stored), { settings: stored });
});

test('parseStoredSettings: coerces and falls back for malformed values', () => {
  const { settings, migration } = parseStoredSettings({
    modelMap: '',
    promptCachingEnabled: 'false',
    promptCachingTtl: 'bogus',
    hardCostLimitUsd: 'abc',
    approvalThresholdChars: '1234.9',
    minArticleChars: '700.9',
    maxArticleCharsToSend: null
  });
  assert.equal(migration, undefined);
  assert.equal(settings.modelMap, DEFAULT_SETTINGS.modelMap);
  assert.equal(settings.promptCachingEnabled, DEFAULT_SETTINGS.promptCachingEnabled);
  assert.equal(settings.promptCachingTtl, '5m');
  assert.equal(settings.hardCostLimitUsd, DEFAULT_SETTINGS.hardCostLimitUsd);
  assert.equal(settings.approvalThresholdChars, 1234);
  assert.equal(settings.minArticleChars, 700);
  assert.equal(settings.maxArticleCharsToSend, DEFAULT_SETTINGS.maxArticleCharsToSend);
});

test('parseStoredSettings: reports legacy approval defaults for write-back', () => {
  assert.deepEqual(parseStoredSettings({ approvalThresholdUsd: 0.25 }).migration, {
    approvalThresholdUsd: DEFAULT_SETTINGS.approvalThresholdUsd
  });
  assert.deepEqual(parseStoredSettings({ approvalThresholdChars: '25000' }).migration, {
    approvalThresholdChars: DEFAULT_SETTINGS.approvalThresholdChars
  });
  assert.deepEqual(parseStoredSettings({ approvalThresholdUsd: '0.25', approvalThresholdChars: 25_000 }).migration, {
    approvalThresholdUsd: DEFAULT_SETTINGS.approvalThresholdUsd,
    approvalThresholdChars: DEFAULT_SETTINGS.approvalThresholdChars
  });
});

test('settingsToStorage round-trips through parseStoredSettings', () => {
  /** @type {import('../src/shared/types.ts').RuntimeSettings} */
  const settings = { ...DEFAULT_SETTINGS, modelMap: 'claude-haiku-4-5', promptCachingTtl: '1h', uiLanguage: 'fr' };
  assert.deepEqual(parseStoredSettings(settingsToStorage(settings)), { settings });
});

test('settingsToStorage stores an empty UI language as auto', () => {
  assert.equal(settingsToStorage({ ...DEFAULT_SETTINGS, uiLanguage: '' }).uiLanguage, 'auto');
});

test('parseStoredSettings: blank numeric strings fall back to the defaults (not 0)', () => {
  const { settings } = parseStoredSettings({
    hardCostLimitUsd: '',
    approvalThresholdUsd: ' ',
    approvalThresholdChars: '',
    minArticleChars: '',
    maxArticleCharsToSend: ''
  });
  assert.deepEqual(settings, DEFAULT_SETTINGS);
});

test('parseBulletStyle: keeps the known styles and falls back to dash', () => {
  for (const style of ['dash', 'dot', 'number']) assert.equal(parseBulletStyle(style), style);
  for (const bad of [undefined, null, '', 'DOT', 'bullet', 1]) assert.equal(parseBulletStyle(bad), 'dash');
});
