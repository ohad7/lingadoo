# Playwright E2E

## Canonical Fixture
- `tests/documents/report_1_test.pdf`

## Run Locally
1. Install frontend dependencies:
   - `npm install`
2. Install Playwright browser(s):
   - `npx playwright install chromium`
3. Run smoke tests:
   - `npm run e2e:smoke`
4. Run full suite:
   - `npm run e2e`

## Server Model Used by Tests
- Browser inspection and Playwright E2E both use `npm run e2e:server`.
- That command serves `dist` through a static SPA server only.
- The E2E suite covers the browser-local editor flow.

## Artifact Roots
- Shared artifacts root (persistent across runs):
  - `.test-artifacts/e2e/shared/artifacts`
- Runtime root (per-run):
  - `.test-artifacts/e2e/runs/<run-id>/runtime`
