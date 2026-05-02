# Contributing

Thanks for helping improve Lingadoo.

## Local Setup

```bash
npm install
npx playwright install chromium
npm run dev
```

Use desktop Chrome or Edge when manually testing translation behavior. Other browsers can be useful for layout checks, but the public upload flow requires the Browser Translator API.

## Before Opening a Pull Request

Run the checks that match your change:

```bash
node --test tests/node/*.test.mjs
npm run build
npm run e2e:smoke
```

For changes to upload, extraction, fitting, rendering, or editor behavior, prefer a focused node test for pure logic and an E2E test when the browser flow is affected.

## Code Shape

- Keep the app browser-first. Do not add a document-processing server or API-driven editor flow.
- Keep runtime code focused on static hosting and browser-local processing.
- Document new feature flags in README or `docs/inspection.md`.
- Avoid production console noise unless it reports an actionable failure.

## Privacy

Do not add analytics or diagnostics that capture uploaded document contents, filenames, extracted text, translations, block ids, or edited content.

## Fixtures

Only commit fixtures that are clearly safe to redistribute publicly. Prefer synthetic fixtures for new tests.
