# Lingadoo

Lingadoo is a browser-first PDF translation and editing app. It runs the active document flow locally in the browser:

1. PDF upload
2. browser-side detected-text extraction
3. browser translation when the browser supports it
4. mirrored detected-text fitting
5. local editor session and PDF export

The backend for local development and tests is only static file hosting.

## Requirements

- Node.js LTS
- npm
- A modern desktop Chromium browser for the best translation support

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Build

```bash
npm run build
```

To serve the built static app locally:

```bash
npm run e2e:server
```

Open `http://127.0.0.1:8766`.

## Tests

```bash
node --test tests/node/*.test.mjs
npm run build
npm run e2e:smoke
```

The checked-in PDF fixtures are intentionally limited to redistribution-safe samples:

- `tests/documents/menora_replaced.pdf`
- `tests/documents/report_1_test.pdf`
- `tests/documents/faux_bold_semantic_test.pdf`
- `tests/documents/wiki1-french.pdf`

## Browser Inspection

Use the built-in inspection runner for real upload/editor behavior:

```bash
npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --block p1_b39
```

The script starts a fresh Vite dev server unless `--url` is passed.

## Google Analytics

Google Analytics support is present but disabled by default. It is enabled only when all of these are true:

- `VITE_GA_MEASUREMENT_ID` is set to a GA4 id like `G-XXXXXXXXXX`
- the app is built in production mode
- the current hostname is not local development

For `lingadoo.app`, configure the deployment environment:

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_SOURCE_URL=https://github.com/YOUR_ORG/lingadoo
```

The included GitHub Pages workflow reads `VITE_GA_MEASUREMENT_ID` from repository variables and sets `VITE_SOURCE_URL` to the GitHub repository URL.

Do not track uploaded document contents, filenames, extracted text, block ids, or edited content in analytics events.

## License

Lingadoo is licensed under `AGPL-3.0-or-later`. See [LICENSE](LICENSE).

The app depends on MuPDF.js, which is distributed by Artifex under AGPL/commercial terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
