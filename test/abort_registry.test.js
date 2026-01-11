import test from 'node:test';
import assert from 'node:assert/strict';

import { createAbortRegistry } from '../dist/background/abort_registry.js';

test('AbortRegistry: register does not abort, abortRun aborts all controllers for runId', () => {
  const reg = createAbortRegistry();

  const runId = 'run-1';
  const c1 = new AbortController();
  const c2 = new AbortController();

  reg.register(runId, c1);
  reg.register(runId, c2);

  assert.equal(reg._debugCountControllers(runId), 2);
  assert.equal(c1.signal.aborted, false);
  assert.equal(c2.signal.aborted, false);

  // Registering a new controller must not abort previous ones.
  const c3 = new AbortController();
  reg.register(runId, c3);
  assert.equal(c1.signal.aborted, false);
  assert.equal(c2.signal.aborted, false);
  assert.equal(c3.signal.aborted, false);
  assert.equal(reg._debugCountControllers(runId), 3);

  // Unregister should remove just the specified controller.
  reg.unregister(runId, c2);
  assert.equal(reg._debugCountControllers(runId), 2);
  assert.equal(c1.signal.aborted, false);
  assert.equal(c2.signal.aborted, false);
  assert.equal(c3.signal.aborted, false);

  // Abort should abort remaining controllers and clear the run entry.
  const aborted = reg.abortRun(runId);
  assert.equal(aborted, true);
  assert.equal(c1.signal.aborted, true);
  assert.equal(c3.signal.aborted, true);
  assert.equal(reg._debugCountControllers(runId), 0);
  assert.equal(reg._debugCountRuns(), 0);
});
