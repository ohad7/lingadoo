import assert from 'node:assert/strict';
import test from 'node:test';

import { fitEditableBlockToBBox } from '../../src/lib/pdf-core/fitting.js';
import { fitBlockToWarningPreview, recomputePageWarnings } from '../../src/lib/localEditorWarnings.js';

function buildBlock(overrides = {}) {
  return {
    source_block_id: 'b1',
    text: 'Fax: 073-2462700',
    bbox: [0, 0, 56, 8],
    font_size: 12,
    line_height: 10,
    alignment: 'left',
    font_family: 'sans-serif',
    font_weight: 'normal',
    wrap_mode: 'none',
    clip_mode: 'auto',
    overflow: false,
    collision: false,
    redacted: false,
    block_type: 'paragraph',
    ...overrides,
  };
}

test('fitBlockToWarningPreview stays aligned with warning overflow logic', () => {
  const block = buildBlock({
    bbox: [0, 0, 30, 12],
    font_size: 12,
    line_height: 10,
    wrap_mode: 'word',
  });
  const optimisticFit = fitEditableBlockToBBox(block, { minFontSize: 1 });
  const optimisticWarning = recomputePageWarnings({
    page_size_pt: [100, 100],
    blocks: [{
      ...block,
      font_size: optimisticFit.fontSize,
      line_height: optimisticFit.lineHeight,
      overflow: optimisticFit.overflow,
      truncated: optimisticFit.overflow,
      draw_plan: null,
      drawPlan: null,
    }],
  }).blocks[0];

  assert.equal(Boolean(optimisticFit.overflow), false);
  assert.equal(Boolean(optimisticWarning.overflow || optimisticWarning.truncated), true);

  const aligned = fitBlockToWarningPreview(block, {
    blocks: [block],
    pageSize: [100, 100],
  });
  const alignedWarning = recomputePageWarnings({
    page_size_pt: [100, 100],
    blocks: [{
      ...aligned,
      draw_plan: null,
      drawPlan: null,
    }],
  }).blocks[0];

  assert.equal(Boolean(alignedWarning.overflow || alignedWarning.truncated), false);
  assert.ok(Number(aligned.font_size) < Number(optimisticFit.fontSize));
});

test('fitBlockToWarningPreview can grow text after the bbox is enlarged', () => {
  const block = buildBlock({
    text: 'Short label',
    bbox: [0, 0, 80, 24],
    font_size: 6,
    line_height: 5,
  });

  const fitted = fitBlockToWarningPreview(block, {
    blocks: [block],
    pageSize: [100, 100],
    allowGrowth: true,
  });

  assert.ok(Number(fitted.font_size) > Number(block.font_size));
  const warned = recomputePageWarnings({
    page_size_pt: [100, 100],
    blocks: [{
      ...fitted,
      draw_plan: null,
      drawPlan: null,
    }],
  }).blocks[0];
  assert.equal(Boolean(warned.overflow || warned.truncated), false);
});

test('fitBlockToWarningPreview can shrink below 5pt when that is the clean fit', () => {
  const block = buildBlock({
    bbox: [0, 0, 40, 10],
    font_size: 12,
    line_height: 8,
    wrap_mode: 'word',
  });

  const fitted = fitBlockToWarningPreview(block, {
    blocks: [block],
    pageSize: [100, 100],
  });

  assert.ok(Number(fitted.font_size) < 5);
  const warned = recomputePageWarnings({
    page_size_pt: [100, 100],
    blocks: [{
      ...fitted,
      draw_plan: null,
      drawPlan: null,
    }],
  }).blocks[0];
  assert.equal(Boolean(warned.overflow || warned.truncated), false);
});

test('fitBlockToWarningPreview returns a rounded wrapped fit that stays clean after recompute', () => {
  const block = buildBlock({
    bbox: [0, 0, 30, 12],
    font_size: 12,
    line_height: 10,
    wrap_mode: 'word',
  });

  const fitted = fitBlockToWarningPreview(block, {
    blocks: [block],
    pageSize: [100, 100],
  });

  const warned = recomputePageWarnings({
    page_size_pt: [100, 100],
    blocks: [{
      ...fitted,
      draw_plan: null,
      drawPlan: null,
    }],
  }).blocks[0];
  assert.equal(Boolean(warned.overflow || warned.truncated), false);
  assert.ok(Array.isArray(warned.draw_plan?.lines));
  assert.equal(Boolean(warned.draw_plan.lines.length > 1), true);
});
