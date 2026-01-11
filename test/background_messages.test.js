import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../dist/shared/constants.js';
import { DEFAULT_SETTINGS } from '../dist/shared/types.js';
import { createAbortRegistry } from '../dist/background/abort_registry.js';

test('Background: STORAGE_KEYS exports expected keys', () => {
  assert.ok(STORAGE_KEYS.CLAUDE_API_KEY, 'CLAUDE_API_KEY should exist');
  assert.ok(STORAGE_KEYS.MODEL_MAP, 'MODEL_MAP should exist');
  assert.ok(STORAGE_KEYS.MODEL_FINAL, 'MODEL_FINAL should exist');
  assert.ok(STORAGE_KEYS.HARD_COST_LIMIT_USD, 'HARD_COST_LIMIT_USD should exist');
});

test('Background: DEFAULT_SETTINGS has required fields', () => {
  assert.ok(DEFAULT_SETTINGS, 'DEFAULT_SETTINGS should exist');
  assert.equal(typeof DEFAULT_SETTINGS.modelMap, 'string');
  assert.equal(typeof DEFAULT_SETTINGS.modelFinal, 'string');
  assert.equal(typeof DEFAULT_SETTINGS.hardCostLimitUsd, 'number');
  assert.equal(typeof DEFAULT_SETTINGS.promptCachingEnabled, 'boolean');
  assert.ok(DEFAULT_SETTINGS.hardCostLimitUsd > 0, 'hardCostLimitUsd should be positive');
});

test('Background: AbortRegistry tracks and aborts controllers', () => {
  const registry = createAbortRegistry();
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  registry.register('run1', controller1);
  registry.register('run1', controller2);

  assert.equal(controller1.signal.aborted, false);
  assert.equal(controller2.signal.aborted, false);

  const aborted = registry.abortRun('run1');
  assert.equal(aborted, true);
  assert.equal(controller1.signal.aborted, true);
  assert.equal(controller2.signal.aborted, true);

  // Second call should return false (already aborted/cleared)
  const aborted2 = registry.abortRun('run1');
  assert.equal(aborted2, false);
});

test('Background: AbortRegistry unregister removes specific controller', () => {
  const registry = createAbortRegistry();
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  registry.register('run1', controller1);
  registry.register('run1', controller2);
  registry.unregister('run1', controller1);

  registry.abortRun('run1');

  assert.equal(controller1.signal.aborted, false);
  assert.equal(controller2.signal.aborted, true);
});

test('Background: AbortRegistry handles non-existent runId', () => {
  const registry = createAbortRegistry();
  const aborted = registry.abortRun('non-existent');
  assert.equal(aborted, false);
});

test('Background: DEFAULT_SETTINGS model names are valid', () => {
  assert.ok(DEFAULT_SETTINGS.modelMap.startsWith('claude-'));
  assert.ok(DEFAULT_SETTINGS.modelFinal.startsWith('claude-'));
});

test('Background: DEFAULT_SETTINGS thresholds are reasonable', () => {
  assert.ok(DEFAULT_SETTINGS.hardCostLimitUsd >= 0.01);
  assert.ok(DEFAULT_SETTINGS.hardCostLimitUsd <= 100);
  assert.ok(DEFAULT_SETTINGS.approvalThresholdUsd >= 0);
  assert.ok(DEFAULT_SETTINGS.approvalThresholdChars >= 0);
  assert.ok(DEFAULT_SETTINGS.minArticleChars >= 0);
  assert.ok(DEFAULT_SETTINGS.maxArticleCharsToSend > 0);
});
