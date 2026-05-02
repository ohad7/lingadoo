import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEditorExtractionNotices,
  buildExtractionWarningSummary,
} from '../../src/lib/pageExtractionWarnings.js';

test('buildExtractionWarningSummary describes background text image warnings', () => {
  assert.equal(
    buildExtractionWarningSummary(4, { suspicious: true, reasons: ['background_text_image'] }),
    'Page 4: this page includes a text-heavy background image, so some text may not be captured.',
  );
});

test('buildExtractionWarningSummary falls back to a generic extraction warning', () => {
  assert.equal(
    buildExtractionWarningSummary(2, { suspicious: true, reasons: ['mojibake'] }),
    'Page 2: text extraction may be corrupted.',
  );
});

test('buildEditorExtractionNotices returns both opening and page warnings when present', () => {
  assert.deepEqual(
    buildEditorExtractionNotices({
      openingNotice: 'Skipped page 2 because it looks scanned or image-only.',
      activePageId: 5,
      activeExtractionWarning: { suspicious: true, reasons: ['background_text_image'] },
    }),
    [
      {
        key: 'opening-notice',
        tone: 'info',
        message: 'Skipped page 2 because it looks scanned or image-only.',
      },
      {
        key: 'page-warning-5',
        tone: 'warning',
        message: 'Page 5: this page includes a text-heavy background image, so some text may not be captured.',
      },
    ],
  );
});
