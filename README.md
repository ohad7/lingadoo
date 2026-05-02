# Lingadoo

**Free, open-source PDF translation and editing, running entirely in your browser.**

Lingadoo is a privacy-first PDF translator and editor for people who need to translate real documents without handing them to a server. Open a PDF, translate it locally, adjust the layout, edit the text, and export a new PDF from the browser.

Try the public app at `https://lingadoo.app`, or run and self-host your own copy.

## Why Lingadoo

Most PDF translation tools ask you to upload a document to someone else's backend. That is a hard sell when the document is a contract, invoice, report, ID form, medical record, legal filing, or anything else that should stay private.

Lingadoo takes a different path:

- **Free to use**: no paywall in the app.
- **Fully open source**: inspect, fork, self-host, and improve the code under `AGPL-3.0-or-later`.
- **Browser-first privacy**: PDFs are processed locally in the browser; the static app does not receive your document.
- **Translator and editor in one**: translate the PDF, then fix text, font size, position, wrapping, and layout before export.
- **RTL-aware**: built for right-to-left translation workflows, including Hebrew and Arabic documents.
- **Static-host friendly**: deployable as plain static files on GitHub Pages or any static host.

## What It Does

Lingadoo runs the active document flow locally:

1. You choose a PDF in the browser.
2. Lingadoo extracts detected text with MuPDF.js/WebAssembly.
3. The browser's local `Translator` API translates supported text.
4. Lingadoo mirrors and fits translated text when direction changes between RTL and LTR.
5. You edit the local session and export a translated PDF.

The current language choices are English, Hebrew, Arabic, French, German, and Italian. Translation availability depends on the browser's local Translator API and installed/downloadable language packs.

## Privacy Model

Uploaded PDFs are processed in the browser. The static Lingadoo app does not send document bytes, filenames, extracted text, translations, block ids, or edits to a Lingadoo server.

Google Analytics support exists for public deployments, but it is disabled by default and must not include document content or document identifiers. The app also avoids external font CDNs; bundled export fonts are served with the static app.

## Browser Support

Desktop Google Chrome or Microsoft Edge is currently required for the public upload flow. Lingadoo relies on the browser's local `Translator` API plus WebAssembly, module workers, and local canvas APIs.

Other browsers may load the home page, but upload is blocked when the required local translation runtime is unavailable.

## Development

Requirements:

- Node.js `^20.19.0 || >=22.12.0`
- npm
- Desktop Google Chrome or Microsoft Edge

Run locally:

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

The script starts a fresh Vite dev server unless `--url` is passed. See [docs/inspection.md](docs/inspection.md).

## Deployment

Lingadoo builds to static files and can be deployed to GitHub Pages or any static host.

For GitHub Pages, configure repository variables as needed:

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_GA_REQUIRE_CONSENT=false
PAGES_CUSTOM_DOMAIN=lingadoo.app
```

The included Pages workflow sets `VITE_SOURCE_URL` to the GitHub repository URL automatically. It writes `dist/CNAME` only when `PAGES_CUSTOM_DOMAIN` is configured, so forks do not accidentally claim `lingadoo.app`.

See [docs/deployment.md](docs/deployment.md).

## Google Analytics

Google Analytics support is present but disabled by default. It is enabled only when all of these are true:

- `VITE_GA_MEASUREMENT_ID` is set to a GA4 id like `G-XXXXXXXXXX`
- the app is built in production mode
- the current hostname is not local development
- either `VITE_GA_REQUIRE_CONSENT` is not `true`, or `localStorage["lingadoo.analytics.consent"]` is `granted`

Do not track uploaded document contents, filenames, extracted text, block ids, or edited content in analytics events.

## License

Lingadoo is licensed under `AGPL-3.0-or-later`. See [LICENSE](LICENSE).

The app depends on MuPDF.js, which is distributed by Artifex under AGPL/commercial terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Production deployments should keep the visible Source link configured through `VITE_SOURCE_URL` so users can reach the corresponding public source.
