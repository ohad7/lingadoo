import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDefaultGraphicRegionEditsByPage,
  buildProtectedGraphicRegions,
} from '../../src/lib/visualRegionProtection.js';

test('buildProtectedGraphicRegions marks source graphic regions as flipped and auto protected', () => {
  const regions = buildProtectedGraphicRegions({
    pageId: 1,
    sourceGraphicRegions: [{
      region_id: 'gr_1',
      bbox: [300, 20, 360, 52],
      drawing_count: 8,
    }],
    rasterLogoCandidates: [],
  });

  assert.deepEqual(regions, [{
    region_id: 'gr_1',
    bbox: [300, 20, 360, 52],
    drawing_count: 8,
    flipped: true,
    source_kind: 'graphic_region',
    auto_protected: true,
  }]);
});

test('buildProtectedGraphicRegions adds only strong non-overlapping raster logo candidates', () => {
  const regions = buildProtectedGraphicRegions({
    pageId: 1,
    sourceGraphicRegions: [{
      region_id: 'gr_1',
      bbox: [300, 20, 360, 52],
      drawing_count: 8,
    }],
    rasterLogoCandidates: [
      { visual_id: 'r1', bbox: [302, 22, 358, 50], score: 6.4 },
      { visual_id: 'r2', bbox: [20, 12, 60, 28], score: 6.1 },
      { visual_id: 'r3', bbox: [70, 12, 95, 26], score: 5.7 },
    ],
  });

  assert.equal(regions.length, 2);
  assert.deepEqual(regions[1], {
    region_id: 'raster_logo_region_1_2',
    bbox: [20, 12, 60, 28],
    flipped: true,
    source_kind: 'raster_logo_candidate',
    auto_protected: true,
    score: 6.1,
  });
});

test('buildDefaultGraphicRegionEditsByPage emits flip edits for default protected regions', () => {
  const editsByPage = buildDefaultGraphicRegionEditsByPage([
    {
      pageId: 1,
      layout: {
        graphic_regions: [
          { region_id: 'gr_1', bbox: [1, 2, 3, 4], flipped: true },
          { region_id: 'gr_2', bbox: [4, 5, 6, 7], flipped: false },
        ],
      },
    },
  ]);

  assert.deepEqual(editsByPage, {
    1: [{ op: 'flip_graphic', block_id: 'gr_1' }],
  });
});
