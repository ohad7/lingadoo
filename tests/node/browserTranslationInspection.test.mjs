import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearBrowserTranslationInspectionEntries,
  listBrowserTranslationInspectionEntries,
  logBrowserTranslationRequestFailed,
  logBrowserTranslationRequestStarted,
  logBrowserTranslationRequestSucceeded,
} from '../../src/lib/browserTranslationInspection.js';

test('browser translation inspection records successful requests and responses', () => {
  clearBrowserTranslationInspectionEntries();
  const entryId = logBrowserTranslationRequestStarted({
    sourceText: 'שלום',
    pageId: 1,
    blockId: 'p1_b4',
    sourceCode: 'he',
    targetCode: 'en',
    strict: false,
    blockType: 'text_line',
    sourceDirection: 'rtl',
  });

  logBrowserTranslationRequestSucceeded(entryId, 'hello');

  const [entry] = listBrowserTranslationInspectionEntries();
  assert.equal(entry.status, 'succeeded');
  assert.equal(entry.sourceText, 'שלום');
  assert.equal(entry.responseText, 'hello');
  assert.equal(entry.errorMessage, '');
  assert.equal(entry.pageId, 1);
  assert.equal(entry.blockId, 'p1_b4');
  assert.equal(entry.strict, false);
  assert.equal(entry.sourceDirection, 'rtl');
  assert.equal(typeof entry.durationMs, 'number');
});

test('browser translation inspection records failed requests', () => {
  clearBrowserTranslationInspectionEntries();
  const entryId = logBrowserTranslationRequestStarted({
    sourceText: 'בדיקה',
    pageId: 2,
    blockId: 'p2_b7',
    sourceCode: 'he',
    targetCode: 'en',
    strict: true,
  });

  logBrowserTranslationRequestFailed(entryId, new Error('translator timed out'));

  const [entry] = listBrowserTranslationInspectionEntries();
  assert.equal(entry.status, 'failed');
  assert.equal(entry.responseText, '');
  assert.equal(entry.errorMessage, 'translator timed out');
  assert.equal(entry.strict, true);
});
