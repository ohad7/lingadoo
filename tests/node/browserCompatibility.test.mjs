import assert from 'node:assert/strict';
import test from 'node:test';

import { assessBrowserCompatibilityForTest } from '../../src/lib/browserCompatibility.js';

test('translator unsupported is treated as a hard blocker', () => {
  const result = assessBrowserCompatibilityForTest({
    baseSupport: {
      worker: true,
      blob: true,
      objectUrl: true,
      webAssembly: true,
    },
    runtimeProbe: {
      workerReady: true,
      wasmReady: true,
      previewCanvasReady: true,
      pdfExportReady: true,
      workerFetchReady: true,
      error: '',
    },
    translatorSupported: false,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.warnings.length, 0);
  assert.ok(result.hardBlockers.some((issue) => issue.key === 'translator-api'));
  assert.ok(result.hardBlockers.some((issue) => /Chrome/i.test(issue.detail)));
  assert.ok(result.hardBlockers.some((issue) => /Edge/i.test(issue.detail)));
});

test('worker fetch limitation remains a warning when the translator is supported', () => {
  const result = assessBrowserCompatibilityForTest({
    baseSupport: {
      worker: true,
      blob: true,
      objectUrl: true,
      webAssembly: true,
    },
    runtimeProbe: {
      workerReady: true,
      wasmReady: true,
      previewCanvasReady: true,
      pdfExportReady: false,
      workerFetchReady: false,
      error: '',
    },
    translatorSupported: true,
  });

  assert.equal(result.status, 'limited');
  assert.ok(result.warnings.some((issue) => issue.key === 'worker-fetch'));
  assert.equal(result.hardBlockers.length, 0);
});
