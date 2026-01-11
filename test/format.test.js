import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

function loadFormat() {
  const ctx = createClassicContext();
  runClassicScripts(ctx, ['dist/content/models.js', 'dist/content/format.js']);
  assert.ok(ctx.AS?.Format, 'AS.Format should exist');
  return ctx.AS;
}

test('Format: bullet-only mode enforces exact bullet count', () => {
  const AS = loadFormat();
  const ok = '- a\n- b\n- c';
  {
    const r = AS.Format.validate('BULLETS_3', ok);
    assert.equal(r.ok, true);
  }

  const bad = '- a\n- b';
  const r = AS.Format.validate('BULLETS_3', bad);
  assert.equal(r.ok, false);
});

test('Format: TLDR mode requires Summary line, blank lines, 12 bullets, and Conclusion line', () => {
  const AS = loadFormat();

  const ok = [
    'Summary: one line',
    '',
    ...Array.from({ length: 12 }, (_, i) => `- bullet ${i + 1}`),
    '',
    'Conclusion: last line'
  ].join('\n');

  {
    const r = AS.Format.validate('TLDR_12_CONCLUSION', ok);
    assert.equal(r.ok, true);
  }

  const missing = [
    'Summary: one line',
    '',
    ...Array.from({ length: 11 }, (_, i) => `- bullet ${i + 1}`),
    '',
    'Conclusion: last line'
  ].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', missing);
  assert.equal(r.ok, false);
});

test('Format: TLDR mode accepts Japanese labels with blank lines', () => {
  const AS = loadFormat();
  const ok = [
    '要約: one line',
    '',
    ...Array.from({ length: 12 }, (_, i) => `- bullet ${i + 1}`),
    '',
    '結論: last line'
  ].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', ok);
  assert.equal(r.ok, true);
});

test('Format: TLDR mode accepts localized Summary labels with blank lines', () => {
  const AS = loadFormat();
  const ok = [
    'Resumen: one line',
    '',
    ...Array.from({ length: 12 }, (_, i) => `- bullet ${i + 1}`),
    '',
    'Conclusion: last line'
  ].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', ok);
  assert.equal(r.ok, true);
});

test('Format: TLDR mode requires blank lines between header/body and body/conclusion', () => {
  const AS = loadFormat();
  const bad = [
    'Summary: one line',
    ...Array.from({ length: 12 }, (_, i) => `- bullet ${i + 1}`),
    'Conclusion: last line'
  ].join('\n');

  const r = AS.Format.validate('TLDR_12_CONCLUSION', bad);
  assert.equal(r.ok, false);
});

test('Format: bullet-only mode rejects Summary/Conclusion headers', () => {
  const AS = loadFormat();
  const text = 'Summary: header\n- a\n- b\n- c\n';
  const r = AS.Format.validate('BULLETS_3', text);
  assert.equal(r.ok, false);
});
