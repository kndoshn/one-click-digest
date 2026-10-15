// The eval's grading helpers (eval/grade.ts): language detection, summary checks, cost and the
// parsing of the LLM judge's answer.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bulletLength,
  checkSummary,
  costUsd as rawCostUsd,
  formatFailure,
  japaneseRatio,
  languageOk,
  lengthStats,
  lengthUnit,
  parseJudgement,
  sentenceCount
} from '../eval/grade.ts';

// Rounded to a millionth of a dollar, to compare without floating-point noise.
/** @type {typeof rawCostUsd} */
const costUsd = (model, usage) => Math.round(rawCostUsd(model, usage) * 1e6) / 1e6;

test('languageOk: Japanese vs English text', () => {
  assert.equal(languageOk('- 市は新しい病院を建てる。', 'ja'), true);
  assert.equal(languageOk('- The city will build a new hospital.', 'ja'), false);
  assert.equal(languageOk('- The city will build a new hospital.', 'en'), true);
  assert.equal(languageOk('- 市は Kitahara Hospital を統合する。', 'en'), false);
  assert.equal(languageOk('- 123', 'en'), false);
  assert.equal(languageOk('- Die Stadt baut.', 'de'), null);
  // Mostly Japanese, but one bullet stayed in English.
  const mixed = [
    '- 市は新しい病院を建てる。',
    '- 県は道路を直す。',
    '- 国は橋を架ける。',
    '- The town will build a station.'
  ];
  assert.equal(languageOk(mixed.join('\n\n'), 'ja'), false);
  assert.equal(japaneseRatio('...'), null);
});

test('checkSummary: format, bullets, truncation and language', () => {
  assert.deepEqual(checkSummary('BULLETS_3', 'en', '- One.\n\n- Two.\n\n- Three.'), {
    formatValid: true,
    bulletCount: 3,
    expectedBullets: 3,
    truncated: false,
    languageOk: true,
    bulletLengths: [1, 1, 1],
    multiSentenceBullets: 0
  });
  const bad = checkSummary('BULLETS_5', 'en', '- One.\n\n- Two and then');
  assert.equal(bad.formatValid, false);
  assert.equal(bad.bulletCount, 2);
  assert.equal(bad.truncated, true);
});

test('checkSummary: bullet lengths in the unit of the output language, and bullets with several sentences', () => {
  const ja = checkSummary(
    'BULLETS_3',
    'ja',
    '- 市は病院を建てる\n\n- 費用は約10億円。完成は2028年\n\n- 反対意見もある'
  );
  assert.deepEqual(ja.bulletLengths, [8, 17, 7]);
  assert.equal(ja.multiSentenceBullets, 1);
  const en = checkSummary(
    'BULLETS_3',
    'en',
    '- The city builds.\n\n- It costs $1 billion. It opens in 2028.\n\n- Some object.'
  );
  assert.deepEqual(en.bulletLengths, [3, 8, 2]);
  assert.equal(en.multiSentenceBullets, 1);
  // TL;DR: only the bullets count, not the Summary and Conclusion lines.
  const tldr = checkSummary('TLDR_12_CONCLUSION', 'en', 'Summary: a b c d e.\n\n- One two.\n\nConclusion: f g h i.');
  assert.deepEqual(tldr.bulletLengths, [2]);
});

test('lengthUnit: characters for Japanese and Chinese, words for other languages', () => {
  assert.equal(lengthUnit('ja'), 'characters');
  assert.equal(lengthUnit('ja-JP'), 'characters');
  assert.equal(lengthUnit('zh-TW'), 'characters');
  assert.equal(lengthUnit('en'), 'words');
  assert.equal(lengthUnit('ko'), 'words');
});

test('bulletLength: without the marker', () => {
  assert.equal(bulletLength('- 売上は12%増', 'ja'), 7);
  // Spaces do not count as characters.
  assert.equal(bulletLength('-   売上 は 増加  ', 'ja'), 5);
  assert.equal(bulletLength('- 𠮷野家の売上', 'ja'), 6);
  assert.equal(bulletLength('- Sales rose  12% in Q3.', 'en'), 5);
  assert.equal(bulletLength('-', 'en'), 0);
});

test('sentenceCount: sentence ends followed by more text', () => {
  assert.equal(sentenceCount('- 売上は増えた'), 1);
  assert.equal(sentenceCount('- 売上は増えた。'), 1);
  assert.equal(sentenceCount('- 売上は増えた。利益も増えた'), 2);
  assert.equal(sentenceCount('- 本当か？ 誰も知らない！ 次回に続く'), 3);
  assert.equal(sentenceCount('- Sales rose 3.5% to $1.2 billion.'), 1);
  assert.equal(sentenceCount('- Sales rose. Profit fell! Why? Nobody knows.'), 4);
  assert.equal(sentenceCount('- He said "it works." Then he left.'), 2);
  // An initial in an abbreviation is not a sentence end.
  assert.equal(sentenceCount('- The U.S. Senate voted.'), 1);
  assert.equal(sentenceCount('- It sold to IBM. Then it grew.'), 2);
  assert.equal(sentenceCount('-'), 0);
});

test('lengthStats: median, 90th percentile and the number over the limit', () => {
  const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.deepEqual(lengthStats(xs, 'characters'), { count: 10, median: 60, p90: 90, over: 5 });
  assert.deepEqual(lengthStats([10, 26, 30], 'words'), { count: 3, median: 26, p90: 30, over: 2 });
  assert.deepEqual(lengthStats([], 'words'), { count: 0, median: 0, p90: 0, over: 0 });
});

test('costUsd: catalog prices, long-context tier, cache multipliers and the judge model', () => {
  // Haiku 5.5: $0.10 / $0.50 per MTok up to 100K input tokens.
  assert.equal(costUsd('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 100_000 }), 0.06);
  // Above 100K input tokens: $0.50 / $2.50.
  assert.equal(costUsd('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 0 }), 0.1);
  // Sonnet 5.5 ($2 input): cache writes at 1.25x, cache reads at 0.1x.
  const cached = costUsd('claude-sonnet-5-5', { cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 0 });
  assert.equal(cached, 2.5);
  assert.equal(costUsd('claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000 }), 0.2);
  assert.equal(costUsd('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 24);
  assert.equal(costUsd('unknown-model', { input_tokens: 1000 }), 0);
  assert.equal(costUsd('claude-haiku-5-5', undefined), 0);
});

test('formatFailure: the validation reason, or null for a valid summary', () => {
  assert.equal(formatFailure('BULLETS_3', '- One.\n\n- Two.\n\n- Three.'), null);
  // Checked after the same layout tidying as in the pipeline.
  assert.equal(formatFailure('BULLETS_3', '- One.\n- Two.\n- Three.'), null);
  assert.equal(
    formatFailure('BULLETS_3', '- One.\n- Two.'),
    'Expected 3 bullets separated by blank lines, got 3 line(s)'
  );
  assert.equal(formatFailure('TLDR_12_CONCLUSION', '**Summary:** x'), 'Missing Summary line');
});

test('parseJudgement: issues with severity, possibly surrounded by text', () => {
  const text =
    'Here it is:\n{"issues": [{"statement": "X", "severity": "major", "reason": "wrong number"}, ' +
    '{"statement": "Y", "severity": "minor", "reason": "dropped hedge"}], "coverage": 3, "notes": "n"}';
  assert.deepEqual(parseJudgement(text), {
    faithful: false,
    majorIssues: 1,
    issues: [
      { statement: 'X', severity: 'major', reason: 'wrong number' },
      { statement: 'Y', severity: 'minor', reason: 'dropped hedge' }
    ],
    coverage: 3,
    notes: 'n'
  });
});

test('parseJudgement: no issues means faithful; an unknown severity counts as major', () => {
  assert.deepEqual(parseJudgement('{"issues": [], "coverage": 5, "notes": ""}'), {
    faithful: true,
    majorIssues: 0,
    issues: [],
    coverage: 5,
    notes: ''
  });
  const odd = parseJudgement('{"issues": [{"statement": "Z", "severity": "severe"}], "coverage": 4}');
  assert.deepEqual(odd?.issues, [{ statement: 'Z', severity: 'major', reason: '' }]);
  assert.equal(odd?.majorIssues, 1);
});

test('parseJudgement: undefined for text without a valid judgement', () => {
  assert.equal(parseJudgement('no json'), undefined);
  assert.equal(parseJudgement('{"issues": "none", "coverage": 3}'), undefined);
  assert.equal(parseJudgement('{"issues": [], "coverage": "high"}'), undefined);
  assert.equal(parseJudgement('{"issues": [], "coverage": 3'), undefined);
});
