// Summarization eval: runs every case in eval/cases.ts through the extension's own pipeline
// (src/content/pipeline.ts), request builder and API client, grades the summaries and prints a
// Markdown report. Full results go to eval/results/<timestamp>.json. See eval/README.md.
//
//   ANTHROPIC_API_KEY=... node eval/run.ts [--judge] [--only <case-id-substring>] [--dry-run]
//
// --judge    also grades faithfulness and coverage with an LLM judge (claude-opus-5-5; costs more)
// --dry-run  answers every API call locally with canned replies (no key, no cost; checks the harness)

import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runMessagesWithRetry } from '../src/background/anthropic.ts';
import type { CacheControlEphemeral } from '../src/background/prompts.ts';
import { buildSummaryRequest } from '../src/background/summary_requests.ts';
import { runPipeline, type PipelineTrace, type SendSummaryRequest } from '../src/content/pipeline.ts';
import { CHUNK_TARGET_INPUT_TOKENS } from '../src/content/models.ts';
import { DEFAULT_SETTINGS } from '../src/shared/types.ts';
import type { Usage } from '../src/shared/messages.ts';
import { CASES, type EvalCase, loadArticle } from './cases.ts';
import {
  checkSummary,
  type Checks,
  costUsd,
  JUDGE_MODEL,
  judgePrompt,
  type Judgement,
  parseJudgement
} from './grade.ts';
import { installFakeApi } from './fake_api.ts';

const { values: args } = parseArgs({
  options: { judge: { type: 'boolean' }, only: { type: 'string' }, 'dry-run': { type: 'boolean' } }
});

const apiKey = args['dry-run'] ? 'sk-ant-dry-run' : (process.env.ANTHROPIC_API_KEY ?? '');
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY (or pass --dry-run).');
  process.exit(2);
}
if (args['dry-run']) installFakeApi();

// Every API call, recorded from the responses (including max_tokens retries).
type ApiCall = {
  caseId: string;
  purpose: 'summary' | 'judge';
  model: string;
  usage?: Usage;
  ms: number;
  status: number;
};
const apiCalls: ApiCall[] = [];
// Tags each API call with the case it belongs to (cases run concurrently).
const callTag = new AsyncLocalStorage<{ caseId: string; purpose: ApiCall['purpose'] }>();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const tag = callTag.getStore();
  const started = performance.now();
  const res = await realFetch(input, init);
  const url = input instanceof Request ? input.url : input.toString();
  if (tag && url.endsWith('/v1/messages')) {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    const json = await res
      .clone()
      .json()
      .catch(() => undefined);
    apiCalls.push({
      ...tag,
      model: body.model,
      usage: json?.usage,
      ms: performance.now() - started,
      status: res.status
    });
  }
  return res;
};

// The extension's defaults: prompt caching on, 5-minute TTL.
const cacheControl: CacheControlEphemeral = { type: 'ephemeral', ttl: DEFAULT_SETTINGS.promptCachingTtl };

type CaseResult = {
  id: string;
  status: 'done' | 'error' | 'cancelled';
  error?: string;
  text?: string;
  trace?: PipelineTrace;
  checks?: Checks;
  judgement?: Judgement | null;
  ms: number;
};

async function runCase(c: EvalCase): Promise<CaseResult> {
  const article = loadArticle(c.article);
  const send: SendSummaryRequest = async (msg) => {
    const request = buildSummaryRequest(msg, cacheControl);
    const r = await runMessagesWithRetry({ ...request, apiKey });
    return (r.ok ? { ok: true, text: r.text, usage: r.usage } : r) as never;
  };
  const started = performance.now();
  const result = await callTag.run({ caseId: c.id, purpose: 'summary' }, () =>
    runPipeline(
      article,
      {
        runId: c.id,
        mode: c.mode,
        language: c.language,
        mapModel: DEFAULT_SETTINGS.modelMap,
        finalModel: DEFAULT_SETTINGS.modelFinal,
        chunkTargetTokens: CHUNK_TARGET_INPUT_TOKENS
      },
      send
    )
  );
  const ms = performance.now() - started;
  if (result.status !== 'done') {
    const error = result.status === 'error' ? `${result.error?.code}: ${result.error?.message}` : undefined;
    return { id: c.id, status: result.status, error, ms };
  }

  let judgement: Judgement | null | undefined;
  if (args.judge) {
    const r = await callTag.run({ caseId: c.id, purpose: 'judge' }, () =>
      runMessagesWithRetry({
        apiKey,
        model: JUDGE_MODEL,
        maxTokens: 8000,
        userPrompt: judgePrompt(article, result.text, c.language),
        timeoutMs: 180_000
      })
    );
    judgement = r.ok ? (parseJudgement(r.text) ?? null) : null;
  }

  return {
    id: c.id,
    status: 'done',
    text: result.text,
    trace: result.trace,
    checks: checkSummary(c.mode, c.language, result.text),
    judgement,
    ms
  };
}

// A few cases at a time.
async function runAll(cases: EvalCase[], concurrency = 4): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < cases.length) {
        const i = next++;
        results[i] = await runCase(cases[i]);
        process.stderr.write(`${results[i].status === 'done' ? '.' : 'x'}`);
      }
    })
  );
  process.stderr.write('\n');
  return results;
}

const cases = args.only ? CASES.filter((c) => c.id.includes(args.only!)) : CASES;
const results = await runAll(cases);

// --- Report ---

const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`);
const done = results.filter((r) => r.status === 'done');
const summaryCost = apiCalls.filter((c) => c.purpose === 'summary').reduce((s, c) => s + costUsd(c.model, c.usage), 0);
const judgeCost = apiCalls.filter((c) => c.purpose === 'judge').reduce((s, c) => s + costUsd(c.model, c.usage), 0);
const judged = done.filter((r) => r.judgement);

const lines = [
  `## Summary eval${args['dry-run'] ? ' (dry run)' : ''}`,
  '',
  `Models: map ${DEFAULT_SETTINGS.modelMap}, final ${DEFAULT_SETTINGS.modelFinal}. Cases: ${results.length}.`,
  '',
  '| Metric | Value |',
  '| --- | --- |',
  `| Completed | ${done.length}/${results.length} |`,
  `| Valid format on the first draft | ${pct(done.filter((r) => r.trace!.draftValid).length, done.length)} |`,
  `| Needed a repair pass | ${pct(done.filter((r) => r.trace!.repairs.length > 0).length, done.length)} |`,
  `| Valid format after repairs | ${pct(done.filter((r) => r.checks!.formatValid).length, done.length)} |`,
  `| Ending looks truncated | ${pct(done.filter((r) => r.checks!.truncated).length, done.length)} |`,
  `| Output language as requested | ${pct(done.filter((r) => r.checks!.languageOk !== false).length, done.length)} |`,
  `| API calls (summaries) | ${apiCalls.filter((c) => c.purpose === 'summary').length} |`,
  `| Cost (summaries) | $${summaryCost.toFixed(4)} |`,
  `| Median time per summary | ${median(done.map((r) => r.ms)).toFixed(0)} ms |`
];
if (args.judge) {
  lines.push(
    `| Faithful (judge) | ${pct(judged.filter((r) => r.judgement!.faithful).length, judged.length)} of ${judged.length} judged |`,
    `| Mean coverage (judge, 1-5) | ${mean(judged.map((r) => r.judgement!.coverage)).toFixed(2)} |`,
    `| Cost (judge) | $${judgeCost.toFixed(4)} |`
  );
}
const problems = results.filter(
  (r) =>
    r.status !== 'done' ||
    !r.checks!.formatValid ||
    r.checks!.truncated ||
    r.checks!.languageOk === false ||
    r.judgement?.faithful === false
);
if (problems.length > 0) {
  lines.push('', '### Cases with problems', '');
  for (const r of problems) {
    const why = [
      r.status !== 'done' ? `${r.status}${r.error ? ` (${r.error})` : ''}` : '',
      r.checks && !r.checks.formatValid ? `format (${r.checks.bulletCount}/${r.checks.expectedBullets} bullets)` : '',
      r.checks?.truncated ? 'truncated' : '',
      r.checks?.languageOk === false ? 'language' : '',
      r.judgement?.faithful === false ? `unsupported: ${r.judgement.unsupported.join(' / ')}` : ''
    ].filter(Boolean);
    lines.push(`- \`${r.id}\`: ${why.join('; ')}`);
  }
}
console.log(lines.join('\n'));

const outDir = path.resolve('eval/results');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${new Date().toISOString().replaceAll(':', '-')}.json`);
fs.writeFileSync(outFile, JSON.stringify({ args, results, apiCalls }, null, 2) + '\n');
console.error(`Full results: ${path.relative(process.cwd(), outFile)}`);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
