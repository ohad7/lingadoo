import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyExcludedRegionsToGray,
  scoreRasterLogoComponent,
} from '../../src/lib/rasterLogoCandidates.ts';

test('scoreRasterLogoComponent accepts moderate top-corner logo-like components', () => {
  const candidate = scoreRasterLogoComponent({
    bboxPx: [720, 24, 840, 96],
    areaFg: 4200,
    perimeter: 320,
    pageWidthPx: 900,
    pageHeightPx: 1200,
    edgeDensity: 0.12,
    fgDensity: 0.48,
    symmetryScore: 0.52,
  });

  assert.ok(candidate);
  assert.ok(candidate.score >= 3);
  assert.ok(candidate.area_ratio > 0.0005);
});

test('scoreRasterLogoComponent rejects oversized central regions', () => {
  const candidate = scoreRasterLogoComponent({
    bboxPx: [180, 260, 760, 880],
    areaFg: 180000,
    perimeter: 2800,
    pageWidthPx: 900,
    pageHeightPx: 1200,
    edgeDensity: 0.22,
    fgDensity: 0.5,
    symmetryScore: 0.4,
  });

  assert.equal(candidate, null);
});

test('applyExcludedRegionsToGray whites out excluded image regions before raster detection', () => {
  const gray = new Float32Array([
    10, 20, 30, 40,
    50, 60, 70, 80,
    90, 100, 110, 120,
    130, 140, 150, 160,
  ]);

  const masked = applyExcludedRegionsToGray(gray, {
    widthPx: 4,
    heightPx: 4,
    pageWidthPt: 40,
    pageHeightPt: 40,
    excludeBboxesPt: [[10, 10, 30, 30]],
  });

  assert.deepEqual(Array.from(masked), [
    10, 20, 30, 40,
    50, 255, 255, 80,
    90, 255, 255, 120,
    130, 140, 150, 160,
  ]);
  assert.equal(gray[5], 60);
  assert.notStrictEqual(masked, gray);
});
