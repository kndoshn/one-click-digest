<div align="center">
  <img src="docs/images/Banner.png" alt="OneClickDigest" height="100" />
  <br /><br />
  <b>• OneClickDigest : Article Summarizer for Chrome / Brave •</b>
  <p>A browser extension that summarizes web articles with one click using your Claude API key.</p>
  <p><b>🔑 Your API key is stored locally on your device and never sent anywhere except directly to Anthropic.</b></p>
  <br />
  <img src="docs/images/screenshots/ss_01.png" alt="OneClickDigest overlay - mode selection" width="480" />
  <br />
  <img src="docs/images/screenshots/ss_02.png" alt="OneClickDigest overlay - summary output" width="480" />
</div>

## Quick Start

### 1. Download the Extension

Download `one-click-digest-<version>.zip` from the latest [release](../../releases/latest) and unzip it into a folder.

### 2. Install in Your Browser

**Chrome:**

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the unzipped folder (the one that contains `manifest.json`)

**Brave:**

1. Open `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the unzipped folder (the one that contains `manifest.json`)

### 3. Get a Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an account or sign in
3. Open **API keys** from the left menu
4. Create a new key and save it securely

> **Note:** API usage may require billing setup. Never share your API key publicly.

### 4. Configure the Extension

1. Click the OneClickDigest icon in the toolbar
2. Click the gear icon to open Settings
3. Paste your API key and click **Save**

### 5. Start Using

1. Open an article page you want to summarize
2. Click the OneClickDigest icon
3. Choose a summary mode (3 / 5 / 10 bullets or With Conclusion)
4. Optionally switch the bullet marker (`-` / `・` / `1.`) next to **Copy**
5. Click **Copy** to copy the summary to your clipboard

## Features

| Feature | Description |
|---------|-------------|
| **4 Summary Modes** | 3, 5, or 10 bullet points, or summary with conclusion |
| **Bullet Styles** | Show and copy bullets as `-`, `・`, or `1.` without re-running; the last choice is remembered |
| **Cost Estimation** | Shows character count, tokens, estimated cost, and time before running |
| **Long Article Support** | Automatic chunked map-reduce summarization for lengthy content |
| **PDF Support** | Summarizes PDFs opened in the browser from their text, read locally with [PDF.js](https://mozilla.github.io/pdf.js/) |
| **Multi-language** | Output language can be set independently from UI language |
| **Progress & Cancel** | Progress indicator with cancel option during summarization |

## Troubleshooting

### "This page does not look like a normal article"

The extractor couldn't find article content. This happens on dashboards, feeds, or dynamic pages. Try scrolling to load all content, then retry.

### "This PDF has little or no text that can be read"

The PDF has no text layer, as with scanned documents (images of pages), so there is nothing to summarize. PDFs opened from local files (`file://`) are not supported either; open them from a web address instead.

### API Errors / Timeouts

- Wait and retry
- Check your API key and billing status at [Anthropic Console](https://console.anthropic.com/)
- Switch to a shorter summary mode to reduce cost and latency

### Nothing Happens When I Click the Icon

- Verify the extension is enabled
- Some pages (Chrome Web Store, browser internal pages) don't allow extensions

## Privacy

When summarizing, the extension sends to the Claude API:

- Page title
- Page URL
- Extracted article text

For a PDF, the extension downloads the PDF again from the page's own address and extracts its text in your browser. Only that text is sent, not the PDF file.

Your API key is stored locally and only sent to Anthropic for API calls. Do not use on content you don't want sent to a third-party API.

## Development

### Build from Source

```bash
git clone https://github.com/kndoshn/one-click-digest.git
cd one-click-digest
npm install
npm run build
npm test
```

`npm run build` writes the extension to `dist/` (not committed). Load that folder with **Load unpacked**.

The Node.js version is pinned in `mise.toml`; with [mise](https://mise.jdx.dev/), run `mise install` first.

### Advanced Options

The settings page offers additional configuration:

- Models for map / reduce / repair passes
- Prompt caching (TTL)
- Cost limits and extraction limits

## Disclaimer

This extension is provided "as is" without warranty of any kind. By using this extension, you acknowledge and agree that:

- **API Costs**: You are solely responsible for any charges incurred through the Anthropic API. Monitor your usage and set appropriate limits in the [Anthropic Console](https://console.anthropic.com/).
- **Data Transmission**: Article content is sent to Anthropic's servers for processing. Do not use this extension on confidential or sensitive content.
- **Accuracy**: Summaries are AI-generated and may contain errors or omissions. Always verify important information from the original source.
- **Availability**: This extension depends on third-party services that may change or become unavailable without notice.

The developers are not liable for any damages, costs, or losses arising from the use of this extension.

## License

MIT License - See [LICENSE](LICENSE)

Third-party components (Mozilla Readability and PDF.js) are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

---

<div align="center">
  <sub>This project is not affiliated with or endorsed by Anthropic. Claude is a product of Anthropic.</sub>
</div>
