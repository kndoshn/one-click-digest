# Contributing

Thanks for considering contributing.

## Development

Prerequisites:
- Node.js, at the version pinned in `mise.toml` (run `mise install` with [mise](https://mise.jdx.dev/)). CI uses the same version.

Common commands:

```bash
npm install
npm run build
npm run typecheck
npm run lint
npm test
```

`npm run build` writes the unpacked extension to `dist/`, which is not committed. Load it from `chrome://extensions` with **Load unpacked**.

`.npmrc` sets `min-release-age=7`, so npm does not pick package versions published less than 7 days ago.

## Code style

- Keep content scripts classic-script compatible (`dist/content/*.js` must not contain `import`/`export`).
- Do not move API calls or API keys into the content script.

## Pull requests

- Include a clear description of the change.
- Add or update tests for behavior changes.
- Ensure `npm test` passes.
