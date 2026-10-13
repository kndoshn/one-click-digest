import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FINAL_MODEL,
  DEFAULT_MAP_MODEL,
  MODELS,
  PRICING_CHECKED_ON,
  findModel,
  isKnownModel,
  modelRequestParams
} from '../src/shared/models.ts';

test('modelRequestParams: Haiku 5.5 disables thinking', () => {
  assert.deepEqual(modelRequestParams('claude-haiku-5-5'), { thinking: { type: 'disabled' } });
});

test('modelRequestParams: Sonnet 5.5 keeps adaptive thinking at medium effort', () => {
  const params = modelRequestParams('claude-sonnet-5-5');
  assert.deepEqual(params, { output_config: { effort: 'medium' } });
  // Sonnet 5.5 rejects thinking.type "disabled" with a 400.
  assert.equal('thinking' in params, false);
});

test('modelRequestParams: older and unknown models get no extra params', () => {
  for (const model of [
    'claude-haiku-4-5',
    'claude-sonnet-4-5',
    'claude-sonnet-4-6',
    'claude-sonnet-5',
    'unknown-model'
  ]) {
    assert.deepEqual(modelRequestParams(model), {}, model);
  }
});

test('modelRequestParams: returns a fresh object on each call', () => {
  const a = modelRequestParams('claude-haiku-5-5');
  a.thinking = { type: 'adaptive' };
  assert.deepEqual(modelRequestParams('claude-haiku-5-5'), { thinking: { type: 'disabled' } });
});

test('MODELS: unique IDs, defaults included, sane per-model values', () => {
  const ids = MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(isKnownModel(DEFAULT_MAP_MODEL));
  assert.ok(isKnownModel(DEFAULT_FINAL_MODEL));
  for (const m of MODELS) {
    assert.match(m.id, /^claude-[a-z0-9-]+$/, m.id);
    assert.ok(m.name.startsWith('Claude '), m.id);
    assert.ok(m.pricing.inputUsdPerMTok > 0 && m.pricing.outputUsdPerMTok > m.pricing.inputUsdPerMTok, m.id);
    const lc = m.pricing.longContext;
    if (lc) assert.ok(lc.inputUsdPerMTok >= m.pricing.inputUsdPerMTok && lc.thresholdInputTokens > 0, m.id);
    assert.ok(m.tokenizerInflation >= 1, m.id);
    assert.ok(Number.isInteger(m.cacheMinTokens) && m.cacheMinTokens > 0, m.id);
  }
  assert.match(PRICING_CHECKED_ON, /^\d{4}-\d{2}-\d{2}$/);
});

test('isKnownModel / findModel', () => {
  assert.equal(findModel('claude-sonnet-5-5')?.name, 'Claude Sonnet 5.5');
  assert.equal(findModel('claude-3-opus'), undefined);
  for (const v of ['claude-3-opus', '', undefined, null, 1]) assert.equal(isKnownModel(v), false, String(v));
});
