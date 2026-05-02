import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractTesseractBoxesByGranularity,
  extractTesseractLineBoxes,
  extractTesseractWordBoxes,
  inflateOcrBBox,
  normalizeTesseractProgressMessage,
  resolveTesseractLanguageSpec,
} from '../../src/lib/tesseractOcr.js';

test('resolveTesseractLanguageSpec maps app language codes and includes english fallback', () => {
  assert.deepEqual(resolveTesseractLanguageSpec('he', 'en'), {
    primary: 'heb',
    languages: ['heb', 'eng'],
    spec: 'heb+eng',
  });
  assert.deepEqual(resolveTesseractLanguageSpec('en', ''), {
    primary: 'eng',
    languages: ['eng'],
    spec: 'eng',
  });
});

test('normalizeTesseractProgressMessage clamps progress and preserves status', () => {
  assert.deepEqual(normalizeTesseractProgressMessage({ status: 'recognizing text', progress: 1.4 }), {
    status: 'recognizing text',
    progress: 1,
  });
  assert.deepEqual(normalizeTesseractProgressMessage({ status: '', progress: -1 }), {
    status: 'processing',
    progress: 0,
  });
  assert.equal(normalizeTesseractProgressMessage(null), null);
});

test('inflateOcrBBox adds padding and clamps to image bounds', () => {
  assert.deepEqual(
    inflateOcrBBox([10, 12, 90, 30], {
      paddingX: 4,
      paddingY: 3,
      maxWidth: 100,
      maxHeight: 40,
    }),
    [6, 9, 94, 33],
  );
  assert.deepEqual(
    inflateOcrBBox([1, 2, 9, 10], {
      paddingX: 5,
      maxWidth: 12,
      maxHeight: 14,
    }),
    [0, 0, 12, 14],
  );
});

test('extractTesseractLineBoxes flattens OCR blocks into sorted line entries', () => {
  const pageData = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                text: 'second line',
                confidence: 87.2,
                bbox: { x0: 40, y0: 80, x1: 150, y1: 96 },
              },
              {
                text: 'first line',
                confidence: 92.1,
                bbox: { x0: 20, y0: 30, x1: 120, y1: 46 },
              },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(extractTesseractLineBoxes(pageData), [
    {
      text: 'first line',
      confidence: 92.1,
      bbox: [20, 30, 120, 46],
    },
    {
      text: 'second line',
      confidence: 87.2,
      bbox: [40, 80, 150, 96],
    },
  ]);
});

test('extractTesseractBoxesByGranularity exposes block line and word boxes', () => {
  const pageData = {
    blocks: [
      {
        text: 'block text',
        confidence: 88,
        bbox: { x0: 10, y0: 12, x1: 90, y1: 60 },
        paragraphs: [
          {
            lines: [
              {
                text: 'alpha beta',
                confidence: 91,
                bbox: { x0: 12, y0: 14, x1: 86, y1: 28 },
                words: [
                  { text: 'alpha', confidence: 92, bbox: { x0: 12, y0: 14, x1: 42, y1: 28 } },
                  { text: 'beta', confidence: 90, bbox: { x0: 48, y0: 14, x1: 86, y1: 28 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(extractTesseractBoxesByGranularity(pageData), {
    block: [{ text: 'block text', confidence: 88, bbox: [10, 12, 90, 60] }],
    line: [{ text: 'alpha beta', confidence: 91, bbox: [12, 14, 86, 28] }],
    grouped: [{ text: 'alpha beta', confidence: 91, bbox: [12, 14, 86, 28] }],
    word: [
      { text: 'alpha', confidence: 92, bbox: [12, 14, 42, 28] },
      { text: 'beta', confidence: 90, bbox: [48, 14, 86, 28] },
    ],
  });
  assert.deepEqual(extractTesseractWordBoxes(pageData), [
    { text: 'alpha', confidence: 92, bbox: [12, 14, 42, 28] },
    { text: 'beta', confidence: 90, bbox: [48, 14, 86, 28] },
  ]);
});

test('extractTesseractBoxesByGranularity clusters same-line words into grouped parts', () => {
  const pageData = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                text: 'Invoice Number 1027 Due Date',
                confidence: 90,
                bbox: { x0: 10, y0: 12, x1: 230, y1: 30 },
                words: [
                  { text: 'Invoice', confidence: 94, bbox: { x0: 10, y0: 12, x1: 52, y1: 30 } },
                  { text: 'Number', confidence: 93, bbox: { x0: 58, y0: 12, x1: 98, y1: 30 } },
                  { text: '1027', confidence: 92, bbox: { x0: 148, y0: 12, x1: 178, y1: 30 } },
                  { text: 'Due', confidence: 91, bbox: { x0: 184, y0: 12, x1: 206, y1: 30 } },
                  { text: 'Date', confidence: 89, bbox: { x0: 210, y0: 12, x1: 230, y1: 30 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(extractTesseractBoxesByGranularity(pageData).grouped, [
    { text: 'Invoice Number', confidence: 93.5, bbox: [10, 12, 98, 30] },
    { text: '1027 Due Date', confidence: 90.66666666666667, bbox: [148, 12, 230, 30] },
  ]);
});

test('extractTesseractBoxesByGranularity reverses grouped rtl text order', () => {
  const pageData = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                text: 'שלום עולם',
                confidence: 95,
                bbox: { x0: 10, y0: 12, x1: 90, y1: 30 },
                words: [
                  { text: 'עולם', confidence: 94, bbox: { x0: 10, y0: 12, x1: 40, y1: 30 } },
                  { text: 'שלום', confidence: 96, bbox: { x0: 46, y0: 12, x1: 90, y1: 30 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(extractTesseractBoxesByGranularity(pageData).grouped, [
    { text: 'שלום עולם', confidence: 95, bbox: [10, 12, 90, 30] },
  ]);
});
