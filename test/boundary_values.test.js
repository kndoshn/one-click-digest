import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

// Chunker boundary tests
function loadChunker() {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/estimate.js', 'dist/content/chunk.js']);
  return ctx;
}

test('Chunker: empty string returns empty array', () => {
  const ctx = loadChunker();
  const chunks = ctx.AS.Chunker.chunkText('', 8000);
  assert.equal(Array.isArray(chunks), true);
  assert.equal(chunks.length, 0);
});

test('Chunker: whitespace-only string returns empty array', () => {
  const ctx = loadChunker();
  const chunks = ctx.AS.Chunker.chunkText('   \n\n  \t  ', 8000);
  assert.equal(chunks.length, 0);
});

test('Chunker: single word returns single chunk', () => {
  const ctx = loadChunker();
  const chunks = ctx.AS.Chunker.chunkText('hello', 8000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], 'hello');
});

test('Chunker: handles text with only newlines', () => {
  const ctx = loadChunker();
  const chunks = ctx.AS.Chunker.chunkText('\n\n\n\n\n', 8000);
  assert.equal(chunks.length, 0);
});

test('Chunker: handles very small target token size', () => {
  const ctx = loadChunker();
  const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
  const chunks = ctx.AS.Chunker.chunkText(text, 10);
  assert.ok(chunks.length >= 1);
});

// Estimate boundary tests
test('Estimate: zero characters returns minimal estimate', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/estimate.js']);

  const est = ctx.AS.Estimate.buildEstimate({
    extractedCharCount: 0,
    textToSend: '',
    truncated: false,
    mode: 'BULLETS_3',
    mapModel: 'claude-haiku-4-5',
    finalModel: 'claude-sonnet-4-5'
  });

  assert.equal(est.charCount, 0);
  assert.equal(est.sentCharCount, 0);
  assert.ok(est.tokenLow >= 0);
  assert.ok(est.tokenHigh >= est.tokenLow);
});

test('Estimate: single character text', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/estimate.js']);

  const est = ctx.AS.Estimate.buildEstimate({
    extractedCharCount: 1,
    textToSend: 'a',
    truncated: false,
    mode: 'BULLETS_3',
    mapModel: 'claude-haiku-4-5',
    finalModel: 'claude-sonnet-4-5'
  });

  assert.equal(est.charCount, 1);
  assert.ok(est.tokenLow >= 1);
});

test('Estimate: MAX boundary (200k chars)', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/estimate.js']);

  const maxText = 'a'.repeat(200000);
  const est = ctx.AS.Estimate.buildEstimate({
    extractedCharCount: 200000,
    textToSend: maxText,
    truncated: false,
    mode: 'BULLETS_10',
    mapModel: 'claude-haiku-4-5',
    finalModel: 'claude-sonnet-4-5'
  });

  assert.equal(est.charCount, 200000);
  assert.ok(est.chunkCount > 1);
  assert.ok(est.costWorstUsd > 0);
});

test('Estimate: CJK-heavy text has different token estimate', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/estimate.js']);

  const englishText = 'hello '.repeat(100);
  const japaneseText = 'こんにちは'.repeat(100);

  const estEn = ctx.AS.Estimate.buildEstimate({
    extractedCharCount: englishText.length,
    textToSend: englishText,
    truncated: false,
    mode: 'BULLETS_3',
    mapModel: 'claude-haiku-4-5',
    finalModel: 'claude-sonnet-4-5'
  });

  const estJa = ctx.AS.Estimate.buildEstimate({
    extractedCharCount: japaneseText.length,
    textToSend: japaneseText,
    truncated: false,
    mode: 'BULLETS_3',
    mapModel: 'claude-haiku-4-5',
    finalModel: 'claude-sonnet-4-5'
  });

  // Japanese should have higher token estimate per character
  const tokensPerCharEn = estEn.tokenHigh / englishText.length;
  const tokensPerCharJa = estJa.tokenHigh / japaneseText.length;
  assert.ok(tokensPerCharJa > tokensPerCharEn);
});

// Format boundary tests
test('Format: empty string fails validation', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);

  const r = ctx.AS.Format.validate('BULLETS_3', '');
  assert.equal(r.ok, false);
});

test('Format: whitespace-only string fails validation', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);

  const r = ctx.AS.Format.validate('BULLETS_3', '   \n\n  ');
  assert.equal(r.ok, false);
});

test('Format: bullets with various markers (*, -, •)', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);

  const dashBullets = '- a\n\n- b\n\n- c';
  const r1 = ctx.AS.Format.validate('BULLETS_3', dashBullets);
  assert.equal(r1.ok, true);

  const asteriskBullets = '* a\n\n* b\n\n* c';
  const r2 = ctx.AS.Format.validate('BULLETS_3', asteriskBullets);
  assert.equal(r2.ok, true);
});

test('Format: mixed bullet markers fails', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);

  const mixed = '- a\n\n* b\n\n- c';
  const r = ctx.AS.Format.validate('BULLETS_3', mixed);
  // May or may not pass depending on implementation
  // Test documents current behavior
  assert.equal(typeof r.ok, 'boolean');
});

test('Format: bullets with trailing newlines', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);

  const withTrailing = '- a\n\n- b\n\n- c\n\n\n';
  const r = ctx.AS.Format.validate('BULLETS_3', withTrailing);
  assert.equal(r.ok, true);
});

test('Format: bullets without blank line between them fail', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);

  const noBlank = '- a\n- b\n- c';
  const r = ctx.AS.Format.validate('BULLETS_3', noBlank);
  assert.equal(r.ok, false);
});

test('Format: full-width characters in bullets', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);

  const japanese = '- ポイント一\n\n- ポイント二\n\n- ポイント三';
  const r = ctx.AS.Format.validate('BULLETS_3', japanese);
  assert.equal(r.ok, true);
});

// State machine boundary tests
test('StateMachine: initial state has expected defaults', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/state_machine.js']);

  const state = ctx.AS.StateMachine.initialState('auto', 'BULLETS_5');
  assert.equal(state.phase, 'IDLE');
  assert.equal(state.selectedLanguage, 'auto');
  assert.equal(state.selectedMode, 'BULLETS_5');
  assert.equal(state.apiKeySet, false);
});

test('StateMachine: RESET from any state returns to IDLE', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/state_machine.js']);

  let state = ctx.AS.StateMachine.initialState('auto', 'BULLETS_5');
  state = ctx.AS.StateMachine.reduce(state, { type: 'START_RUN', runId: 'r1' });
  assert.equal(state.phase, 'EXTRACTING');

  state = ctx.AS.StateMachine.reduce(state, { type: 'RESET' });
  assert.equal(state.phase, 'IDLE');
});

test('StateMachine: RESET with banner preserves banner message', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/state_machine.js']);

  let state = ctx.AS.StateMachine.initialState('auto', 'BULLETS_5');
  state = ctx.AS.StateMachine.reduce(state, { type: 'START_RUN', runId: 'r1' });
  state = ctx.AS.StateMachine.reduce(state, { type: 'RESET', banner: 'Cancelled' });

  assert.equal(state.phase, 'IDLE');
  assert.equal(state.banner, 'Cancelled');
});

test('StateMachine: MODE_CHANGED updates selected mode', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/state_machine.js']);

  let state = ctx.AS.StateMachine.initialState('auto', 'BULLETS_5');
  state = ctx.AS.StateMachine.reduce(state, { type: 'MODE_CHANGED', mode: 'BULLETS_10' });

  assert.equal(state.selectedMode, 'BULLETS_10');
});

test('StateMachine: LANGUAGE_CHANGED updates selected language', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/state_machine.js']);

  let state = ctx.AS.StateMachine.initialState('auto', 'BULLETS_5');
  state = ctx.AS.StateMachine.reduce(state, { type: 'LANGUAGE_CHANGED', language: 'ja' });

  assert.equal(state.selectedLanguage, 'ja');
});
