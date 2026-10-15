// Grading for the summarization eval: deterministic checks on each summary, the cost of the API
// calls, and the optional LLM judge (faithfulness and coverage).

import * as Format from '../src/content/format.ts';
import { applyPricingTier, CACHE_MULTIPLIERS } from '../src/content/models.ts';
import { findModel, type ModelPricing } from '../src/shared/models.ts';
import type { Usage } from '../src/shared/messages.ts';
import type { SummaryMode } from '../src/shared/summary_modes.ts';

export type Checks = {
  // The final summary passes the same format validation the extension uses.
  formatValid: boolean;
  bulletCount: number;
  expectedBullets: number;
  // The ending looks cut off (the extension tries one repair for this).
  truncated: boolean;
  // Every line of the summary is written in the requested output language (checked for en and ja
  // only).
  languageOk: boolean | null;
  // Length of each bullet, in the unit of the output language (see lengthUnit).
  bulletLengths: number[];
  // Bullets with more than one sentence.
  multiSentenceBullets: number;
};

const CJK = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu;
const LATIN = /\p{Script=Latin}/gu;

// Share of Japanese characters among letters; null when there are no letters.
export function japaneseRatio(text: string): number | null {
  const ja = text.match(CJK)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  return ja + latin === 0 ? null : ja / (ja + latin);
}

export function languageOk(text: string, language: string): boolean | null {
  const ratio = japaneseRatio(text);
  if (ratio === null) return false;
  // A summary in the right language overall can still have a line left in another language.
  if (language.startsWith('ja')) return ratio > 0.5 && Format.foreignLines(text, language).length === 0;
  if (language.startsWith('en')) return ratio < 0.02;
  return null;
}

// Why `text` fails the extension's format validation, or null when it passes. Like the pipeline,
// validates the text after tidying its layout.
export function formatFailure(mode: SummaryMode, text: string): string | null {
  const r = Format.validate(mode, Format.tidyLayout(text));
  return r.ok ? null : (r as Format.ValidationFail).reason;
}

export type LengthUnit = 'characters' | 'words';

// Japanese and Chinese are measured in characters, other languages in words.
export function lengthUnit(language: string): LengthUnit {
  const lang = language.toLowerCase();
  return lang.startsWith('ja') || lang.startsWith('zh') ? 'characters' : 'words';
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// A bullet's length without its marker; spaces are not counted as characters.
export function bulletLength(bullet: string, language: string): number {
  const body = bullet.replace(/^\s*-/, '');
  if (lengthUnit(language) === 'characters') return Array.from(GRAPHEMES.segment(body.replace(/\s/g, ''))).length;
  return body.split(/\s+/).filter(Boolean).length;
}

// Approximate: a sentence ends at 。！？, or at . ! ? (and any closing quote) followed by a space,
// unless the period follows a one-letter initial ("U.S."). A final sentence end is not counted twice.
const SENTENCE_BREAK = /[。！？](?=\s*\S)|(?<!(?:^|[\s.])[A-Z])[.!?]["'”’)]*\s+(?=\S)/g;

export function sentenceCount(bullet: string): number {
  const body = bullet.replace(/^\s*-/, '').trim();
  if (body.length === 0) return 0;
  return (body.match(SENTENCE_BREAK)?.length ?? 0) + 1;
}

// Bullets longer than this are over the prompts' guide (about 40 characters or 20 words) by more
// than a few words.
export const LENGTH_LIMIT: Record<LengthUnit, number> = { characters: 50, words: 25 };

export type LengthStats = { count: number; median: number; p90: number; over: number };

// Median, 90th percentile (nearest rank) and the number of bullets over LENGTH_LIMIT.
export function lengthStats(lengths: number[], unit: LengthUnit): LengthStats {
  if (lengths.length === 0) return { count: 0, median: 0, p90: 0, over: 0 };
  const s = [...lengths].sort((a, b) => a - b);
  return {
    count: s.length,
    median: s[Math.floor(s.length / 2)],
    p90: s[Math.ceil(s.length * 0.9) - 1],
    over: s.filter((n) => n > LENGTH_LIMIT[unit]).length
  };
}

export function checkSummary(mode: SummaryMode, language: string, text: string): Checks {
  const bullets = Format.extractBulletLines(text);
  return {
    formatValid: Format.validate(mode, text).ok,
    bulletCount: bullets.length,
    expectedBullets: Format.expectedBulletCount(mode),
    truncated: Format.isLikelyTruncatedOutput(text, language),
    languageOk: languageOk(text, language),
    bulletLengths: bullets.map((b) => bulletLength(b, language)),
    multiSentenceBullets: bullets.filter((b) => sentenceCount(b) > 1).length
  };
}

// Prices for models outside the extension's catalog (the judge).
const EXTRA_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5-5': { inputUsdPerMTok: 4, outputUsdPerMTok: 20 }
};

export function costUsd(model: string, usage: Usage | undefined): number {
  const base = findModel(model)?.pricing ?? EXTRA_PRICING[model];
  if (!base || !usage) return 0;
  const input = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const pricing = applyPricingTier(base, input + cacheWrite + cacheRead);
  // The extension writes the cache with the 5-minute TTL by default.
  const inputUsd =
    (input + cacheWrite * CACHE_MULTIPLIERS.write5m + cacheRead * CACHE_MULTIPLIERS.read) * pricing.inputUsdPerMTok;
  return (inputUsd + (usage.output_tokens ?? 0) * pricing.outputUsdPerMTok) / 1_000_000;
}

// --- LLM judge ---

export const JUDGE_MODEL = 'claude-opus-5-5';

// A statement in the summary that the article does not support. Major: a reader would come away
// believing something false (a wrong fact, number or cause, or a claim the article does not make).
// Minor: right in substance but stated more strongly or precisely than the article.
export type Issue = { statement: string; severity: 'major' | 'minor'; reason: string };

export type Judgement = {
  // No issues at all.
  faithful: boolean;
  majorIssues: number;
  issues: Issue[];
  // 1 (misses the main points) to 5 (covers what a reader most needs).
  coverage: number;
  notes: string;
};

export function judgePrompt(article: { title: string; text: string }, summary: string, language: string): string {
  return [
    'You are grading a summary produced by a browser extension that summarizes web articles.',
    '',
    `The summary was requested in this language: ${language}.`,
    '',
    'Check two things:',
    '1. Faithfulness: is every statement in the summary supported by the article? Translation into another language is fine. List each statement that is not supported, quoted verbatim from the summary, with a severity:',
    '   - "major": a reader would come away believing something false: a wrong fact, number, name or cause, or a claim, judgement or prediction the article does not make.',
    '   - "minor": right in substance but stated more strongly or more precisely than the article, for example a dropped hedge ("about", "reportedly", "planned"), a stronger verb, or a small inference.',
    '2. Coverage: given the summary length, does it capture the points a reader most needs? Score 1 (misses the main points) to 5 (nothing important missing).',
    '',
    'Answer with only a JSON object, no code fence:',
    '{"issues": [{"statement": "...", "severity": "major"|"minor", "reason": "..."}], "coverage": 1-5, "notes": "one or two sentences"}',
    '',
    `<article title="${article.title.replaceAll('"', "'")}">`,
    article.text,
    '</article>',
    '',
    '<summary>',
    summary,
    '</summary>'
  ].join('\n');
}

function parseIssue(raw: unknown): Issue {
  const o = (raw && typeof raw === 'object' ? raw : { statement: raw }) as Record<string, unknown>;
  return {
    statement: typeof o.statement === 'string' ? o.statement : '',
    // Anything the judge did not call minor counts against the summary.
    severity: o.severity === 'minor' ? 'minor' : 'major',
    reason: typeof o.reason === 'string' ? o.reason : ''
  };
}

export function parseJudgement(text: string): Judgement | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const j = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(j.issues) || typeof j.coverage !== 'number') return undefined;
    const issues = j.issues.map(parseIssue);
    return {
      faithful: issues.length === 0,
      majorIssues: issues.filter((i: Issue) => i.severity === 'major').length,
      issues,
      coverage: j.coverage,
      notes: typeof j.notes === 'string' ? j.notes : ''
    };
  } catch {
    return undefined;
  }
}
