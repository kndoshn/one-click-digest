import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Overlay: unmount stops animation timers (regression guard)', () => {
  const p = path.join(process.cwd(), 'src', 'content', 'overlay.ts');
  const text = fs.readFileSync(p, 'utf-8');
  const idxUnmount = text.indexOf('export function unmount');
  assert.ok(idxUnmount >= 0);

  const snip = text.slice(idxUnmount, idxUnmount + 600);
  assert.ok(/stopDots\(\)/.test(snip), 'unmount should stop the dots interval');
});
