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

`.npmrc` sets `min-release-age=7`, so npm does not pick package versions published less than 7 days ago.

## Code style

- `src/` is TypeScript, built with esbuild (`scripts/build.mjs`) and type-checked with `tsc --noEmit`. Imports use `.ts` extensions, and type-only imports use `import type` (or inline `type`).
- Content scripts are bundled into a single classic script, `dist/content/main.js`, injected after the unmodified `third_party/readability/Readability.js`. They may import from `src/shared/`, but not from `src/background/`.
- Do not move API calls or API keys into the content script.
- Tests import `src/**/*.ts` directly (Node.js type stripping). Content script tests run a test bundle (`build/test/content.js`, built by `npm test`) in a VM context; see `test/helpers/classic_context.js`.

## Models and prices

The models offered in the settings, their prices, tokenizer and caching details, and their extra request parameters are listed in one place: `MODELS` in `src/shared/models.ts`. When Anthropic changes prices or releases or retires a model, update that list (and `PRICING_CHECKED_ON`). A monthly workflow compares it with the Models API and opens an issue when they differ; prices still have to be checked on the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing).

## Pull requests

- Include a clear description of the change.
- Add or update tests for behavior changes.
- Ensure `npm test` passes.
