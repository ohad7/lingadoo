import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldShowStandaloneUploadError } from '../../src/lib/uploadPreviewErrors.js';

test('shouldShowStandaloneUploadError hides duplicate error when progress modal already failed', () => {
  assert.equal(
    shouldShowStandaloneUploadError({ status: 'failed' }, 'Page 1 appears scanned'),
    false,
  );
});

test('shouldShowStandaloneUploadError keeps standalone error when there is no failed upload job', () => {
  assert.equal(
    shouldShowStandaloneUploadError(null, 'Something went wrong'),
    true,
  );
  assert.equal(
    shouldShowStandaloneUploadError({ status: 'running' }, 'Something went wrong'),
    true,
  );
  assert.equal(
    shouldShowStandaloneUploadError({ status: 'failed' }, ''),
    false,
  );
});
