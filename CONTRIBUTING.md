# Contributing

Thanks for considering contributing.

## Development

Prerequisites:
- Node.js, at the version pinned in `mise.toml` (run `mise install` with [mise](https://mise.jdx.dev/)). CI uses the same version.

Common commands:

```bash
npm install
npm run build
npm run format     # oxfmt; CI runs `npm run format:check`
npm run typecheck
npm run lint       # oxlint, including type-aware rules
npm test
```

`npm run build` writes the unpacked extension to `dist/`, which is not committed. Load it from `chrome://extensions` with **Load unpacked**.

Formatting-only commits are listed in `.git-blame-ignore-revs`. GitHub skips them in blame views; to do the same locally, run `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

`.npmrc` sets `min-release-age=7`, so npm does not pick package versions published less than 7 days ago.

## Code style

- `src/` is TypeScript, built with esbuild (`scripts/build.mjs`) and type-checked with `tsc --noEmit`. Imports use `.ts` extensions, and type-only imports use `import type` (or inline `type`).
- Content scripts are bundled into a single classic script, `dist/content/main.js`, injected after the unmodified `third_party/readability/Readability.js`. They may import from `src/shared/`, but not from `src/background/`.
- Do not move API calls or API keys into the content script.
- Messages between the content script and the background worker are defined once, as valibot schemas in `src/shared/messages.ts`. The worker validates every message; senders get typed responses (`ResponseFor<type>`).
- `npm run typecheck` also checks the tests (JavaScript with `checkJs`, not strict yet; `tsconfig.test.json`).
- Tests import `src/**/*.ts` directly (Node.js type stripping). Content script tests run a test bundle (`build/test/content.js`, built by `npm test`) in a VM context; see `test/helpers/classic_context.js`.
- GitHub Actions workflows pin actions by commit SHA and set minimal `permissions`. CI audits `.github/` with [zizmor](https://docs.zizmor.sh/); to run it locally: `GH_TOKEN=$(gh auth token) uvx zizmor .`

## End-to-end tests

`npm run test:e2e` builds the E2E variant of the extension (`build/e2e/`) and runs the Playwright tests in `e2e/` in Chromium, with the Claude API mocked and fixture pages served from `https://e2e.test`. Install the browser once with `npx playwright install chromium`.

The E2E build differs from `dist/` only where tests need it: Playwright cannot click the toolbar button, so the worker exposes the injection as `__e2e.injectContentScripts`; the overlay's shadow root is open so locators can reach it; and the manifest also allows the test origin. A unit test checks that none of this is in `dist/`.

## Summary eval

Before changing models, prompts or the summarization pipeline, run the eval in `eval/` before and after the change (`npm run eval`, needs `ANTHROPIC_API_KEY`; see `eval/README.md`) and include both reports in the PR. It runs the extension's own pipeline on fictional articles and costs a few cents, or about $1–3 with `--judge`.

## Models and prices

The models offered in the settings, their prices, tokenizer and caching details, and their extra request parameters are listed in one place: `MODELS` in `src/shared/models.ts`. When Anthropic changes prices or releases or retires a model, update that list (and `PRICING_CHECKED_ON`). A monthly workflow compares it with the Models API and opens an issue when they differ; prices still have to be checked on the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing).

## Pull requests

- Include a clear description of the change.
- Add or update tests for behavior changes.
- Ensure `npm test` passes.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. Every push to `main` updates an open release PR (`chore(main): release x.y.z`). It bumps the version in `package.json`, `package-lock.json` and `public/manifest.json` and updates `CHANGELOG.md` from the conventional commit titles (`feat:` → minor, `fix:` → patch, `feat!:` or `BREAKING CHANGE:` → major).
2. Merging the release PR creates a draft GitHub release and its tag (`1.2.3`, without `v`).
3. The workflow then builds the extension from the tag, attaches `one-click-digest-<version>.zip` with a build provenance attestation, and publishes the release.

Do not bump versions or push tags by hand. To check a downloaded zip:

```bash
gh attestation verify one-click-digest-<version>.zip --repo kndoshn/one-click-digest
```
