import assert from 'node:assert/strict';
import test from 'node:test';

import {
  editorGraphicBboxToSource,
  sourceGraphicBboxToEditor,
} from '../../src/lib/graphicRegionGeometry.js';

test('graphic region bbox conversions mirror editor and source coordinates symmetrically', () => {
  const editorBbox = [10, 20, 30, 40];
  const sourceBbox = editorGraphicBboxToSource(100, editorBbox, true);
  assert.deepEqual(sourceBbox, [70, 20, 90, 40]);
  assert.deepEqual(sourceGraphicBboxToEditor(100, sourceBbox, true), editorBbox);
});

test('graphic region bbox conversions pass through unchanged when mirroring is off', () => {
  const bbox = [12, 14, 26, 38];
  assert.deepEqual(editorGraphicBboxToSource(100, bbox, false), bbox);
  assert.deepEqual(sourceGraphicBboxToEditor(100, bbox, false), bbox);
});
