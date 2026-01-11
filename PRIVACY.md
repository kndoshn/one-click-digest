# Privacy policy (OSS / self-hosted API key)

This repository is an open-source Chrome extension. It does not run any server infrastructure.

## What data the extension stores

Stored locally on your device (`chrome.storage.local`):

- Your Claude API key (entered in the Options page)
- User preferences (default mode, model selection, cost limits, etc.)

The extension does **not** upload your API key to any service other than Anthropic when you execute a request.

## What data is sent to Anthropic Claude

When you run a summary, the extension sends the following to Anthropic's API endpoint (`https://api.anthropic.com`):

- The current page URL
- The extracted article title
- The extracted main article text
  - The text is truncated to a configurable maximum before sending (safety / cost control)

For long articles, the extension may send multiple chunk requests and a final reduce request. The data sent is still derived from the same extracted article text.

If token refinement is enabled (best-effort), the extension may call the `count_tokens` endpoint using the same minimal payload (title + URL + text).

## What the extension does NOT collect

- No analytics
- No tracking pixels
- No ads
- No remote logging service

Any debugging logs are local to the browser's developer console.

## Important notes

- Your Claude API key is stored locally and is **not encrypted** by this extension. Anyone with access to your Chrome profile may be able to retrieve it.
- Do not run summarization on content you are not permitted to send to third-party services (e.g., private/customer data, paywalled material, confidential documents).
- Anthropic's data handling and retention policies are governed by Anthropic's terms. Please review Anthropic documentation and policies separately.

## Contact

If you believe you found a security or privacy issue, please see `SECURITY.md`.
