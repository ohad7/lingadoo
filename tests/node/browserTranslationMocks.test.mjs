import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStoredBrowserTranslationRun,
  resolveMockTranslationRun,
} from '../../src/lib/browserTranslationMocks.js';

test('resolveMockTranslationRun normalizes document ids to the current extracted layout', () => {
  const sourceTranslations = [{
    document_id: 'old-doc',
    page_id: 1,
    blocks: [{ block_id: 'p1_b17', translated_text: 'A. Expected payments from the provident fund' }],
  }];
  const result = resolveMockTranslationRun({
    mockRun: {
      sourcePdfName: 'report_1_test.pdf',
      sourceCode: 'he',
      targetCode: 'en',
      translationEngine: 'browser-translator',
      translations: sourceTranslations,
    },
    fileName: 'report_1_test.pdf',
    sourceCode: 'he',
    targetCode: 'en',
    layouts: [{ page_id: 1, document_id: 'new-doc' }],
    fallbackDocumentId: 'fallback-doc',
  });

  assert.ok(result);
  assert.equal(result.translationEngine, 'browser-translator');
  assert.equal(result.translations[0].document_id, 'new-doc');
  assert.notEqual(result.translations[0], sourceTranslations[0]);
  assert.notEqual(result.translations[0].blocks, sourceTranslations[0].blocks);
});

test('resolveMockTranslationRun rejects mismatched mock metadata', () => {
  const result = resolveMockTranslationRun({
    mockRun: {
      sourcePdfName: 'other.pdf',
      sourceCode: 'he',
      targetCode: 'en',
      translations: [],
    },
    fileName: 'report_1_test.pdf',
    sourceCode: 'he',
    targetCode: 'en',
    layouts: [{ page_id: 1, document_id: 'new-doc' }],
  });

  assert.equal(result, null);
});

test('buildStoredBrowserTranslationRun clones translation pages for export', () => {
  const source = [{
    document_id: 'doc',
    page_id: 1,
    blocks: [{ block_id: 'p1_b17', translated_text: 'A. Expected payments from the provident fund' }],
  }];
  const stored = buildStoredBrowserTranslationRun({
    sourcePdfName: 'report_1_test.pdf',
    sourceCode: 'he',
    targetCode: 'en',
    translationEngine: 'browser-translator',
    translations: source,
  });

  assert.equal(stored.translationEngine, 'browser-translator');
  assert.deepEqual(stored.translations, source);
  assert.notEqual(stored.translations, source);
  assert.notEqual(stored.translations[0].blocks, source[0].blocks);
});
