# Instructions for AI coding agents

## Workflow: pull requests only

This is an open-source repository. Do not commit or push to `main` directly, even for small changes such as version bumps or docs.

1. Create a branch from an up-to-date `main` (e.g. `fix/...`, `feat/...`, `test/...`, `ci/...`, `docs/...`, `chore/...`).
2. Commit in English with a conventional prefix (`fix:`, `feat:`, `test:`, `ci:`, `docs:`, `chore:`, `deps:`).
3. Push the branch and open a PR with `gh pr create`. Write the description in English, with a summary and a test plan.
4. Wait for CI (`gh pr checks <number> --watch`). If anything fails, fix it on the branch and push again.
5. Do not merge the PR yourself. When CI is green, give the maintainer the merge command:

   ```
   gh pr merge <number> --squash --delete-branch
   ```

   The branch ruleset requires a PR and the `CI passed` check, but no approving review. PRs are squash-merged with the PR title as the commit message, so the PR title must use a conventional prefix too. `--delete-branch` also switches the local checkout back to an updated `main`.

Do everything else yourself (branching, changes, tests, commits, pushes, the PR, CI fixes), so that the merge command is the only step left for the maintainer.

## Before opening a PR

- Use the Node.js version pinned in `mise.toml` (`mise install`).
- Run `npm run format`, then `npm run typecheck`, `npm run lint` and `npm test`. `npm test` builds first.
- `dist/` is build output and is not committed.
- Add or update tests for behavior changes (see `CONTRIBUTING.md`). For a bug fix, add a test that fails without the fix.
- Content scripts (`src/content/*.ts`) are injected as classic scripts. `dist/content/*.js` must not contain `import` or `export`, not even in comments (a test checks this).
- Never put API calls or the API key in content scripts. They belong in the background worker.
