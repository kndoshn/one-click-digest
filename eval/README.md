# Summary eval

Measures how well the extension's summarization pipeline works with real models, so that changes to models, prompts or the pipeline can be compared before they ship. It is not part of CI: it calls the Claude API and costs money. Run it by hand before and after such a change and put both reports in the PR.

## What it runs

`eval/run.ts` sends every case through the same code the extension uses: the pipeline (`src/content/pipeline.ts`), the request builder (`src/background/summary_requests.ts`) and the API client (`src/background/anthropic.ts`), with the default models and prompt caching. Only text extraction is skipped: the article text is given directly.

Cases (`eval/cases.ts`): every article in `eval/articles/` in every summary mode, in the article's language, plus six cases with a different output language (66 cases). The articles are fictional and written for this eval, so they can be published and are not in any model's training data. They cover English and Japanese, news, a court ruling, a science report, an engineering postmortem, an opinion piece, a product review, an interview, a sports report, a local notice about water rates, a very short recall notice, and two long articles that are summarized in chunks (map-reduce).

## Running it

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run eval                 # deterministic checks only
ANTHROPIC_API_KEY=sk-ant-... npm run eval -- --judge      # plus an LLM judge
npm run eval -- --only ja-long                            # a subset (substring of the case id)
npm run eval -- --dry-run                                 # canned API replies: no key, no cost
```

The report (Markdown) is printed to stdout; full results go to `eval/results/<timestamp>.json` (not committed). They include every model answer along the way (`steps`: map, single pass or reduce, repairs), the first draft's validation failure (`draftFailure`) and every API call with its usage and stop reason.

Cost: the summaries cost a few cents per run. With `--judge`, each summary is also graded by `claude-opus-5-5`, which brings a run to roughly $1–3. The report shows the actual cost of each part, computed from the API's usage figures and the prices in `src/shared/models.ts`.

## What it measures

Deterministic checks on every summary:

- **Valid format on the first draft**: the single-pass or reduce output already passes the extension's format validation (bullet count, blank lines, Summary/Conclusion lines). The report groups the failing drafts by the validation's reason.
- **Needed a repair pass** and **valid format after repairs**: how often the extension had to ask for a rewrite, and whether the final text is valid.
- **Ending looks truncated**: the final text still ends mid-sentence.
- **Output language as requested**: Japanese characters dominate for `ja` and are absent for `en`.
- **Bullet length**: median and 90th percentile, in characters for Japanese and Chinese and in words for other languages, and the share of bullets over 50 characters or 25 words (the prompts ask for about 40 characters or 20 words). **Bullets with more than one sentence** counts sentence ends inside a bullet; it is approximate for English abbreviations.
- API calls, calls that stopped at `max_tokens`, cost and time.

With `--judge`, an LLM judge also reports:

- **Faithful**: every statement in the summary is supported by the article. Unsupported statements are listed per case with a severity: **major** when a reader would come away believing something false (a wrong fact, number or cause, or a claim the article does not make), **minor** when the statement is right in substance but stronger or more precise than the article (a dropped hedge, a stronger verb). The report shows both the share with no issues and the share with no major issues.
- **Coverage** (1–5): whether the summary captures the points a reader most needs, for its length.

The judge is a model too and is not always right; read the listed unsupported statements before drawing conclusions.

## Adding articles

Add a Markdown file to `eval/articles/` with a front matter block (`title`, `url`, `language`, and a `source` line saying where the text comes from) followed by the text. Use only text you may publish: write it yourself, or use public-domain text and say so in `source`. Name long articles `*-long-*`; they run in two modes only.
