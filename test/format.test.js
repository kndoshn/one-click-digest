import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

function loadFormat() {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);
  assert.ok(ctx.AS?.Format, 'AS.Format should exist');
  return ctx.AS;
}

function bulletBlock(count) {
  return Array.from({ length: count }, (_, i) => `- bullet ${i + 1}`).join('\n\n');
}

test('Format: bullet-only mode enforces exact bullet count with blank lines between bullets', () => {
  const AS = loadFormat();
  const ok = '- a\n\n- b\n\n- c';
  {
    const r = AS.Format.validate('BULLETS_3', ok);
    assert.equal(r.ok, true);
  }

  const bad = '- a\n\n- b';
  const r = AS.Format.validate('BULLETS_3', bad);
  assert.equal(r.ok, false);
});

test('Format: bullet-only mode rejects bullets without a blank line between them', () => {
  const AS = loadFormat();
  const r = AS.Format.validate('BULLETS_3', '- a\n- b\n- c');
  assert.equal(r.ok, false);
});

test('Format: TLDR mode requires Summary line, blank lines, 12 bullets separated by blank lines, and Conclusion line', () => {
  const AS = loadFormat();

  const ok = ['Summary: one line', '', bulletBlock(12), '', 'Conclusion: last line'].join('\n');

  {
    const r = AS.Format.validate('TLDR_12_CONCLUSION', ok);
    assert.equal(r.ok, true);
  }

  const missing = ['Summary: one line', '', bulletBlock(11), '', 'Conclusion: last line'].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', missing);
  assert.equal(r.ok, false);
});

test('Format: TLDR mode rejects bullets without a blank line between them', () => {
  const AS = loadFormat();
  const noBlanks = [
    'Summary: one line',
    '',
    ...Array.from({ length: 12 }, (_, i) => `- bullet ${i + 1}`),
    '',
    'Conclusion: last line'
  ].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', noBlanks);
  assert.equal(r.ok, false);
});

test('Format: TLDR mode accepts Japanese labels with blank lines', () => {
  const AS = loadFormat();
  const ok = ['要約: one line', '', bulletBlock(12), '', '結論: last line'].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', ok);
  assert.equal(r.ok, true);
});

test('Format: TLDR mode accepts localized Summary labels with blank lines', () => {
  const AS = loadFormat();
  const ok = ['Resumen: one line', '', bulletBlock(12), '', 'Conclusion: last line'].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', ok);
  assert.equal(r.ok, true);
});

test('Format: TLDR mode requires blank lines between header/body and body/conclusion', () => {
  const AS = loadFormat();
  const bad = ['Summary: one line', bulletBlock(12), 'Conclusion: last line'].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', bad);
  assert.equal(r.ok, false);
});

test('Format: bullet-only mode rejects Summary/Conclusion headers', () => {
  const AS = loadFormat();
  // Same total line count as a valid 3-bullet block (5 lines), but the first
  // bullet slot is a header — isolates the header-rejection branch from the
  // line-count check.
  const text = 'Summary: header\n\n- b\n\n- c';
  const r = AS.Format.validate('BULLETS_3', text);
  assert.equal(r.ok, false);
  assert.match(r.reason, /header/i);
});

test('Format: bullet-only mode rejects extra non-bullet lines', () => {
  const AS = loadFormat();
  // Same total line count as a valid 3-bullet block (5 lines), but one bullet
  // slot is replaced with plain text — isolates the non-bullet-line check from
  // the line-count check.
  const text = '- a\n\nnote\n\n- c';
  const r = AS.Format.validate('BULLETS_3', text);
  assert.equal(r.ok, false);
  assert.match(r.reason, /bullet/i);
});

test('Format: TLDR mode rejects extra non-empty lines', () => {
  const AS = loadFormat();
  const text = ['Summary: one line', '', bulletBlock(12), '', 'Conclusion: last line', 'extra'].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', text);
  assert.equal(r.ok, false);
});
