import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTightTextBBoxToEditorBlock,
  isEligibleForTightTextBBox,
  proposeTightTextBBox,
  resolveTightTextBBoxPreview,
} from '../../src/lib/tightTextBBoxProposal.js';

function makeBlock(overrides = {}) {
  return {
    block_type: 'text_line',
    bbox: [10, 20, 80, 40],
    bbox_edited: false,
    text_tightness: 'tight',
    source_line_count: 1,
    source_font_size: 10,
    ...overrides,
  };
}

test('proposeTightTextBBox returns a bottom-anchored tighter bbox for eligible tall blocks', () => {
  const block = makeBlock({
    bbox: [10, 20, 80, 40],
    source_font_size: 10,
  });

  assert.equal(isEligibleForTightTextBBox(block), true);
  assert.deepEqual(proposeTightTextBBox(block), [10, 28, 80, 40]);
});

test('proposeTightTextBBox trims a small capped amount when source line geometry suggests bottom slack', () => {
  const block = makeBlock({
    bbox: [10, 20, 80, 40],
    source_font_size: 10,
    source_line_bbox: [10, 16, 80, 44],
  });

  assert.equal(isEligibleForTightTextBBox(block), true);
  assert.deepEqual(proposeTightTextBBox(block), [10, 29, 80, 40]);
});

test('proposeTightTextBBox skips tight blocks with only negligible removable margin', () => {
  const block = makeBlock({
    bbox: [10, 20, 80, 29],
    source_font_size: 6,
  });

  assert.equal(isEligibleForTightTextBBox(block), true);
  assert.equal(proposeTightTextBBox(block), null);
});

test('proposeTightTextBBox skips ineligible non-tight or edited blocks', () => {
  assert.equal(proposeTightTextBBox(makeBlock({ text_tightness: 'non_tight' })), null);
  assert.equal(proposeTightTextBBox(makeBlock({ bbox_edited: true })), null);
});

test('resolveTightTextBBoxPreview uses source bbox and marks tightened vs regular display boxes', () => {
  const tightened = resolveTightTextBBoxPreview(makeBlock({
    bbox: [0, 0, 50, 20],
    source_bbox: [100, 200, 160, 220],
    source_font_size: 10,
    source_line_bbox: [100, 196, 160, 224],
  }));
  assert.deepEqual(tightened, {
    sourceBBox: [100, 200, 160, 220],
    displayBBox: [100, 209, 160, 220],
    tightened: true,
  });

  const regular = resolveTightTextBBoxPreview(makeBlock({
    bbox: [0, 0, 50, 9],
    source_bbox: [10, 20, 80, 29],
    source_font_size: 6,
  }));
  assert.deepEqual(regular, {
    sourceBBox: [10, 20, 80, 29],
    displayBBox: [10, 20, 80, 29],
    tightened: false,
  });
});

test('resolveTightTextBBoxPreview shifts the tightened bbox upward when the candidate still has internal bottom margin', () => {
  const tightened = resolveTightTextBBoxPreview(makeBlock({
    text: 'abc',
    bbox: [0, 0, 50, 20],
    source_bbox: [100, 200, 160, 220],
    source_font_size: 10,
    source_line_bbox: [100, 196, 160, 224],
    font_size: 8,
    line_height: 9.6,
    alignment: 'left',
    font_weight: 'normal',
    wrap_mode: 'word',
    clip_mode: 'auto',
  }));
  assert.deepEqual(tightened, {
    sourceBBox: [100, 200, 160, 220],
    displayBBox: [100, 207, 160, 218],
    tightened: true,
  });
});

test('applyTightTextBBoxToEditorBlock mutates bbox and pre_fit_bbox together for editor integration', () => {
  const block = applyTightTextBBoxToEditorBlock(makeBlock({
    text: 'abc',
    bbox: [100, 200, 160, 220],
    source_font_size: 10,
    font_size: 8,
    line_height: 9.6,
    alignment: 'left',
    font_weight: 'normal',
    wrap_mode: 'word',
    clip_mode: 'auto',
    pre_fit_bbox: [100, 200, 160, 220],
  }));

  assert.deepEqual(block.bbox, [100, 205, 160, 217]);
  assert.deepEqual(block.pre_fit_bbox, [100, 205, 160, 217]);
  assert.ok(block.draw_plan);
});
