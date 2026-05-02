import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDetectedTextSkippedPagesNotice,
  buildDetectedTextUnsupportedMessage,
  partitionDetectedTextRequestedPages,
} from '../../src/lib/detectedTextSupport.js';

test('partitionDetectedTextRequestedPages separates supported and skipped pages', () => {
  const result = partitionDetectedTextRequestedPages(
    [1, 2, 3],
    [
      { page_id: 1, blocks: [{ block_id: 'p1_b1' }] },
      { page_id: 2, blocks: [] },
      { page_id: 3, blocks: [{ block_id: 'p3_b1' }] },
    ],
  );

  assert.deepEqual(result.supportedPageIds, [1, 3]);
  assert.deepEqual(result.skippedPageIds, [2]);
});

test('buildDetectedTextUnsupportedMessage explains scanned or no-text pages', () => {
  assert.equal(
    buildDetectedTextUnsupportedMessage([4]),
    'Page 4 looks like a scanned or image-only page, so it cannot open in this text-based editor yet. Try a different method.',
  );
  assert.equal(
    buildDetectedTextUnsupportedMessage([2, 5]),
    'Pages 2, 5 look like scanned or image-only pages, so they cannot open in this text-based editor yet. Try a different method.',
  );
});

test('buildDetectedTextSkippedPagesNotice summarizes skipped unsupported pages', () => {
  assert.equal(
    buildDetectedTextSkippedPagesNotice([3]),
    'Skipped page 3 because it looks scanned or image-only.',
  );
  assert.equal(
    buildDetectedTextSkippedPagesNotice([2, 4]),
    'Skipped pages 2, 4 because they look scanned or image-only.',
  );
  assert.equal(buildDetectedTextSkippedPagesNotice([]), '');
});
