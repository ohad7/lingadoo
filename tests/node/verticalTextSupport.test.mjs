import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectTextOrientationFromChars,
  resolveTextRenderRotationDeg,
  TEXT_ORIENTATION,
} from '../../src/lib/textOrientation.js';
import {
  __testOnly as browserTextDetectionTestOnly,
  splitNonTightDetectedTextElement,
} from '../../src/lib/pdf-core/browserTextDetection.js';
import {
  rebuildLocalDrawPlan,
  sourceClipDefaultsForLayout,
} from '../../src/lib/localEditorDrawPlan.js';
import { fitEditableBlockToBBox } from '../../src/lib/pdf-core/fitting.js';

const { buildDetectedTextElementFromChars } = browserTextDetectionTestOnly;

function makeVerticalChars() {
  return [
    { c: '0', bbox: [26.334, 753.178, 34.23, 756.676], originalIndex: 0 },
    { c: '5', bbox: [26.334, 749.68, 34.23, 753.178], originalIndex: 1 },
    { c: '1', bbox: [26.334, 746.182, 34.23, 749.68], originalIndex: 2 },
    { c: '-', bbox: [26.334, 742.684, 34.23, 746.182], originalIndex: 3 },
    { c: '1', bbox: [26.334, 739.186, 34.23, 742.684], originalIndex: 4 },
    { c: '4', bbox: [26.334, 735.688, 34.23, 739.186], originalIndex: 5 },
    { c: '2', bbox: [26.334, 732.19, 34.23, 735.688], originalIndex: 6 },
    { c: '9', bbox: [26.334, 728.692, 34.23, 732.19], originalIndex: 7 },
  ];
}

function makeSplitParentVerticalChars() {
  const text = '051   1/10   D0';
  const chars = [];
  let yTop = 756.676;
  for (const character of text) {
    const height = character === ' ' ? 1.745 : 3.498;
    chars.push({
      c: character,
      bbox: [26.334, yTop - height, 34.23, yTop],
      originalIndex: chars.length,
    });
    yTop -= height;
  }
  return chars;
}

function makeVerticalBlock(overrides = {}) {
  return {
    source_block_id: 'p1_b87',
    text: '051-1429295  (246774)',
    bbox: [26.334362030029297, 690.666015625, 34.23025131225586, 756.6756591796875],
    font_size: 7.896,
    line_height: 9.4752,
    font_weight: 'normal',
    alignment: 'left',
    wrap_mode: 'word',
    clip_mode: 'auto',
    source_clip_default: false,
    bbox_edited: false,
    source_line_count: 1,
    source_text_orientation: 'vertical_ttb',
    block_type: 'text_line',
    text_tightness: 'split-tight',
    ...overrides,
  };
}

test('detectTextOrientationFromChars recognizes top-to-bottom vertical stacks', () => {
  assert.equal(detectTextOrientationFromChars(makeVerticalChars()), TEXT_ORIENTATION.VERTICAL_TTB);
  assert.equal(detectTextOrientationFromChars([
    { c: 'A', bbox: [10, 10, 14, 18], originalIndex: 0 },
    { c: 'B', bbox: [15, 10, 19, 18], originalIndex: 1 },
    { c: 'C', bbox: [20, 10, 24, 18], originalIndex: 2 },
  ]), TEXT_ORIENTATION.HORIZONTAL);
});

test('sourceClipDefaultsForLayout evaluates vertical blocks in their rotated frame', () => {
  const defaults = sourceClipDefaultsForLayout({
    styles: [{
      style_id: 's19',
      font_family: 'AllAndNone',
      font_size: 6.0,
      weight: 'normal',
      line_spacing: 1.2,
    }],
    blocks: [{
      block_id: 'p1_b87',
      style_id: 's19',
      bbox: [26.334362030029297, 690.666015625, 34.23025131225586, 756.6756591796875],
      text: '051-1429295  (246774)',
      source_text_orientation: 'vertical_ttb',
      type: 'text_line',
    }],
  });
  assert.equal(defaults.p1_b87, false);
});

test('rebuildLocalDrawPlan preserves a full single line for vertical text blocks', () => {
  const result = rebuildLocalDrawPlan(makeVerticalBlock({
    font_size: 6.0,
    line_height: 7.2,
  }));
  assert.equal(result.drawPlan.text_orientation, 'vertical_ttb');
  assert.equal(result.drawPlan.lines.length, 1);
  assert.equal(result.drawPlan.lines[0].text, '051-1429295  (246774)');
  assert.equal(result.truncated, false);
  assert.equal(result.overflow, false);
  assert.equal(result.redacted, false);
});

test('fitEditableBlockToBBox fits vertical text along the tall axis', () => {
  const fit = fitEditableBlockToBBox(makeVerticalBlock({
    font_size: 12,
    line_height: 14.4,
  }));
  assert.equal(fit.lines.length, 1);
  assert.equal(fit.lines[0], '051-1429295  (246774)');
  assert.equal(fit.overflow, false);
  assert.ok(fit.fontSize < 12);
  assert.ok(fit.fontSize > 6.2);
  assert.ok(fit.fontSize < 6.6);
});

test('split vertical parent runs preserve vertical orientation on short child segments', () => {
  const parent = buildDetectedTextElementFromChars(makeSplitParentVerticalChars(), {
    sourceLineId: 'b0_l0',
    sourceLineBBox: [26.334, 656.137, 34.23, 756.676],
    sourceLineIndex: 0,
    sourceBlockIndex: 0,
  });
  assert.equal(parent.sourceTextOrientation, TEXT_ORIENTATION.VERTICAL_TTB);

  const split = splitNonTightDetectedTextElement(parent);
  assert.equal(split.success, true);

  const byText = new Map(split.segments.map((segment) => [segment.text, segment]));
  assert.equal(byText.get('051')?.sourceTextOrientation, TEXT_ORIENTATION.VERTICAL_TTB);
  assert.equal(byText.get('1/10')?.sourceTextOrientation, TEXT_ORIENTATION.VERTICAL_TTB);
  assert.equal(byText.get('D0')?.sourceTextOrientation, TEXT_ORIENTATION.VERTICAL_TTB);
});

test('resolveTextRenderRotationDeg flips vertical rotation when mirroring is enabled', () => {
  assert.equal(resolveTextRenderRotationDeg('vertical_ttb', false), 90);
  assert.equal(resolveTextRenderRotationDeg('vertical_ttb', true), -90);
  assert.equal(resolveTextRenderRotationDeg('horizontal', true), 0);
});
