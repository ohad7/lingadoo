import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeContinuationPairsInLayout } from '../../src/lib/continuationLayoutMerge.js';

function style(style_id, overrides = {}) {
  return {
    style_id,
    font_family: 'ArialMT',
    font_size: 10,
    weight: 'normal',
    italic: false,
    color: '#000000',
    alignment: 'left',
    line_spacing: 1.2,
    render_mode: 0,
    stroke_width: 0,
    ...overrides,
  };
}

function block(block_id, reading_order, bbox, text, overrides = {}) {
  return {
    block_id,
    page_id: 1,
    type: 'text_line',
    bbox,
    text,
    style_id: 's1',
    reading_order,
    source: 'detected_text',
    confidence: 0.98,
    flattened_line_breaks: false,
    original_text: null,
    text_tightness: 'tight',
    source_text_orientation: 'horizontal',
    source_line_bbox: bbox,
    source_bottom_inset_ratio: 0,
    mixed_bidi_reconstructed: false,
    ...overrides,
  };
}

function hBarrier(x, y1, y2) {
  return { barrier_id: `h_${x}_${y1}_${y2}`, x, y1, y2, kind: 'hybrid', score: 1 };
}

function vBarrier(y, x1, x2) {
  return { barrier_id: `v_${y}_${x1}_${x2}`, y, x1, x2, kind: 'hybrid', score: 1 };
}

test('mergeContinuationPairsInLayout replaces a conservative 2-block continuation pair with a merged block', () => {
  const layout = {
    schema_version: '1.0',
    stage: 'layout_extraction',
    document_id: 'doc-1',
    page_id: 1,
    page_size_pt: [300, 300],
    blocks: [
      block('p1_b1', 1, [100, 50, 200, 62], 'בחלק זה מובאים נתונים בגין'),
      block('p1_b2', 2, [100, 64, 200, 76], 'כל אחת מהקרנות'),
      block('p1_b3', 3, [220, 50, 280, 62], 'כותרת.', { style_id: 's2' }),
    ],
    styles: [
      style('s1'),
      style('s2', { font_size: 11 }),
    ],
    images: [],
    graphic_regions: [],
    tables: [],
  };

  const merged = mergeContinuationPairsInLayout(layout, {
    horizontalBarriers: [hBarrier(90, 40, 90), hBarrier(210, 40, 90)],
    verticalBarriers: [vBarrier(40, 90, 210), vBarrier(90, 90, 210)],
  });

  assert.deepEqual(
    merged.blocks.map((item) => item.block_id),
    ['p1_m1', 'p1_b3'],
  );
  assert.deepEqual(
    merged.blocks.map((item) => item.reading_order),
    [1, 2],
  );
  assert.equal(merged.blocks[0].text, 'בחלק זה מובאים נתונים בגין כל אחת מהקרנות');
  assert.deepEqual(merged.blocks[0].bbox, [100, 50, 200, 76]);
  assert.equal(merged.blocks[0].style_id, 's1');
  assert.deepEqual(merged.blocks[0].merged_from_block_ids, ['p1_b1', 'p1_b2']);

  assert.deepEqual(
    layout.blocks.map((item) => item.block_id),
    ['p1_b1', 'p1_b2', 'p1_b3'],
  );
});

test('mergeContinuationPairsInLayout rejects pairs that only share a larger container cell', () => {
  const layout = {
    schema_version: '1.0',
    stage: 'layout_extraction',
    document_id: 'doc-2',
    page_id: 1,
    page_size_pt: [300, 300],
    blocks: [
      block('p1_b1', 1, [20, 30, 90, 42.5], 'בחלק זה מובאים נתונים בגין'),
      block('p1_b2', 2, [20, 44.5, 90, 56.5], 'כל אחת מהקרנות'),
    ],
    styles: [style('s1')],
    images: [],
    graphic_regions: [],
    tables: [],
  };

  const merged = mergeContinuationPairsInLayout(layout, {
    horizontalBarriers: [hBarrier(10, 20, 60), hBarrier(100, 20, 60)],
    verticalBarriers: [
      vBarrier(20, 10, 100),
      vBarrier(40, 10, 100),
      vBarrier(60, 10, 100),
    ],
  });

  assert.deepEqual(
    merged.blocks.map((item) => item.block_id),
    ['p1_b1', 'p1_b2'],
  );
});

test('mergeContinuationPairsInLayout ignores longer continuation chains in v1', () => {
  const layout = {
    schema_version: '1.0',
    stage: 'layout_extraction',
    document_id: 'doc-3',
    page_id: 1,
    page_size_pt: [300, 300],
    blocks: [
      block('p1_b1', 1, [100, 50, 200, 62], 'בחלק זה מובאים נתונים בגין'),
      block('p1_b2', 2, [100, 64, 200, 76], 'כל אחת מהקרנות שהוזכרו של'),
      block('p1_b3', 3, [100, 78, 200, 90], 'מהקרנות הקיימות'),
    ],
    styles: [style('s1')],
    images: [],
    graphic_regions: [],
    tables: [],
  };

  const merged = mergeContinuationPairsInLayout(layout, {
    horizontalBarriers: [hBarrier(90, 40, 100), hBarrier(210, 40, 100)],
    verticalBarriers: [vBarrier(40, 90, 210), vBarrier(100, 90, 210)],
  });

  assert.deepEqual(
    merged.blocks.map((item) => item.block_id),
    ['p1_b1', 'p1_b2', 'p1_b3'],
  );
});
