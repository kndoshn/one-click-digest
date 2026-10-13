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
  // The summary is written in the requested output language (checked for en and ja only).
  languageOk: boolean | null;
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
  if (language.startsWith('ja')) return ratio > 0.5;
  if (language.startsWith('en')) return ratio < 0.02;
  return null;
}

export function checkSummary(mode: SummaryMode, language: string, text: string): Checks {
  return {
    formatValid: Format.validate(mode, text).ok,
    bulletCount: Format.extractBulletLines(text).length,
    expectedBullets: Format.expectedBulletCount(mode),
    truncated: Format.isLikelyTruncatedOutput(text, language),
    languageOk: languageOk(text, language)
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

export type Judgement = {
  // Every statement in the summary is supported by the article.
  faithful: boolean;
  unsupported: string[];
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
    '1. Faithfulness: is every statement in the summary supported by the article? List each unsupported or wrong statement verbatim. Translation into another language is fine; added facts, numbers or opinions are not.',
    '2. Coverage: given the summary length, does it capture the points a reader most needs? Score 1 (misses the main points) to 5 (nothing important missing).',
    '',
    'Answer with only a JSON object, no code fence:',
    '{"faithful": true|false, "unsupported": ["..."], "coverage": 1-5, "notes": "one or two sentences"}',
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

export function parseJudgement(text: string): Judgement | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const j = JSON.parse(text.slice(start, end + 1));
    if (typeof j.faithful !== 'boolean' || typeof j.coverage !== 'number') return undefined;
    return {
      faithful: j.faithful,
      unsupported: Array.isArray(j.unsupported) ? j.unsupported.map(String) : [],
      coverage: j.coverage,
      notes: typeof j.notes === 'string' ? j.notes : ''
    };
  } catch {
    return undefined;
  }
}
