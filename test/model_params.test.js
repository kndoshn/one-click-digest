import test from 'node:test';
import assert from 'node:assert/strict';

import { modelRequestParams } from '../dist/shared/model_params.js';

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
  for (const model of ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'unknown-model']) {
    assert.deepEqual(modelRequestParams(model), {}, model);
  }
});

test('modelRequestParams: returns a fresh object on each call', () => {
  const a = modelRequestParams('claude-haiku-5-5');
  a.thinking = { type: 'adaptive' };
  assert.deepEqual(modelRequestParams('claude-haiku-5-5'), { thinking: { type: 'disabled' } });
});
