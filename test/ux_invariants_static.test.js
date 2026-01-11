import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

test('UX invariants (static): 4 modes are defined', () => {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js']);
  assert.ok(ctx.AS?.MODE_OPTIONS, 'MODE_OPTIONS should exist');
  assert.equal(ctx.AS.MODE_OPTIONS.length, 4);
});

test('UX invariants (static): closing while busy asks for confirmation and aborts', () => {
  const p = path.join(process.cwd(), 'src', 'content', 'controller.ts');
  const text = fs.readFileSync(p, 'utf-8');

  // Must show confirmation on close while running.
  assert.ok(text.includes('confirmCloseWhileRunning'));
  // Must abort in-flight request on confirmed close.
  assert.ok(/abortInFlight\(\)/.test(text));
});

test('UX invariants (static): Copy shows a post-copy toast', () => {
  const p = path.join(process.cwd(), 'src', 'content', 'controller.ts');
  const text = fs.readFileSync(p, 'utf-8');
  assert.ok(text.includes("toastCopied"));
});

test('UX invariants (static): DONE language change triggers full re-run', () => {
  const p = path.join(process.cwd(), 'src', 'content', 'controller.ts');
  const text = fs.readFileSync(p, 'utf-8');
  // Language change handler should re-run when currently DONE.
  assert.ok(/if \(ctx\.state\.phase === 'DONE'\)\s*\{\s*startRun\(/s.test(text));
});