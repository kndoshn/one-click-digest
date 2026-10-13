// The summarization pipeline (src/content/pipeline.ts) with a scripted transport: which requests it
// sends for short and long articles, when it repairs, and how it reports errors and cancellation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline as runPipelineTyped } from '../src/content/pipeline.ts';

// Results are inspected field by field, so they are treated as untyped here.
/** @type {(...args: Parameters<typeof runPipelineTyped>) => Promise<any>} */
const runPipeline = runPipelineTyped;

/** @type {import('../src/content/pipeline.ts').PipelineOptions} */
const OPTS = {
  runId: 'run_1',
  mode: 'BULLETS_3',
  language: 'en',
  mapModel: 'claude-haiku-5-5',
  finalModel: 'claude-sonnet-5-5',
  chunkTargetTokens: 8_000
};
const SHORT = { title: 'T', url: 'https://e.com/a', text: 'Hello world. '.repeat(100) };
const LONG = {
  ...SHORT,
  text: Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ` + 'Some words in a sentence. '.repeat(40)).join('\n\n')
};
const VALID = '- One.\n\n- Two.\n\n- Three.';

// Replies to each request with the next scripted reply (a string means a successful text reply).
function transport(...replies) {
  const sent = [];
  const send = async (msg) => {
    sent.push(msg);
    const r = replies.length > 1 ? replies.shift() : replies[0];
    const reply = typeof r === 'function' ? r(msg) : r;
    return typeof reply === 'string' ? { ok: true, text: reply, usage: { output_tokens: 7 } } : reply;
  };
  return { send, sent };
}

test('short article: one single-pass request on the map model', async () => {
  const t = transport(VALID);
  const stages = [];
  const r = await runPipeline(SHORT, OPTS, t.send, { onProgress: (s) => stages.push(s) });
  assert.deepEqual(r, {
    status: 'done',
    text: VALID,
    usage: { output_tokens: 7 },
    trace: { chunks: 1, draftValid: true, repairs: [] }
  });
  assert.deepEqual(
    t.sent.map((m) => [m.type, m.payload.model]),
    [['RUN_SUMMARY_SINGLE', 'claude-haiku-5-5']]
  );
  assert.deepEqual(stages, ['SINGLE']);
});

test('invalid format: one repair, accepted when the rewrite is valid', async () => {
  const t = transport('Not bullets at all.', VALID);
  const r = await runPipeline(SHORT, OPTS, t.send);
  assert.equal(r.status, 'done');
  assert.equal(r.text, VALID);
  assert.deepEqual(r.trace, { chunks: 1, draftValid: false, repairs: [{ kind: 'format', accepted: true }] });
  const repair = t.sent[1];
  assert.equal(repair.type, 'RUN_SUMMARY_REPAIR');
  assert.equal(repair.payload.badOutput, 'Not bullets at all.');
  assert.equal(repair.payload.model, 'claude-haiku-5-5');
  assert.equal('fixTruncation' in repair.payload, false);
});

test('a draft with only the blank lines wrong is tidied without a repair', async () => {
  const t = transport('- One.\n- Two.\n\n\n- Three.');
  const r = await runPipeline(SHORT, OPTS, t.send);
  assert.equal(r.text, VALID);
  assert.deepEqual(r.trace, { chunks: 1, draftValid: true, repairs: [] });
  assert.equal(t.sent.length, 1);
});

test('a repair whose only flaw is the blank lines is accepted', async () => {
  const t = transport('Not bullets.', '- One.\n- Two.\n- Three.');
  const r = await runPipeline(SHORT, OPTS, t.send);
  assert.equal(r.text, VALID);
  assert.deepEqual(r.trace.repairs, [{ kind: 'format', accepted: true }]);
});

test('an invalid rewrite is not accepted; the draft is kept', async () => {
  const t = transport('Not bullets.', 'Still not bullets.');
  const r = await runPipeline(SHORT, OPTS, t.send);
  assert.equal(r.text, 'Not bullets.');
  assert.deepEqual(r.trace.repairs, [{ kind: 'format', accepted: false }]);
});

test('a likely truncated ending gets a truncation repair', async () => {
  const cut = '- One.\n\n- Two.\n\n- Three is cut in the mid';
  const t = transport(cut, VALID);
  const r = await runPipeline(SHORT, OPTS, t.send);
  assert.equal(r.text, VALID);
  assert.deepEqual(r.trace.repairs, [{ kind: 'truncation', accepted: true }]);
  assert.equal(t.sent[1].payload.fixTruncation, true);
});

test('long article: map each chunk, reduce on the final model, repair with the chunk summaries', async () => {
  const t = transport((msg) => {
    if (msg.type === 'RUN_SUMMARY_MAP') return `- chunk ${msg.payload.chunkIndex}`;
    return msg.type === 'RUN_SUMMARY_REDUCE' ? 'not bullets.' : VALID;
  });
  const stages = [];
  const r = await runPipeline(LONG, OPTS, t.send, { onProgress: (...a) => stages.push(a.join(':')) });
  const maps = t.sent.filter((m) => m.type === 'RUN_SUMMARY_MAP');
  assert.ok(maps.length > 1);
  assert.equal(r.trace.chunks, maps.length);
  assert.deepEqual(
    maps.map((m) => [m.payload.chunkIndex, m.payload.chunkCount, m.payload.model]),
    maps.map((_, i) => [i + 1, maps.length, 'claude-haiku-5-5'])
  );
  const reduce = t.sent[maps.length];
  assert.equal(reduce.type, 'RUN_SUMMARY_REDUCE');
  assert.equal(reduce.payload.model, 'claude-sonnet-5-5');
  assert.deepEqual(
    reduce.payload.chunkSummaries,
    maps.map((_, i) => `- chunk ${i + 1}`)
  );
  // The reduce output is invalid, so it is repaired on the final model with the same summaries.
  const repair = t.sent[maps.length + 1];
  assert.equal(repair.type, 'RUN_SUMMARY_REPAIR');
  assert.equal(repair.payload.model, 'claude-sonnet-5-5');
  assert.deepEqual(repair.payload.chunkSummaries, reduce.payload.chunkSummaries);
  assert.deepEqual(stages, [...maps.map((_, i) => `MAP:${i + 1}:${maps.length}`), 'REDUCE', 'REPAIR']);
  assert.equal(r.text, VALID);
});

test('an error response ends the run with that error', async () => {
  const error = { ok: false, code: 'rate_limit_error', message: 'slow down', status: 429 };
  const r = await runPipeline(LONG, OPTS, transport(error).send);
  assert.deepEqual(r, { status: 'error', error, trace: { chunks: r.trace.chunks, draftValid: false, repairs: [] } });

  // No response at all (the worker could not answer).
  const none = await runPipeline(SHORT, OPTS, transport(undefined).send);
  assert.equal(none.status, 'error');
  assert.equal(none.error, undefined);
});

test('cancellation stops before the next request', async () => {
  let active = true;
  const t = transport((msg) => {
    active = false;
    return msg.type === 'RUN_SUMMARY_MAP' ? '- chunk' : VALID;
  });
  const r = await runPipeline(LONG, OPTS, t.send, { isActive: () => active });
  assert.deepEqual(r, { status: 'cancelled' });
  assert.equal(t.sent.length, 1);
});
