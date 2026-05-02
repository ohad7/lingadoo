import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getAnalyticsMeasurementId,
  shouldEnableAnalytics,
} from '../../src/lib/analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexHtmlPath = path.resolve(__dirname, '../../index.html');

test('index.html does not hardcode Google Analytics credentials', async () => {
  const indexHtml = await readFile(indexHtmlPath, 'utf8');

  assert.doesNotMatch(indexHtml, /googletagmanager/u);
  assert.doesNotMatch(indexHtml, /G-[A-Z0-9]+/u);
});

test('analytics is enabled only with a production GA measurement id', () => {
  assert.equal(getAnalyticsMeasurementId({ VITE_GA_MEASUREMENT_ID: 'G-ABC123XYZ' }), 'G-ABC123XYZ');
  assert.equal(getAnalyticsMeasurementId({ VITE_GA_MEASUREMENT_ID: 'not-a-ga-id' }), '');
  assert.equal(
    shouldEnableAnalytics({
      env: { MODE: 'production', PROD: true, VITE_GA_MEASUREMENT_ID: 'G-ABC123XYZ' },
      hostname: 'lingadoo.app',
    }),
    true,
  );
  assert.equal(
    shouldEnableAnalytics({
      env: { MODE: 'development', DEV: true, VITE_GA_MEASUREMENT_ID: 'G-ABC123XYZ' },
      hostname: 'localhost',
    }),
    false,
  );
});
