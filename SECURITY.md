# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in this extension:

1. **Do not** post sensitive details in a public issue.
2. Prefer opening a GitHub issue with minimal detail and ask for a private channel, or use the repository's security reporting features if enabled.

Include (if possible):
- Chrome version
- Extension version (from `manifest.json`)
- Steps to reproduce
- Expected vs actual behavior

## Key security properties

- The Claude API key is stored locally in `chrome.storage.local`.
- The extension does not use always-on `content_scripts`; scripts are injected on demand.
- API calls are executed in the background service worker, and the API key is never passed into the content script.

## Supported versions

Only the latest release branch is supported.
