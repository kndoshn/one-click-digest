// Controller flows not covered by the message-sequence tests: automatic mode downgrade, cost
// blocking, the light run, copy, language re-runs, and how failures are reported.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerEnv,
  injectAndWaitIdle,
  lastError,
  phaseOf,
  shortArticle,
  tick,
  waitFor
} from './helpers/controller_env.js';

const VALID_3 = '- A.\n\n- B.\n\n- C.';
const VALID_5 = '- A.\n\n- B.\n\n- C.\n\n- D.\n\n- E.';

function longArticle() {
  // Three ~20K-char paragraphs: each becomes its own chunk (8K-token target).
  const paras = ['First paragraph. ', 'Second paragraph. ', 'Third paragraph. '].map((s) => s.repeat(Math.ceil(20_000 / s.length)).trim());
  return shortArticle(paras.join('\n\n'));
}

async function runToPhase(env, inst, mode, phase) {
  env.dispatch(inst, 'as:mode', { mode });
  await waitFor(() => phaseOf(inst) === phase);
}

test('a short article downgrades the selected mode and says so in a banner', async () => {
  const cases = [
    // [selected mode, article chars, expected mode]
    ['BULLETS_10', 'Hello world. '.repeat(70), 'BULLETS_5'],
    ['TLDR_12_CONCLUSION', 'Hello world. '.repeat(20), 'BULLETS_3'],
    ['TLDR_12_CONCLUSION', 'Hello world. '.repeat(200), 'BULLETS_10']
  ];
  for (const [selected, text, expected] of cases) {
    const env = createControllerEnv({
      extract: () => shortArticle(text),
      respond: (m) => (m.type === 'RUN_SUMMARY_SINGLE' ? { ok: true, text: VALID_3 } : { ok: false, code: 'unhandled' })
    });
    const inst = await injectAndWaitIdle(env);
    env.dispatch(inst, 'as:mode', { mode: selected });
    await waitFor(() => env.sent.length > 0);

    assert.equal(env.sent[0].payload.mode, expected, `${selected} with ${text.length} chars`);
    const preflight = inst.states.find((s) => s.phase === 'PREFLIGHT' || s.phase === 'SUMMARIZING');
    assert.equal(preflight.selectedMode, expected);
    assert.equal(preflight.banner, `toastModeAdjusted(${{ BULLETS_3: 'mode3Label', BULLETS_5: 'mode5Label', BULLETS_10: 'mode10Label' }[expected]})`);
  }
});

test('a mode the article is long enough for is kept without a banner', async () => {
  const env = createControllerEnv({
    respond: (m) => (m.type === 'RUN_SUMMARY_SINGLE' ? { ok: true, text: VALID_5 } : { ok: false, code: 'unhandled' })
  });
  const inst = await injectAndWaitIdle(env);
  await runToPhase(env, inst, 'BULLETS_5', 'DONE');
  assert.equal(env.sent[0].payload.mode, 'BULLETS_5');
  assert.equal(inst.lastState.banner, undefined);
  assert.equal(inst.lastState.summaryText, VALID_5);
});

test('an estimate over the hard limit is blocked before any API call, and Back resets', async () => {
  const env = createControllerEnv({ settings: { minArticleChars: 50, hardCostLimitUsd: 0.000001 } });
  const inst = await injectAndWaitIdle(env);
  await runToPhase(env, inst, 'BULLETS_3', 'BLOCKED');

  assert.equal(inst.lastState.reason, 'reasonHardLimit');
  assert.ok(inst.lastState.estimate.costWorstUsd > 0.000001);
  assert.deepEqual(env.sent, []);

  env.dispatch(inst, 'as:reset');
  assert.equal(phaseOf(inst), 'IDLE');
  assert.equal(inst.lastState.banner, undefined);
});

test('a token count that pushes the estimate over the hard limit blocks the run', async () => {
  const env = createControllerEnv({
    settings: { minArticleChars: 50, approvalThresholdChars: 1000, hardCostLimitUsd: 0.05 },
    respond: (m) => (m.type === 'COUNT_TOKENS' ? { ok: true, inputTokens: 2_000_000 } : { ok: false, code: 'unhandled' })
  });
  const inst = await injectAndWaitIdle(env);
  await runToPhase(env, inst, 'BULLETS_3', 'BLOCKED');

  assert.equal(inst.lastState.estimate.tokenExact, 2_000_000 + 256);
  assert.ok(inst.lastState.estimate.costWorstUsd > 0.05);
  assert.deepEqual(
    env.sent.map((m) => m.type),
    ['COUNT_TOKENS']
  );
});

test('a token count that fails at the messaging layer keeps the rough estimate', async () => {
  const env = createControllerEnv({
    settings: { minArticleChars: 50, approvalThresholdChars: 1000 },
    respond: (m) => (m.type === 'COUNT_TOKENS' ? lastError('Could not establish connection.') : { ok: false, code: 'unhandled' })
  });
  const inst = await injectAndWaitIdle(env);
  await runToPhase(env, inst, 'BULLETS_3', 'PREFLIGHT');
  await waitFor(() => inst.lastState.refining === false);
  assert.equal(inst.lastState.estimate.tokenExact, undefined);
  assert.ok(inst.lastState.estimate.tokenHigh > 0);
});

test('Run light from the approval screen runs 3 bullets with a re-estimated budget', async () => {
  const env = createControllerEnv({
    settings: { minArticleChars: 50, approvalThresholdChars: 1000 },
    respond: (m) => {
      if (m.type === 'COUNT_TOKENS') return { ok: true, inputTokens: 700 };
      if (m.type === 'RUN_SUMMARY_SINGLE') return { ok: true, text: VALID_3 };
      return { ok: false, code: 'unhandled' };
    }
  });
  const inst = await injectAndWaitIdle(env);
  await runToPhase(env, inst, 'BULLETS_10', 'PREFLIGHT');
  await waitFor(() => inst.lastState.refining === false);
  assert.equal(inst.lastState.estimate.maxOutputTokens, 1200);

  env.dispatch(inst, 'as:proceed');
  assert.equal(phaseOf(inst), 'CONFIRM');
  env.dispatch(inst, 'as:runLight');
  await waitFor(() => phaseOf(inst) === 'DONE');

  assert.deepEqual(
    env.sent.map((m) => [m.type, m.payload.mode]),
    [
      ['COUNT_TOKENS', undefined],
      ['RUN_SUMMARY_SINGLE', 'BULLETS_3']
    ]
  );
  assert.equal(inst.lastState.selectedMode, 'BULLETS_3');
  const summarizing = inst.states.find((s) => s.phase === 'SUMMARIZING');
  assert.equal(summarizing.estimate.maxOutputTokens, 450);
});

test('Proceed, Run, Run light and Copy are ignored outside their screens', async () => {
  const env = createControllerEnv();
  const inst = await injectAndWaitIdle(env);
  const renders = inst.renders;
  for (const type of ['as:proceed', 'as:run', 'as:runLight', 'as:copy']) env.dispatch(inst, type);
  await tick();
  assert.equal(inst.renders, renders);
  assert.deepEqual(env.sent, []);
  assert.deepEqual(env.toasts, []);
});

test('Copy in the result screen copies the summary and reports success or failure', async () => {
  const env = createControllerEnv({
    respond: (m) => (m.type === 'RUN_SUMMARY_SINGLE' ? { ok: true, text: VALID_3 } : { ok: false, code: 'unhandled' })
  });
  const inst = await injectAndWaitIdle(env);
  await runToPhase(env, inst, 'BULLETS_3', 'DONE');

  env.dispatch(inst, 'as:copy');
  await waitFor(() => env.toasts.length === 1);
  assert.equal(env.copied, VALID_3);
  assert.equal(env.toasts[0], 'toastCopied');

  env.copyResult = false;
  env.dispatch(inst, 'as:copy');
  await waitFor(() => env.toasts.length === 2);
  assert.equal(env.toasts[1], 'toastCopyFailed');
});

test('changing the output language re-runs a finished summary, and is used by the next run otherwise', async () => {
  const env = createControllerEnv({
    respond: (m) => (m.type === 'RUN_SUMMARY_SINGLE' ? { ok: true, text: VALID_3 } : { ok: false, code: 'unhandled' })
  });
  const inst = await injectAndWaitIdle(env);

  // Before a run: only the selection changes.
  env.dispatch(inst, 'as:language', { language: 'fr' });
  await tick();
  assert.deepEqual(env.sent, []);
  assert.equal(inst.lastState.selectedLanguage, 'fr');

  await runToPhase(env, inst, 'BULLETS_3', 'DONE');
  assert.equal(env.sent[0].payload.language, 'fr');

  // In DONE: a full re-run in the new language, same mode.
  env.dispatch(inst, 'as:language', { language: 'ja' });
  await waitFor(() => env.sent.length === 2 && phaseOf(inst) === 'DONE');
  assert.equal(env.sent[1].payload.language, 'ja');
  assert.equal(env.sent[1].payload.mode, 'BULLETS_3');
  assert.notEqual(env.sent[1].payload.runId, env.sent[0].payload.runId);

  // Back to auto: the first accept-language.
  env.dispatch(inst, 'as:language', {});
  await waitFor(() => env.sent.length === 3 && phaseOf(inst) === 'DONE');
  assert.equal(env.sent[2].payload.language, 'en-US');
});

test('background errors are shown with a friendly message and diagnostics', async () => {
  const cases = [
    [{ ok: false, code: 'invalid_request_error', message: 'bad', status: 400 }, 'errorBadRequest\n(code=invalid_request_error, status=400)'],
    [{ ok: false, code: 'overloaded_error', message: 'busy' }, 'errorRateLimit\n(code=overloaded_error)'],
    [{ ok: false, code: 'api_error', message: 'oops', status: 503 }, 'errorServer\n(code=api_error, status=503)'],
    [{ ok: false, code: 'weird', message: 'Something odd' }, 'Something odd\n(code=weird)'],
    [{ ok: false }, 'errorUnknown'],
    [undefined, 'errorUnknown'],
    // A text response that is not a string is not a summary.
    [{ ok: true, text: 42 }, 'errorUnknown'],
    // A messaging failure (e.g. the extension was reloaded) surfaces its message.
    [lastError('Extension context invalidated.'), 'Extension context invalidated.']
  ];
  let next;
  const env = createControllerEnv({ respond: (m) => (m.type === 'RUN_SUMMARY_SINGLE' ? next : { ok: false, code: 'unhandled' }) });
  const inst = await injectAndWaitIdle(env);

  for (const [resp, expected] of cases) {
    next = resp;
    await runToPhase(env, inst, 'BULLETS_3', 'ERROR');
    assert.equal(inst.lastState.message, expected);
    env.dispatch(inst, 'as:reset');
    assert.equal(phaseOf(inst), 'IDLE');
  }
});

test('a failed reduce stops a map-reduce run with an error', async () => {
  const env = createControllerEnv({
    settings: { minArticleChars: 50, approvalThresholdChars: 1000 },
    extract: () => longArticle(),
    respond: (m) => {
      if (m.type === 'COUNT_TOKENS') return { ok: false, code: 'network_error', status: 0 };
      if (m.type === 'RUN_SUMMARY_MAP') return { ok: true, text: `- point ${m.payload.chunkIndex}` };
      if (m.type === 'RUN_SUMMARY_REDUCE') return { ok: false, code: 'invalid_request_error', status: 400 };
      return { ok: false, code: 'unhandled' };
    }
  });
  const inst = await injectAndWaitIdle(env);
  await runToPhase(env, inst, 'BULLETS_3', 'PREFLIGHT');
  await waitFor(() => inst.lastState.refining === false);
  env.dispatch(inst, 'as:proceed');
  env.dispatch(inst, 'as:run');
  await waitFor(() => phaseOf(inst) === 'ERROR');

  assert.equal(inst.lastState.message, 'errorBadRequest\n(code=invalid_request_error, status=400)');
  assert.deepEqual(
    env.sent.map((m) => m.type),
    ['COUNT_TOKENS', 'RUN_SUMMARY_MAP', 'RUN_SUMMARY_MAP', 'RUN_SUMMARY_MAP', 'RUN_SUMMARY_REDUCE']
  );
  const progress = inst.states.filter((s) => s.phase === 'SUMMARIZING').map((s) => s.progress);
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), [
    { stage: 'MAP', current: 0, total: 3 },
    { stage: 'MAP', current: 1, total: 3 },
    { stage: 'MAP', current: 2, total: 3 },
    { stage: 'MAP', current: 3, total: 3 },
    { stage: 'REDUCE' }
  ]);
});

test('extraction failures map to their messages', async () => {
  const cases = [
    [{ ok: false, code: 'NO_MAIN_TEXT', message: 'x' }, 'errorNoMainText'],
    [{ ok: false, code: 'UNKNOWN', message: 'x' }, 'errorExtractionFailed'],
    [{ ok: false, code: 'SOMETHING_NEW', message: 'x' }, 'errorExtractionFailed']
  ];
  let next;
  const env = createControllerEnv({ extract: () => next });
  const inst = await injectAndWaitIdle(env);
  for (const [result, expected] of cases) {
    next = result;
    await runToPhase(env, inst, 'BULLETS_3', 'ERROR');
    assert.equal(inst.lastState.message, expected);
    env.dispatch(inst, 'as:reset');
  }

  // An exception thrown by the extractor is reported too.
  next = undefined;
  const env2 = createControllerEnv({
    extract: () => {
      throw new Error('boom');
    }
  });
  const inst2 = await injectAndWaitIdle(env2);
  await runToPhase(env2, inst2, 'BULLETS_3', 'ERROR');
  assert.equal(inst2.lastState.message, 'boom');
  assert.deepEqual(env2.sent, []);
});

test('a bootstrap failure is logged instead of thrown', async () => {
  const env = createControllerEnv();
  env.mountError = new Error('mount failed');
  env.inject();
  await waitFor(() => env.errors.length > 0);
  assert.equal(env.errors[0][0], '[ArticleSummarizer] bootstrap failed');
  assert.equal(env.errors[0][1].message, 'mount failed');
});
