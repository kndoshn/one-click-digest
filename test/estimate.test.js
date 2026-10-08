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

test('Estimate: defaults are Claude Haiku 5.5 (map) and Claude Sonnet 5.5 (final)', () => {
  const { AS } = loadEstimate();
  assert.equal(AS.MODEL_MAP, 'claude-haiku-5-5');
  assert.equal(AS.MODEL_FINAL, 'claude-sonnet-5-5');
  assert.ok(AS.PRICING['claude-haiku-5-5']);
  assert.ok(AS.PRICING['claude-sonnet-5-5']);
});

test('Estimate: Haiku 5.5 is much cheaper than Haiku 4.5 for the same article', () => {
  const { AS } = loadEstimate();
  const text = 'hello '.repeat(2000);
  const build = (mapModel) =>
    AS.Estimate.buildEstimate({
      extractedCharCount: text.length,
      textToSend: text,
      truncated: false,
      mode: 'BULLETS_5',
      mapModel,
      finalModel: 'claude-sonnet-5-5'
    });

  const est45 = build('claude-haiku-4-5');
  const est55 = build('claude-haiku-5-5');
  assert.equal(est55.chunkCount, 1);
  // ~1/10 the unit price, offset by ~1.3x tokenizer inflation.
  assert.ok(est55.costHighUsd < est45.costHighUsd * 0.2, `${est55.costHighUsd} vs ${est45.costHighUsd}`);
});

test('Estimate: rough token estimate is inflated for models on the newer tokenizer', () => {
  const { AS } = loadEstimate();
  const text = 'hello '.repeat(2000);
  const build = (mapModel) =>
    AS.Estimate.buildEstimate({
      extractedCharCount: text.length,
      textToSend: text,
      truncated: false,
      mode: 'BULLETS_5',
      mapModel,
      finalModel: 'claude-sonnet-5-5'
    });

  const est45 = build('claude-haiku-4-5');
  const est55 = build('claude-haiku-5-5');
  assert.ok(est55.tokenHigh > est45.tokenHigh);
  assert.ok(est55.tokenLow > est45.tokenLow);
});

test('Estimate: resolvePricing switches Haiku 5.5 to long-context rates above 100K input tokens', () => {
  const { AS } = loadEstimate();

  const short = AS.resolvePricing('claude-haiku-5-5', 100_000);
  assert.equal(short.inputUsdPerMTok, 0.1);
  assert.equal(short.outputUsdPerMTok, 0.5);

  const long = AS.resolvePricing('claude-haiku-5-5', 100_001);
  assert.equal(long.inputUsdPerMTok, 0.5);
  assert.equal(long.outputUsdPerMTok, 2.5);

  // Flat-priced models ignore the request size.
  const sonnet = AS.resolvePricing('claude-sonnet-5-5', 500_000);
  assert.equal(sonnet.inputUsdPerMTok, 2.0);
  assert.equal(sonnet.outputUsdPerMTok, 10.0);
});
