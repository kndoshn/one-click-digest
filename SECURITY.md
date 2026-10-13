# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/kndoshn/one-click-digest/security/advisories/new)**
(Security tab → "Report a vulnerability").

Do not open a public issue, pull request or discussion for a suspected vulnerability.

Please include, if you can:

- Browser and version (Chrome, Brave, ...)
- Extension version (from `chrome://extensions` or `manifest.json`)
- Steps to reproduce, and a minimal test page if the issue depends on page content
- What an attacker can do, and under which conditions

Never include your Claude API key, even a revoked one.

This is a project maintained in spare time. You can expect a first response within 7 days. Once a fix is released, the advisory is published with credit to the reporter unless you ask otherwise.

## Scope

In scope, for example:

- Leaking the Claude API key to a web page, another extension, or anything other than `https://api.anthropic.com`
- A web page reading or changing the extension's settings, or triggering API requests (and costs) without the user clicking the toolbar button
- A web page injecting script or markup into the summary overlay, or reading its contents
- Sending page data anywhere other than the Anthropic API, or sending more than [PRIVACY.md](PRIVACY.md) describes
- Supply-chain issues in this repository (CI workflows, release artifacts)

Out of scope:

- Content of summaries (inaccurate or misleading output from the model)
- Costs from summaries that the user started
- Vulnerabilities in Chrome, Anthropic's API, or a compromised device

## Supported versions

Only the latest release is supported. Fixes are not backported.

## Security design

- The Claude API key is stored locally in `chrome.storage.local` and is only sent to `https://api.anthropic.com`.
- The extension has no always-on content scripts. Scripts are injected into the active tab only when the user clicks the toolbar button (`activeTab`).
- API calls run in the background service worker. The API key is never passed to the content script, and content scripts contain no API calls (a test checks this).
- The overlay is rendered in a closed shadow root and does not insert page-provided HTML.
