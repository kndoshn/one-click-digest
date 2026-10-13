// The eval's grading helpers (eval/grade.ts): language detection, summary checks, cost and the
// parsing of the LLM judge's answer.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkSummary,
  costUsd as rawCostUsd,
  formatFailure,
  japaneseRatio,
  languageOk,
  parseJudgement
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
  assert.equal(japaneseRatio('...'), null);
});

test('checkSummary: format, bullets, truncation and language', () => {
  assert.deepEqual(checkSummary('BULLETS_3', 'en', '- One.\n\n- Two.\n\n- Three.'), {
    formatValid: true,
    bulletCount: 3,
    expectedBullets: 3,
    truncated: false,
    languageOk: true
  });
  const bad = checkSummary('BULLETS_5', 'en', '- One.\n\n- Two and then');
  assert.equal(bad.formatValid, false);
  assert.equal(bad.bulletCount, 2);
  assert.equal(bad.truncated, true);
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
  assert.equal(
    formatFailure('BULLETS_3', '- One.\n- Two.\n- Three.'),
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
