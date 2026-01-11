import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

function loadEstimate() {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/estimate.js']);
  assert.ok(ctx.AS?.Estimate, 'AS.Estimate should exist');
  return ctx;
}

test('Estimate: costWorst includes repair and is monotonic', () => {
  const ctx = loadEstimate();
  const { AS } = ctx;

  const est = AS.Estimate.buildEstimate({
    extractedCharCount: 2000,
    textToSend: 'hello '.repeat(400),
    truncated: false,
    mode: 'BULLETS_5',
    mapModel: AS.MODEL_MAP,
    finalModel: AS.MODEL_FINAL
  });

  assert.ok(est.costLowUsd <= est.costHighUsd, 'costLow <= costHigh');
  assert.ok(est.costHighUsd <= est.costWorstUsd, 'costHigh <= costWorst (repair included)');
  assert.ok(est.costWorstUsd > 0, 'costWorst > 0');
});

test('Estimate: hard limit uses costWorst', () => {
  const ctx = loadEstimate();
  const { AS } = ctx;

  const est = AS.Estimate.buildEstimate({
    extractedCharCount: 2000,
    textToSend: 'hello '.repeat(400),
    truncated: false,
    mode: 'BULLETS_3',
    mapModel: AS.MODEL_MAP,
    finalModel: AS.MODEL_FINAL
  });

  // Force an extremely low hard limit; should now be over.
  AS.HARD_COST_LIMIT_USD = 0.000001;
  assert.equal(AS.Estimate.isOverHardLimit(est), true);
});

test('Estimate: truncated always requires approval', () => {
  const ctx = loadEstimate();
  const { AS } = ctx;

  const est = AS.Estimate.buildEstimate({
    extractedCharCount: 500000,
    textToSend: 'x'.repeat(1000),
    truncated: true,
    mode: 'BULLETS_5',
    mapModel: AS.MODEL_MAP,
    finalModel: AS.MODEL_FINAL
  });

  assert.equal(AS.Estimate.needsApproval(est), true);
});

test('Estimate: prompt caching write multiplier affects cost estimate when prefix is long enough', () => {
  const ctx = loadEstimate();
  const { AS } = ctx;

  const longText = 'a'.repeat(180_000);

  // Baseline: caching disabled
  AS.PROMPT_CACHING_ENABLED = false;
  const noCache = AS.Estimate.buildEstimate({
    extractedCharCount: longText.length,
    textToSend: longText,
    truncated: false,
    mode: 'BULLETS_10',
    mapModel: 'claude-haiku-4-5',
    finalModel: 'claude-sonnet-4-5'
  });

  // With caching enabled + 1h TTL (higher write multiplier)
  AS.PROMPT_CACHING_ENABLED = true;
  AS.PROMPT_CACHING_TTL = '1h';
  const cache1h = AS.Estimate.buildEstimate({
    extractedCharCount: longText.length,
    textToSend: longText,
    truncated: false,
    mode: 'BULLETS_10',
    mapModel: 'claude-haiku-4-5',
    finalModel: 'claude-sonnet-4-5'
  });

  // Worst-case estimate assumes cache write, so should not be cheaper than no-cache.
  assert.ok(cache1h.costHighUsd >= noCache.costHighUsd);
  assert.ok(cache1h.costWorstUsd >= noCache.costWorstUsd);
});
