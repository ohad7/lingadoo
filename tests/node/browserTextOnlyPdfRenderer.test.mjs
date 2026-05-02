import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHorizontallyShiftedGlyphTrm } from '../../src/lib/pdf-core/browserTextOnlyPdfRenderer.js';

test('buildHorizontallyShiftedGlyphTrm preserves the original vertical baseline', () => {
  const glyphTrm = [1, 0, 0, 1, 218.2769775390625, 91.65623474121094];
  const sourceBBox = [216.01895141601562, 91.65623474121094, 232.5318145751953, 102.5130844116211];
  const destinationBBox = [362.4681854248047, 91.65623474121094, 378.9810485839844, 102.5130844116211];
  const pageRect = [0, 0, 595.0, 842.0];

  const shifted = buildHorizontallyShiftedGlyphTrm({
    glyphTrm,
    sourceBBox,
    destinationBBox,
    pageRect,
  });

  assert.deepEqual(shifted.slice(0, 4), glyphTrm.slice(0, 4));
  assert.equal(shifted[4], glyphTrm[4] + (destinationBBox[0] - sourceBBox[0]));
  assert.equal(shifted[5], glyphTrm[5]);
});

test('buildHorizontallyShiftedGlyphTrm keeps y relative to the page origin when the page rect is offset', () => {
  const glyphTrm = [0.75, 0, 0, 0.75, 140, 255];
  const sourceBBox = [120, 240, 170, 270];
  const destinationBBox = [430, 240, 480, 270];
  const pageRect = [10, 20, 610, 820];

  const shifted = buildHorizontallyShiftedGlyphTrm({
    glyphTrm,
    sourceBBox,
    destinationBBox,
    pageRect,
  });

  assert.deepEqual(shifted.slice(0, 4), glyphTrm.slice(0, 4));
  assert.equal(shifted[4], glyphTrm[4] + (destinationBBox[0] - sourceBBox[0]) - pageRect[0]);
  assert.equal(shifted[5], glyphTrm[5] - pageRect[1]);
});
