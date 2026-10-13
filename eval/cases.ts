// The eval cases: each article in eval/articles with each summary mode in the article's language,
// plus a few cross-language cases. All articles are fictional and written for this eval (see
// eval/README.md); none is copied from a real publication.

import fs from 'node:fs';
import path from 'node:path';
import { SUMMARY_MODES, type SummaryMode } from '../src/shared/summary_modes.ts';

export type EvalArticle = { id: string; title: string; url: string; language: string; text: string };

export type EvalCase = { id: string; article: string; mode: SummaryMode; language: string };

const ARTICLES_DIR = path.resolve('eval/articles');

// Reads eval/articles/<id>.md: a front matter block (title, url, language) and the article text.
export function loadArticle(id: string): EvalArticle {
  const raw = fs.readFileSync(path.join(ARTICLES_DIR, `${id}.md`), 'utf-8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${id}.md: missing front matter`);
  const meta = Object.fromEntries(
    m[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
  );
  for (const key of ['title', 'url', 'language']) {
    if (!meta[key]) throw new Error(`${id}.md: missing ${key}`);
  }
  return { id, title: meta.title, url: meta.url, language: meta.language, text: m[2].trim() };
}

export const ARTICLE_IDS = fs
  .readdirSync(ARTICLES_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.slice(0, -3))
  .sort();

// Long articles are summarized in chunks (map-reduce); two modes keep their cost down.
const LONG_MODES: SummaryMode[] = ['BULLETS_5', 'TLDR_12_CONCLUSION'];

export const CASES: EvalCase[] = [
  ...ARTICLE_IDS.flatMap((id) => {
    const { language } = loadArticle(id);
    const modes = id.includes('-long-') ? LONG_MODES : SUMMARY_MODES;
    return modes.map((mode) => ({ id: `${id}/${mode}/${language}`, article: id, mode, language }));
  }),
  // Output language different from the article's.
  { id: 'en-short-city-budget/BULLETS_5/ja', article: 'en-short-city-budget', mode: 'BULLETS_5', language: 'ja' },
  { id: 'ja-short-hospital/BULLETS_5/en', article: 'ja-short-hospital', mode: 'BULLETS_5', language: 'en' }
];
