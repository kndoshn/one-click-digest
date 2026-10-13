<!-- The PR title becomes the squash commit message: use a conventional prefix (fix:, feat:, docs:, ...). -->

## Summary

<!-- What changes and why. Link the issue if there is one (Fixes #123). -->

## Test plan

<!-- How you verified the change: commands you ran, pages you tried in the browser. -->

- [ ] `npm run typecheck`
- [ ] `npm test`

## Checklist

- [ ] Tests added or updated for behavior changes (for a bug fix, a test that fails without the fix)
- [ ] No API calls or API key handling in content scripts (`src/content/`)
- [ ] User-facing text added to every locale in `public/_locales/`
