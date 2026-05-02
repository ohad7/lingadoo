import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeDetectedTextElementsBySourceBlock,
  mergeDetectedTextElementsVertically,
} from '../../src/lib/pdf-core/detectedTextVerticalMergeStage.js';

test('vertical merge joins adjacent same-block prose lines into one orange candidate', () => {
  const merged = mergeDetectedTextElementsVertically([
    {
      debugElementId: 'h-1',
      text: 'This is the first line of a paragraph',
      rawText: 'This is the first line of a paragraph',
      bbox: [10, 10, 120, 20],
      chars: [{ c: 'T', bbox: [10, 10, 14, 20] }],
      sourceBlockIndex: 4,
      mergedSourceBlockIndexes: [4],
      mergedElementIds: ['tight-1'],
      mergedSourceIds: ['b4_l0'],
    },
    {
      debugElementId: 'h-2',
      text: 'and this is the second line below it',
      rawText: 'and this is the second line below it',
      bbox: [11, 22.5, 122, 32.5],
      chars: [{ c: 'a', bbox: [11, 22.5, 15, 32.5] }],
      sourceBlockIndex: 4,
      mergedSourceBlockIndexes: [4],
      mergedElementIds: ['tight-2'],
      mergedSourceIds: ['b4_l1'],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'This is the first line of a paragraph\nand this is the second line below it');
  assert.deepEqual(merged[0].bbox, [10, 10, 122, 32.5]);
  assert.deepEqual(merged[0].verticalMergedElementIds, ['h-1', 'h-2']);
});

test('vertical merge rejects short structural label stacks', () => {
  const merged = mergeDetectedTextElementsVertically([
    {
      debugElementId: 'h-1',
      text: 'Account:',
      rawText: 'Account:',
      bbox: [10, 10, 55, 20],
      chars: [{ c: 'A', bbox: [10, 10, 14, 20] }],
      sourceBlockIndex: 7,
      mergedSourceBlockIndexes: [7],
      mergedElementIds: ['tight-1'],
      mergedSourceIds: ['b7_l0'],
    },
    {
      debugElementId: 'h-2',
      text: '123456',
      rawText: '123456',
      bbox: [10, 22, 55, 32],
      chars: [{ c: '1', bbox: [10, 22, 14, 32] }],
      sourceBlockIndex: 7,
      mergedSourceBlockIndexes: [7],
      mergedElementIds: ['tight-2'],
      mergedSourceIds: ['b7_l1'],
    },
  ]);

  assert.equal(merged.length, 2);
});

test('vertical merge rejects lines from different MuPDF source blocks', () => {
  const merged = mergeDetectedTextElementsVertically([
    {
      debugElementId: 'h-1',
      text: 'This looks paragraph-like on top',
      rawText: 'This looks paragraph-like on top',
      bbox: [10, 10, 118, 20],
      chars: [{ c: 'T', bbox: [10, 10, 14, 20] }],
      sourceBlockIndex: 1,
      mergedSourceBlockIndexes: [1],
      mergedElementIds: ['tight-1'],
      mergedSourceIds: ['b1_l0'],
    },
    {
      debugElementId: 'h-2',
      text: 'but it should stay separate below',
      rawText: 'but it should stay separate below',
      bbox: [10, 22.2, 120, 32.2],
      chars: [{ c: 'b', bbox: [10, 22.2, 14, 32.2] }],
      sourceBlockIndex: 2,
      mergedSourceBlockIndexes: [2],
      mergedElementIds: ['tight-2'],
      mergedSourceIds: ['b2_l0'],
    },
  ]);

  assert.equal(merged.length, 2);
});

test('source-block vertical merge groups all elements from the same MuPDF block', () => {
  const merged = mergeDetectedTextElementsBySourceBlock([
    {
      debugElementId: 'h-1',
      text: 'Top line',
      rawText: 'Top line',
      bbox: [10, 10, 60, 20],
      chars: [{ c: 'T', bbox: [10, 10, 14, 20] }],
      sourceBlockIndex: 9,
      mergedSourceBlockIndexes: [9],
      mergedElementIds: ['tight-1'],
      mergedSourceIds: ['b9_l0'],
    },
    {
      debugElementId: 'h-2',
      text: 'Far below',
      rawText: 'Far below',
      bbox: [200, 60, 260, 70],
      chars: [{ c: 'F', bbox: [200, 60, 204, 70] }],
      sourceBlockIndex: 9,
      mergedSourceBlockIndexes: [9],
      mergedElementIds: ['tight-2'],
      mergedSourceIds: ['b9_l1'],
    },
    {
      debugElementId: 'h-3',
      text: 'Separate block',
      rawText: 'Separate block',
      bbox: [10, 80, 80, 90],
      chars: [{ c: 'S', bbox: [10, 80, 14, 90] }],
      sourceBlockIndex: 10,
      mergedSourceBlockIndexes: [10],
      mergedElementIds: ['tight-3'],
      mergedSourceIds: ['b10_l0'],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'Top line\nFar below');
  assert.deepEqual(merged[0].bbox, [10, 10, 260, 70]);
  assert.deepEqual(merged[0].verticalMergedElementIds, ['h-1', 'h-2']);
});

test('vertical merge rejects candidates that intersect detected table regions', () => {
  const merged = mergeDetectedTextElementsVertically([
    {
      debugElementId: 'h-1',
      text: 'This is the first line of a paragraph',
      rawText: 'This is the first line of a paragraph',
      bbox: [10, 10, 120, 20],
      chars: [{ c: 'T', bbox: [10, 10, 14, 20] }],
      sourceBlockIndex: 4,
      mergedSourceBlockIndexes: [4],
      mergedElementIds: ['tight-1'],
      mergedSourceIds: ['b4_l0'],
    },
    {
      debugElementId: 'h-2',
      text: 'and this is the second line below it',
      rawText: 'and this is the second line below it',
      bbox: [11, 22.5, 122, 32.5],
      chars: [{ c: 'a', bbox: [11, 22.5, 15, 32.5] }],
      sourceBlockIndex: 4,
      mergedSourceBlockIndexes: [4],
      mergedElementIds: ['tight-2'],
      mergedSourceIds: ['b4_l1'],
    },
  ], {
    tableRegions: [[0, 0, 140, 40]],
  });

  assert.equal(merged.length, 2);
});
