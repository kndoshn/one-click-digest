import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runContentBundle } from './helpers/classic_context.js';

function loadFormat() {
  const ctx = createClassicContext();
  runContentBundle(ctx);
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

test('Format.tidyLayout: trims lines and puts exactly one blank line between non-empty lines', () => {
  const AS = loadFormat();
  assert.equal(AS.Format.tidyLayout('  - a\r\n- b\n\n\n- c  \n\n'), '- a\n\n- b\n\n- c');
  assert.equal(AS.Format.tidyLayout('\n\n'), '');
});

test('Format.tidyLayout: bullets and TLDR lines without blank lines become valid', () => {
  const AS = loadFormat();
  assert.equal(AS.Format.validate('BULLETS_3', AS.Format.tidyLayout('- a\n- b\n- c')).ok, true);
  const bullets = Array.from({ length: 12 }, (_, i) => `- bullet ${i + 1}`).join('\n');
  const tldr = ['要約: 一行', bullets, '結論: 最後の一行'].join('\n');
  assert.equal(AS.Format.validate('TLDR_12_CONCLUSION', AS.Format.tidyLayout(tldr)).ok, true);
});

test('Format.tidyLayout: does not merge lines, so stray text still fails validation', () => {
  const AS = loadFormat();
  const tidied = AS.Format.tidyLayout('Here is the summary:\n- a\n- b\n- c');
  assert.equal(tidied, 'Here is the summary:\n\n- a\n\n- b\n\n- c');
  assert.equal(AS.Format.validate('BULLETS_3', tidied).ok, false);
  assert.equal(AS.Format.validate('BULLETS_3', AS.Format.tidyLayout('- a\ncontinued\n- b\n- c')).ok, false);
});

test('Format.normalizeSummaryText: trims lines and folds continuation lines into the previous bullet', () => {
  const AS = loadFormat();
  const n = AS.Format.normalizeSummaryText;
  assert.equal(n('  - A\n  continued.\n\n- B.  '), '- A continued.\n\n- B.');
  assert.equal(n('- A\r\nmore\r\n\r\n- B'), '- A more\n\n- B');
  // Continuations attach across blank lines to the last non-empty bullet.
  assert.equal(n('- A\n\ntail'), '- A tail');
  // Text before any bullet stays on its own line; header lines are kept as-is.
  assert.equal(n('intro\n- A'), 'intro\n- A');
  assert.equal(n('Summary: s\n\n- A\n\nConclusion: c\nextra'), 'Summary: s\n\n- A\n\nConclusion: c\nextra');
  assert.equal(n(''), '');
});

test('Format.isLikelyTruncatedOutput: detects a last line that ends mid-word', () => {
  const AS = loadFormat();
  const f = AS.Format.isLikelyTruncatedOutput;
  assert.equal(f('- A.\n\n- B is cut', 'en'), true);
  assert.equal(f('- A.\n\n- B 42', 'en'), true);
  assert.equal(f('- A.\n\n- B done.', 'en'), false);
  assert.equal(f('- A.\n\n- B (note)', 'en'), false);
  assert.equal(f('- A.\n\n- B「引用」', 'en'), false);
  assert.equal(f('- A.\n\n- B —', 'en'), false);
  assert.equal(f('', 'en'), false);
  assert.equal(f('-  \n\n', 'en'), false);
  // Japanese bullets intentionally omit the trailing "。".
  assert.equal(f('- 一つ目のポイントです', 'ja'), false);
  assert.equal(f('- 一つ目のポイントです', 'ja-JP'), false);
  assert.equal(f('- 一つ目のポイントです', 'en'), true);
  assert.equal(f('- Japanese text ends with ascii', 'ja'), true);
});

test('Format: TLDR mode accepts the labels the background prompts ask for, in every output language', async () => {
  const AS = loadFormat();
  const { buildSinglePrompt } = await import('../src/background/prompts.ts');
  const languages = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'];
  for (const language of languages) {
    const prompt = buildSinglePrompt({ title: 'T', url: 'u', language, mode: 'TLDR_12_CONCLUSION', articleText: 'x' });
    const [, summary] = prompt.match(/^(.+): <one line>$/m);
    const conclusion = prompt.match(/^(.+): <one line>$/gm)[1].replace(': <one line>', '');
    const text = [`${summary}: one line`, '', bulletBlock(12), '', `${conclusion}: last line`].join('\n');
    assert.equal(AS.Format.validate('TLDR_12_CONCLUSION', text).ok, true, `${language}: ${summary} / ${conclusion}`);
  }
});

test('Format: TLDR mode accepts full-width colons after CJK labels', () => {
  const AS = loadFormat();
  const pairs = [
    ['要約', '結論'],
    ['摘要', '结论'],
    ['摘要', '結論'],
    ['요약', '결론']
  ];
  for (const [summary, conclusion] of pairs) {
    const text = [`${summary}：一行`, '', bulletBlock(12), '', `${conclusion} ：最後`].join('\n');
    assert.equal(AS.Format.validate('TLDR_12_CONCLUSION', text).ok, true, `${summary} / ${conclusion}`);
  }
  assert.equal(AS.Format.isSummaryLine('要約：一行'), true);
  assert.equal(AS.Format.isConclusionLine('  結論：最後'), true);
  // A label alone (no colon) is still not a header line.
  assert.equal(AS.Format.isSummaryLine('要約 一行'), false);
});

test('Format.normalizeSummaryText: a full-width-colon Conclusion line is not folded into the last bullet', () => {
  const AS = loadFormat();
  const text = '要約：概要\n\n- 一つ目\n\n- 二つ目\n\n結論：まとめ';
  assert.equal(AS.Format.normalizeSummaryText(text), text);
});

test('Format: TLDR validation reports why the structure is wrong', () => {
  const AS = loadFormat();
  const reason = (lines) => AS.Format.validate('TLDR_12_CONCLUSION', lines.join('\n')).reason;
  assert.equal(reason(['- bullet', '', 'Summary: s']), 'Missing Summary line');
  assert.equal(reason(['Summary: s', '', bulletBlock(12)]), 'Missing Conclusion line');
  assert.equal(reason(['Summary: s', bulletBlock(12), '', 'Conclusion: c']), 'Missing blank line after Summary line');
  assert.equal(
    reason(['Summary: s', '', bulletBlock(12), 'Conclusion: c']),
    'Missing blank line before Conclusion line'
  );
  assert.equal(
    reason(['Summary: s', '', bulletBlock(12), '', 'Conclusion: c', '', 'P.S.']),
    'Unexpected content after Conclusion line'
  );
  assert.match(reason(['Summary: s', '', bulletBlock(11), '', 'Conclusion: c']), /Expected 12 bullets/);
  assert.equal(
    reason(['Summary: s', '', bulletBlock(11), '', 'Summary: again', '', 'Conclusion: c']),
    'Unexpected header in bullet block'
  );
});

test('Format.applyBulletStyle: swaps the marker of bullet lines only', () => {
  const AS = loadFormat();
  const text = '- 一つ目\n\n- 二つ目\n\n- 三つ目';
  assert.equal(AS.Format.applyBulletStyle(text, 'dash'), text);
  assert.equal(AS.Format.applyBulletStyle(text, 'dot'), '・一つ目\n\n・二つ目\n\n・三つ目');
  assert.equal(AS.Format.applyBulletStyle(text, 'number'), '1. 一つ目\n\n2. 二つ目\n\n3. 三つ目');
});

test('Format.applyBulletStyle: TL;DR numbering counts bullets only and leaves Summary/Conclusion as is', () => {
  const AS = loadFormat();
  const text = ['要約: 概要', '', bulletBlock(12), '', '結論: まとめ'].join('\n');
  const lines = AS.Format.applyBulletStyle(text, 'number').split('\n');
  assert.equal(lines[0], '要約: 概要');
  assert.equal(lines[2], '1. bullet 1');
  assert.equal(lines[24], '12. bullet 12');
  assert.equal(lines[26], '結論: まとめ');
  assert.equal(lines.length, text.split('\n').length);
});

test('Format.applyBulletStyle: other markers the model may write are rewritten too', () => {
  const AS = loadFormat();
  const text = '* a\n\n• b\n\n3) c\n\n・ d\n\n7. e';
  assert.equal(AS.Format.applyBulletStyle(text, 'dash'), '- a\n\n- b\n\n- c\n\n- d\n\n- e');
  assert.equal(AS.Format.applyBulletStyle(text, 'number'), '1. a\n\n2. b\n\n3. c\n\n4. d\n\n5. e');
  // Switching styles back and forth is lossless.
  const numbered = AS.Format.applyBulletStyle('- a\n\n- b', 'number');
  assert.equal(AS.Format.applyBulletStyle(numbered, 'dash'), '- a\n\n- b');
});
