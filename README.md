# Lingadoo

Lingadoo is a browser-first PDF translation and editing app. It runs the active document flow locally in the browser:

1. PDF upload
2. browser-side detected-text extraction
3. browser translation through the Browser Translator API
4. mirrored detected-text fitting
5. local editor session and PDF export

The checked-in app has no document-processing backend. Local development, browser inspection, tests, and GitHub Pages deployment use static file hosting only.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`
- npm
- Desktop Google Chrome or Microsoft Edge

Chrome/Edge desktop are currently required because Lingadoo relies on the browser's local `Translator` API plus WebAssembly, module workers, and local canvas APIs. Other browsers may load the home page, but the public upload flow is blocked when the required local translation runtime is unavailable.

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
npx playwright install chromium
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

## Deployment

Lingadoo builds to static files and can be deployed to GitHub Pages or any static host.

For GitHub Pages, configure repository variables as needed:

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_GA_REQUIRE_CONSENT=false
PAGES_CUSTOM_DOMAIN=lingadoo.app
```

The included Pages workflow sets `VITE_SOURCE_URL` to the GitHub repository URL automatically. It writes `dist/CNAME` only when `PAGES_CUSTOM_DOMAIN` is configured, so forks do not accidentally claim `lingadoo.app`.

## Google Analytics

Google Analytics support is present but disabled by default. It is enabled only when all of these are true:

- `VITE_GA_MEASUREMENT_ID` is set to a GA4 id like `G-XXXXXXXXXX`
- the app is built in production mode
- the current hostname is not local development
- either `VITE_GA_REQUIRE_CONSENT` is not `true`, or `localStorage["lingadoo.analytics.consent"]` is `granted`

Do not track uploaded document contents, filenames, extracted text, block ids, or edited content in analytics events.

## Privacy Model

Uploaded PDFs are processed in the browser. The static app does not send document bytes, extracted text, filenames, translations, block ids, or edits to a Lingadoo server. The app also avoids external font CDNs; bundled export fonts are served with the static app.

## License

Lingadoo is licensed under `AGPL-3.0-or-later`. See [LICENSE](LICENSE).

The app depends on MuPDF.js, which is distributed by Artifex under AGPL/commercial terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Production deployments should keep the visible Source link configured through `VITE_SOURCE_URL` so users can reach the corresponding public source.
