# Third-party notices

This project bundles the following third-party component(s). The licenses below apply to those components only.

## Readability.js

- Source: Arc90 Inc / Mozilla Readability (https://github.com/mozilla/readability)
- Upstream commit: d7949dc47dd9ed9ee1d3b34ffdcf3bce28cde435
  - `Readability.js` is an unmodified copy of the file at this commit. The `Readability upstream`
    workflow checks that it still matches, and opens an issue when upstream changes the file.
  - To update, copy the file from a newer upstream commit and replace the hash above in the same PR.
- Location in this repository:
  - `third_party/readability/Readability.js`
  - Built artifact: `dist/third_party/readability/Readability.js`
- License: Apache License 2.0

The bundled file includes the original copyright and license header. A copy of the Apache 2.0
license text is provided at `third_party/readability/LICENSE-2.0.txt`.

## PDF.js

- Source: Mozilla PDF.js (https://github.com/mozilla/pdf.js), npm package `pdfjs-dist` (legacy build)
  - The version is the one in `package-lock.json`. Dependabot proposes updates.
- Location in this repository:
  - Not committed; installed from npm and bundled by `scripts/build.mjs`
  - Built artifact: `dist/content/pdf.js` (injected only into PDF tabs)
- License: Apache License 2.0

The built file starts with PDF.js's copyright and license notice. A copy of the Apache 2.0 license
text is provided at `third_party/readability/LICENSE-2.0.txt` (also in `dist/`).
