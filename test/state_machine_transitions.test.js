// State machine transitions beyond the happy path: which events each phase accepts or ignores.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

function load() {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/state_machine.js']);
  return ctx.AS;
}

const AS = load();
const reduce = (state, event) => AS.StateMachine.reduce(state, event);
const plain = (v) => JSON.parse(JSON.stringify(v));

const ARTICLE = { ok: true, title: 'T', url: 'https://e.com', text: 'x'.repeat(1000), charCount: 1000, linkDensity: 0 };
const estimate = (over = {}) => ({
  charCount: 1000,
  tokenLow: 200,
  tokenHigh: 300,
  chunkCount: 1,
  costLowUsd: 0.01,
  costHighUsd: 0.02,
  costWorstUsd: 0.03,
  timeLowSec: 4,
  timeHighSec: 26,
  model: 'm',
  mapModel: 'm',
  finalModel: 'f',
  maxOutputTokens: 700,
  truncated: false,
  sentCharCount: 1000,
  ...over
});

function preflight(runId = 'r1') {
  // A non-default bullet style shows that every transition carries it over.
  let s = AS.StateMachine.initialState('auto', 'BULLETS_5', 'number');
  s = reduce(s, { type: 'SETTINGS_LOADED', apiKeySet: true });
  s = reduce(s, { type: 'START_RUN', runId });
  s = reduce(s, { type: 'EXTRACT_OK', runId, article: ARTICLE });
  return reduce(s, { type: 'PREFLIGHT_READY', runId, estimate: estimate(), refining: true });
}

function confirm(runId = 'r1') {
  return reduce(preflight(runId), { type: 'NEEDS_CONFIRM', runId, estimate: estimate(), note: 'n' });
}

function summarizing(runId = 'r1', est = estimate()) {
  return reduce(reduce(preflight(runId), { type: 'TOKENS_REFINED', runId, estimate: est }), {
    type: 'START_SUMMARY',
    runId
  });
}

test('EXTRACT_OK seeds a placeholder estimate from the selected mode', () => {
  let s = AS.StateMachine.initialState('auto', 'TLDR_12_CONCLUSION');
  s = reduce(s, { type: 'START_RUN', runId: 'r1' });
  s = reduce(s, { type: 'EXTRACT_OK', runId: 'r1', article: ARTICLE });
  assert.equal(s.phase, 'PREFLIGHT');
  assert.equal(s.estimate.maxOutputTokens, 1600);
  assert.equal(s.estimate.charCount, 1000);
  assert.equal(s.refining, false);
});

test('START_RUN keeps selections but drops the banner and previous run data', () => {
  const s = reduce({ ...confirm(), banner: 'old', selectedLanguage: 'ja' }, { type: 'START_RUN', runId: 'r2' });
  assert.deepEqual(plain(s), {
    phase: 'EXTRACTING',
    runId: 'r2',
    selectedLanguage: 'ja',
    selectedMode: 'BULLETS_5',
    bulletStyle: 'number',
    apiKeySet: true
  });
});

test('BOOTSTRAP resets to IDLE with the given selections and keeps the banner', () => {
  const s = reduce({ ...confirm(), banner: 'kept' }, { type: 'BOOTSTRAP', language: 'fr', mode: 'BULLETS_3' });
  assert.deepEqual(plain(s), {
    phase: 'IDLE',
    selectedLanguage: 'fr',
    selectedMode: 'BULLETS_3',
    bulletStyle: 'number',
    apiKeySet: false,
    banner: 'kept'
  });
});

test('EXTRACT_FAIL only applies to the extracting run', () => {
  let s = reduce(AS.StateMachine.initialState('auto', 'BULLETS_5'), { type: 'START_RUN', runId: 'r1' });
  assert.equal(reduce(s, { type: 'EXTRACT_FAIL', runId: 'other', message: 'x' }), s);
  s = reduce(s, { type: 'EXTRACT_FAIL', runId: 'r1', message: 'too short' });
  assert.equal(s.phase, 'ERROR');
  assert.equal(s.message, 'too short');
  assert.equal('runId' in s, false);
  // Not extracting any more: ignored.
  const p = preflight();
  assert.equal(reduce(p, { type: 'EXTRACT_FAIL', runId: 'r1', message: 'late' }), p);
});

test('TOKENS_REFINED: clears refining in PREFLIGHT, updates CONFIRM, ignored elsewhere', () => {
  const refined = estimate({ tokenExact: 999 });

  const p = reduce(preflight(), { type: 'TOKENS_REFINED', runId: 'r1', estimate: refined });
  assert.equal(p.refining, false);
  assert.equal(p.estimate.tokenExact, 999);

  const c = reduce(confirm(), { type: 'TOKENS_REFINED', runId: 'r1', estimate: refined });
  assert.equal(c.phase, 'CONFIRM');
  assert.equal(c.estimate.tokenExact, 999);
  assert.equal(c.note, 'n');

  const s = summarizing();
  assert.equal(reduce(s, { type: 'TOKENS_REFINED', runId: 'r1', estimate: refined }), s);
  assert.equal(
    reduce(preflight(), { type: 'TOKENS_REFINED', runId: 'stale', estimate: refined }).estimate.tokenExact,
    undefined
  );
  const idle = AS.StateMachine.initialState('auto', 'BULLETS_5');
  assert.equal(reduce(idle, { type: 'TOKENS_REFINED', runId: 'r1', estimate: refined }), idle);
});

test('BLOCKED is accepted before the run (PREFLIGHT/CONFIRM) and while summarizing', () => {
  const over = estimate({ costWorstUsd: 5 });
  for (const s of [preflight(), confirm(), summarizing()]) {
    const b = reduce({ ...s, banner: 'b' }, { type: 'BLOCKED', runId: 'r1', estimate: over, reason: 'limit' });
    assert.deepEqual(plain(b), {
      phase: 'BLOCKED',
      runId: 'r1',
      selectedLanguage: 'auto',
      selectedMode: 'BULLETS_5',
      bulletStyle: 'number',
      apiKeySet: true,
      banner: 'b',
      estimate: over,
      reason: 'limit'
    });
  }
  const done = reduce(summarizing(), { type: 'SUMMARY_DONE', runId: 'r1', summaryText: '- A' });
  assert.equal(reduce(done, { type: 'BLOCKED', runId: 'r1', estimate: over, reason: 'limit' }), done);
  const s = summarizing();
  assert.equal(reduce(s, { type: 'BLOCKED', runId: 'stale', estimate: over, reason: 'limit' }), s);
  const p = preflight();
  assert.equal(reduce(p, { type: 'BLOCKED', runId: 'stale', estimate: over, reason: 'limit' }), p);
});

test('NEEDS_CONFIRM requires PREFLIGHT for the same run', () => {
  const c = confirm();
  assert.equal(reduce(c, { type: 'NEEDS_CONFIRM', runId: 'r1', estimate: estimate() }), c);
  const p = preflight();
  assert.equal(reduce(p, { type: 'NEEDS_CONFIRM', runId: 'stale', estimate: estimate() }), p);
});

test('START_SUMMARY: single-pass vs map progress, and only from PREFLIGHT/CONFIRM of the same run', () => {
  assert.deepEqual(plain(summarizing().progress), { stage: 'SINGLE' });
  assert.deepEqual(plain(summarizing('r1', estimate({ chunkCount: 4 })).progress), {
    stage: 'MAP',
    current: 0,
    total: 4
  });

  const fromConfirm = reduce(confirm(), { type: 'START_SUMMARY', runId: 'r1' });
  assert.equal(fromConfirm.phase, 'SUMMARIZING');
  assert.equal('note' in fromConfirm, false);

  const p = preflight();
  assert.equal(reduce(p, { type: 'START_SUMMARY', runId: 'stale' }), p);
  const s = summarizing();
  assert.equal(reduce(s, { type: 'START_SUMMARY', runId: 'r1' }), s);
});

test('SUMMARY_PROGRESS / SUMMARY_DONE / SUMMARY_ERROR apply only while summarizing the same run', () => {
  const s = summarizing();
  const progressed = reduce(s, { type: 'SUMMARY_PROGRESS', runId: 'r1', stage: 'REPAIR' });
  assert.deepEqual(plain(progressed.progress), { stage: 'REPAIR' });
  assert.equal(reduce(s, { type: 'SUMMARY_PROGRESS', runId: 'stale', stage: 'REPAIR' }), s);

  const done = reduce(s, { type: 'SUMMARY_DONE', runId: 'r1', summaryText: '- A', usage: { input_tokens: 1 } });
  assert.equal(done.phase, 'DONE');
  assert.equal(done.summaryText, '- A');
  assert.equal(done.article, ARTICLE);
  assert.equal(done.bulletStyle, 'number');
  assert.equal(reduce(done, { type: 'SUMMARY_PROGRESS', runId: 'r1', stage: 'MAP' }), done);
  assert.equal(reduce(done, { type: 'SUMMARY_ERROR', runId: 'r1', message: 'late' }), done);
  assert.equal(reduce(s, { type: 'SUMMARY_DONE', runId: 'stale', summaryText: 'x' }), s);

  const err = reduce({ ...s, banner: 'b' }, { type: 'SUMMARY_ERROR', runId: 'r1', message: 'boom' });
  assert.deepEqual(plain(err), {
    phase: 'ERROR',
    selectedLanguage: 'auto',
    selectedMode: 'BULLETS_5',
    bulletStyle: 'number',
    apiKeySet: true,
    banner: 'b',
    message: 'boom'
  });
});

test('the bullet style defaults to dash, changes in any phase, and survives RESET', () => {
  assert.equal(AS.StateMachine.initialState('auto', 'BULLETS_5').bulletStyle, 'dash');

  const done = reduce(summarizing(), { type: 'SUMMARY_DONE', runId: 'r1', summaryText: '- A' });
  const changed = reduce(done, { type: 'BULLET_STYLE_CHANGED', bulletStyle: 'dot' });
  assert.deepEqual(plain(changed), { ...plain(done), bulletStyle: 'dot' });

  const busy = reduce(preflight(), { type: 'BULLET_STYLE_CHANGED', bulletStyle: 'dash' });
  assert.equal(busy.phase, 'PREFLIGHT');
  assert.equal(busy.bulletStyle, 'dash');

  assert.equal(reduce(changed, { type: 'RESET' }).bulletStyle, 'dot');
});

test('PREFLIGHT_READY applies only to PREFLIGHT of the same run', () => {
  const c = confirm();
  assert.equal(reduce(c, { type: 'PREFLIGHT_READY', runId: 'r1', estimate: estimate(), refining: false }), c);
  const p = preflight();
  assert.equal(reduce(p, { type: 'PREFLIGHT_READY', runId: 'stale', estimate: estimate(), refining: false }), p);
});

test('unknown events leave the state unchanged', () => {
  const p = preflight();
  assert.equal(reduce(p, { type: 'NOPE' }), p);
});

test('isBusy covers the phases with work in flight or pending approval', () => {
  const busy = ['EXTRACTING', 'PREFLIGHT', 'CONFIRM', 'SUMMARIZING'];
  for (const phase of ['IDLE', 'EXTRACTING', 'PREFLIGHT', 'CONFIRM', 'SUMMARIZING', 'DONE', 'ERROR', 'BLOCKED']) {
    assert.equal(AS.isBusy({ phase }), busy.includes(phase), phase);
  }
});
