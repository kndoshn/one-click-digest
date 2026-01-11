# Contributing

Thanks for considering contributing.

## Development

Prerequisites:
- Node.js (18+ recommended)

Common commands:

```bash
npm install
npm run build
npm test
```

## Code style

- Keep content scripts classic-script compatible (`dist/content/*.js` must not contain `import`/`export`).
- Do not move API calls or API keys into the content script.

## Pull requests

- Include a clear description of the change.
- Add or update tests for behavior changes.
- Ensure `npm test` passes.
