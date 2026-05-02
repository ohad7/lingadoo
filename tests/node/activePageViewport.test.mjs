import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveActivePageIdFromViewport,
  resolveActivePageIdFromVisibility,
} from '../../src/lib/activePageViewport.js';

test('resolveActivePageIdFromViewport follows the page that contains the top reading probe', () => {
  const rectByPageId = {
    1: { top: 100, bottom: 900 },
    2: { top: 924, bottom: 1724 },
    3: { top: 1748, bottom: 2548 },
  };

  assert.equal(resolveActivePageIdFromViewport({
    pageIds: [1, 2, 3],
    rectByPageId,
    viewportTop: 120,
    viewportBottom: 920,
    probeY: 160,
    fallbackPageId: 1,
  }), 1);

  assert.equal(resolveActivePageIdFromViewport({
    pageIds: [1, 2, 3],
    rectByPageId,
    viewportTop: 940,
    viewportBottom: 1740,
    probeY: 960,
    fallbackPageId: 1,
  }), 2);
});

test('resolveActivePageIdFromViewport prefers the page with the largest visible area', () => {
  const rectByPageId = {
    1: { top: 100, bottom: 900 },
    2: { top: 924, bottom: 1724 },
  };

  assert.equal(resolveActivePageIdFromViewport({
    pageIds: [1, 2],
    rectByPageId,
    viewportTop: 600,
    viewportBottom: 1400,
    probeY: 664,
    fallbackPageId: 1,
  }), 2);
});

test('resolveActivePageIdFromViewport chooses the next page when the viewport is in the inter-page gap', () => {
  const rectByPageId = {
    1: { top: -900, bottom: -100 },
    2: { top: 120, bottom: 920 },
  };

  assert.equal(resolveActivePageIdFromViewport({
    pageIds: [1, 2],
    rectByPageId,
    viewportTop: 0,
    viewportBottom: 800,
    probeY: 915,
    fallbackPageId: 1,
  }), 2);
});

test('resolveActivePageIdFromVisibility prefers the page with the largest visible height', () => {
  assert.equal(resolveActivePageIdFromVisibility({
    pageIds: [1, 2, 3],
    visibilityByPageId: {
      1: { visibleHeight: 220, top: -180 },
      2: { visibleHeight: 430, top: 160 },
      3: { visibleHeight: 0, top: 1200 },
    },
    fallbackPageId: 1,
  }), 2);
});

test('resolveActivePageIdFromVisibility breaks ties by proximity to the top of the viewport', () => {
  assert.equal(resolveActivePageIdFromVisibility({
    pageIds: [1, 2],
    visibilityByPageId: {
      1: { visibleHeight: 300, top: -260 },
      2: { visibleHeight: 300, top: 40 },
    },
    fallbackPageId: 1,
  }), 2);
});
