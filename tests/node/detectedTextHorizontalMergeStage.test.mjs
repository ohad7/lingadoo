import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeDetectedTextElementsHorizontally } from '../../src/lib/pdf-core/detectedTextHorizontalMergeStage.js';

test('horizontal merge joins close same-row tight elements', () => {
  const merged = mergeDetectedTextElementsHorizontally([
    {
      text: 'Bank',
      rawText: 'Bank',
      bbox: [10, 10, 34, 20],
      chars: [
        { c: 'B', bbox: [10, 10, 14, 20] },
        { c: 'a', bbox: [14, 10, 18, 20] },
      ],
      splitReason: null,
      sourceLineId: 'a',
    },
    {
      text: 'Account',
      rawText: 'Account',
      bbox: [36, 10.2, 72, 20.1],
      chars: [
        { c: 'A', bbox: [36, 10.2, 40, 20.1] },
        { c: 'c', bbox: [40, 10.2, 44, 20.1] },
      ],
      splitReason: null,
      sourceLineId: 'b',
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'Bank Account');
  assert.deepEqual(merged[0].bbox, [10, 10, 72, 20.1]);
});

test('horizontal merge rejects structurally split elements across wide-gap reasons', () => {
  const merged = mergeDetectedTextElementsHorizontally([
    {
      text: 'Label',
      rawText: 'Label',
      bbox: [10, 10, 35, 20],
      chars: [{ c: 'L', bbox: [10, 10, 14, 20] }],
      splitReason: 'large-visual-gap',
      sourceLineId: 'same-line',
    },
    {
      text: 'Value',
      rawText: 'Value',
      bbox: [37, 10, 62, 20],
      chars: [{ c: 'V', bbox: [37, 10, 41, 20] }],
      splitReason: 'large-visual-gap',
      sourceLineId: 'same-line',
    },
  ]);

  assert.equal(merged.length, 2);
});

test('horizontal merge reverses concatenation order for rtl rows', () => {
  const merged = mergeDetectedTextElementsHorizontally([
    {
      text: '073-2462700',
      rawText: '073-2462700',
      bbox: [10, 10, 52, 20],
      chars: [{ c: '0', bbox: [10, 10, 14, 20] }],
      splitReason: null,
      sourceLineId: 'rtl-line',
    },
    {
      text: 'פקס:',
      rawText: 'פקס:',
      bbox: [54, 10, 74, 20],
      chars: [{ c: 'פ', bbox: [54, 10, 58, 20] }],
      splitReason: null,
      sourceLineId: 'rtl-line',
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'פקס: 073-2462700');
});
