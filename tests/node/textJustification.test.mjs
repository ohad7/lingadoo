import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveJustifiedLineSpacing } from '../../src/lib/textJustification.js';

test('resolveJustifiedLineSpacing returns positive preview and render spacing for multi-word lines', () => {
  const spacing = resolveJustifiedLineSpacing('one two three', {
    targetWidthPt: 120,
    fontSize: 12,
    fontWeight: 'normal',
  });

  assert.equal(spacing.gapCount, 2);
  assert.ok(spacing.fullGapWidthPt > 0);
  assert.ok(spacing.extraWordSpacingPt > 0);
});

test('resolveJustifiedLineSpacing returns zero spacing for single-word lines', () => {
  const spacing = resolveJustifiedLineSpacing('singleword', {
    targetWidthPt: 120,
    fontSize: 12,
    fontWeight: 'normal',
  });

  assert.deepEqual(spacing, {
    gapCount: 0,
    fullGapWidthPt: 0,
    extraWordSpacingPt: 0,
  });
});
