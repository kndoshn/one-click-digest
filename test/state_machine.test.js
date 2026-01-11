import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

function loadStateMachine() {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/state_machine.js']);
  assert.ok(ctx.AS, 'AS namespace should exist after loading scripts');
  return ctx.AS;
}

test('State machine: happy path (IDLE → EXTRACTING → PREFLIGHT → CONFIRM → SUMMARIZING → DONE)', () => {
  const AS = loadStateMachine();

  const runId = 'r1';
  const article = {
    ok: true,
    title: 'T',
    url: 'https://example.com',
    text: 'hello world '.repeat(100),
    charCount: 1200,
    linkDensity: 0.1
  };

  let state = AS.StateMachine.initialState('auto', 'BULLETS_5');
  state = AS.StateMachine.reduce(state, { type: 'SETTINGS_LOADED', apiKeySet: true });
  assert.equal(state.phase, 'IDLE');
  assert.equal(state.apiKeySet, true);

  state = AS.StateMachine.reduce(state, { type: 'START_RUN', runId });
  assert.equal(state.phase, 'EXTRACTING');
  assert.equal(state.runId, runId);

  state = AS.StateMachine.reduce(state, { type: 'EXTRACT_OK', runId, article });
  assert.equal(state.phase, 'PREFLIGHT');
  assert.equal(state.runId, runId);
  assert.equal(state.article.title, 'T');

  const est = {
    ...state.estimate,
    charCount: article.charCount,
    tokenLow: 100,
    tokenHigh: 120,
    chunkCount: 1,
    costLowUsd: 0.01,
    costHighUsd: 0.02,
    costWorstUsd: 0.03,
    timeLowSec: 3,
    timeHighSec: 8,
    truncated: false,
    sentCharCount: article.text.length
  };
  state = AS.StateMachine.reduce(state, { type: 'PREFLIGHT_READY', runId, estimate: est, refining: true });
  assert.equal(state.phase, 'PREFLIGHT');
  assert.equal(state.refining, true);
  assert.equal(state.estimate.costWorstUsd, 0.03);

  state = AS.StateMachine.reduce(state, { type: 'NEEDS_CONFIRM', runId, estimate: state.estimate, note: 'note' });
  assert.equal(state.phase, 'CONFIRM');
  assert.equal(state.note, 'note');

  state = AS.StateMachine.reduce(state, { type: 'START_SUMMARY', runId });
  assert.equal(state.phase, 'SUMMARIZING');
  assert.equal(state.runId, runId);

  state = AS.StateMachine.reduce(state, {
    type: 'SUMMARY_PROGRESS',
    runId,
    stage: 'MAP',
    current: 1,
    total: 2
  });
  assert.equal(state.phase, 'SUMMARIZING');
  assert.equal(state.progress.stage, 'MAP');
  assert.equal(state.progress.current, 1);
  assert.equal(state.progress.total, 2);

  state = AS.StateMachine.reduce(state, {
    type: 'SUMMARY_DONE',
    runId,
    summaryText: '- a\n- b\n- c',
    usage: { input_tokens: 10, output_tokens: 20 }
  });
  assert.equal(state.phase, 'DONE');
  assert.equal(state.summaryText.includes('- a'), true);
});

test('State machine: ignores stale runId events', () => {
  const AS = loadStateMachine();

  let state = AS.StateMachine.initialState('auto', 'BULLETS_3');
  state = AS.StateMachine.reduce(state, { type: 'START_RUN', runId: 'r1' });
  assert.equal(state.phase, 'EXTRACTING');

  const otherArticle = {
    ok: true,
    title: 'Other',
    url: 'https://example.com/other',
    text: 'x'.repeat(1000),
    charCount: 1000,
    linkDensity: 0.1
  };

  // Wrong runId should not transition.
  state = AS.StateMachine.reduce(state, { type: 'EXTRACT_OK', runId: 'r2', article: otherArticle });
  assert.equal(state.phase, 'EXTRACTING');
  assert.equal(state.runId, 'r1');
});
