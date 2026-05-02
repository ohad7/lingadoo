import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOcrGroupedPageLayout,
  collectCorruptedSourceBlockIds,
  convertOcrBboxToPageBbox,
  resolveOcrBorrowedStyleId,
  shouldEnableOcrBackgroundCoverForPageSummary,
  shouldUseTextlessOcrInputForPage,
  shouldUseTextlessOcrInputForPageSummary,
} from '../../src/lib/document-runs/ocrGroupedCandidateBuilder.js';

test('convertOcrBboxToPageBbox rescales image coordinates into page points', () => {
  assert.deepEqual(
    convertOcrBboxToPageBbox([20, 10, 120, 60], {
      imageWidth: 200,
      imageHeight: 100,
      pageWidthPt: 400,
      pageHeightPt: 200,
    }),
    [40, 20, 240, 120],
  );
});

test('resolveOcrBorrowedStyleId chooses the overlapping source block style', () => {
  assert.equal(
    resolveOcrBorrowedStyleId({
      bbox: [12, 12, 48, 26],
      sourceLayout: {
        blocks: [
          { bbox: [10, 10, 50, 30], style_id: 'style-a' },
          { bbox: [60, 10, 100, 30], style_id: 'style-b' },
        ],
      },
    }),
    'style-a',
  );
});

test('buildOcrGroupedPageLayout preserves source blocks on mixed pages and adds only non-overlapping OCR groups', () => {
  const layout = buildOcrGroupedPageLayout({
    manifestDocumentId: 'doc-1',
    pageSummary: {
      page_id: 1,
      type: 'MIXED',
      width_pt: 200,
      height_pt: 100,
      direction: 'LTR',
    },
    sourceLayout: {
      schema_version: '1.0',
      stage: 'page_layout',
      document_id: 'doc-1',
      page_id: 1,
      page_size_pt: [200, 100],
      styles: [
        {
          style_id: 'style-a',
          font_family: 'Source Sans',
          font_size: 11,
          weight: 'normal',
          italic: false,
          color: '#000000',
          alignment: 'left',
          line_spacing: 1.2,
          render_mode: 0,
          stroke_width: 0,
        },
      ],
      blocks: [
        {
          block_id: 'p1_b1',
          bbox: [10, 10, 50, 30],
          style_id: 'style-a',
          text: 'Existing',
          type: 'text_line',
        },
      ],
      images: [{ image_id: 'img-1' }],
      graphic_regions: [{ region_id: 'g-1' }],
    },
    groupedBoxes: [
      {
        text: 'Existing',
        bbox: [10, 10, 50, 30],
        confidence: 0.91,
        background_fill_enabled: true,
        background_fill_color: [1, 1, 1],
      },
      { text: 'Synthetic', bbox: [120, 20, 180, 40], confidence: 0.73 },
    ],
    imageWidth: 200,
    imageHeight: 100,
  });

  assert.equal(layout.blocks.length, 2);
  assert.equal(layout.blocks[0].block_id, 'p1_b1');
  assert.equal(layout.blocks[0].style_id, 'style-a');
  assert.equal(layout.blocks[0].text, 'Existing');
  assert.equal(layout.blocks[1].block_id, 'p1_ocr_b2');
  assert.match(layout.blocks[1].style_id, /^p1_ocr_style_/);
  assert.deepEqual(layout.blocks[1].bbox, [119, 19, 181, 41]);
  assert.equal(layout.blocks[0].type, 'text_line');
  assert.equal(layout.blocks[1].source, 'ocr_grouped');
  assert.equal(layout.blocks[1].background_fill_enabled, false);
  assert.equal(layout.extraction_warning, null);
  assert.deepEqual(layout.images, []);
  assert.deepEqual(layout.graphic_regions, []);
  assert.ok(layout.styles.some((style) => style.style_id === 'style-a'));
  assert.ok(layout.styles.some((style) => String(style.style_id).startsWith('p1_ocr_style_')));
});

test('buildOcrGroupedPageLayout keeps source blocks on digital pages when OCR sees no text after textless preprocessing', () => {
  const layout = buildOcrGroupedPageLayout({
    manifestDocumentId: 'doc-1',
    pageSummary: {
      page_id: 1,
      type: 'DIGITAL',
      width_pt: 200,
      height_pt: 100,
      direction: 'LTR',
    },
    sourceLayout: {
      schema_version: '1.0',
      stage: 'page_layout',
      document_id: 'doc-1',
      page_id: 1,
      page_size_pt: [200, 100],
      styles: [
        {
          style_id: 'style-a',
          font_family: 'Source Sans',
          font_size: 11,
          weight: 'normal',
          italic: false,
          color: '#000000',
          alignment: 'left',
          line_spacing: 1.2,
          render_mode: 0,
          stroke_width: 0,
        },
      ],
      blocks: [
        {
          block_id: 'p1_b1',
          bbox: [10, 10, 50, 30],
          style_id: 'style-a',
          text: 'Existing',
          type: 'text_line',
        },
      ],
      images: [],
      graphic_regions: [],
    },
    groupedBoxes: [],
    imageWidth: 200,
    imageHeight: 100,
  });

  assert.equal(layout.blocks.length, 1);
  assert.equal(layout.blocks[0].block_id, 'p1_b1');
  assert.equal(layout.blocks[0].text, 'Existing');
});

test('buildOcrGroupedPageLayout drops corrupted source blocks and lets OCR replace them', () => {
  const layout = buildOcrGroupedPageLayout({
    manifestDocumentId: 'doc-1',
    pageSummary: {
      page_id: 1,
      type: 'DIGITAL',
      width_pt: 200,
      height_pt: 100,
      direction: 'RTL',
    },
    sourceLayout: {
      schema_version: '1.0',
      stage: 'page_layout',
      document_id: 'doc-1',
      page_id: 1,
      page_size_pt: [200, 100],
      styles: [
        {
          style_id: 'style-a',
          font_family: 'Source Sans',
          font_size: 11,
          weight: 'normal',
          italic: false,
          color: '#000000',
          alignment: 'right',
          line_spacing: 1.2,
          render_mode: 0,
          stroke_width: 0,
        },
      ],
      blocks: [
        {
          block_id: 'p1_b1',
          bbox: [10, 10, 50, 30],
          style_id: 'style-a',
          text: 'תקין',
          type: 'text_line',
        },
        {
          block_id: 'p1_b2',
          bbox: [60, 10, 100, 30],
          style_id: 'style-a',
          text: '��…‰ ��”„',
          type: 'text_line',
        },
      ],
      images: [],
      graphic_regions: [],
    },
    groupedBoxes: [
      { text: 'תקין', bbox: [10, 10, 50, 30], confidence: 0.9 },
      { text: 'חלופי', bbox: [60, 10, 100, 30], confidence: 0.9 },
    ],
    imageWidth: 200,
    imageHeight: 100,
  });

  assert.equal(layout.blocks.length, 2);
  assert.deepEqual(
    layout.blocks.map((block) => String(block.block_id)).sort(),
    ['p1_b1', 'p1_ocr_b2'],
  );
  const replacementBlock = layout.blocks.find((block) => String(block.block_id) === 'p1_ocr_b2');
  assert.ok(replacementBlock);
  assert.equal(replacementBlock.text, 'חלופי');
});

test('OCR grouped page heuristics use textless input for digital pages and block covers for mixed/scanned pages', () => {
  assert.equal(shouldUseTextlessOcrInputForPageSummary({ type: 'DIGITAL' }), true);
  assert.equal(shouldUseTextlessOcrInputForPageSummary({ type: 'MIXED' }), true);
  assert.equal(shouldUseTextlessOcrInputForPageSummary({ type: 'SCANNED' }), false);

  assert.equal(shouldEnableOcrBackgroundCoverForPageSummary({ type: 'DIGITAL' }), false);
  assert.equal(shouldEnableOcrBackgroundCoverForPageSummary({ type: 'MIXED' }), true);
  assert.equal(shouldEnableOcrBackgroundCoverForPageSummary({ type: 'SCANNED' }), true);
});

test('OCR grouped page heuristics disable textless OCR when the source layout contains corrupted blocks', () => {
  const sourceLayout = {
    blocks: [
      { block_id: 'p1_b1', text: 'תקין' },
      { block_id: 'p1_b2', text: '��…‰ ��”„' },
    ],
  };

  assert.deepEqual([...collectCorruptedSourceBlockIds(sourceLayout)], ['p1_b2']);
  assert.equal(
    shouldUseTextlessOcrInputForPage({
      pageSummary: { type: 'DIGITAL' },
      sourceLayout,
    }),
    false,
  );
  assert.equal(
    shouldUseTextlessOcrInputForPage({
      pageSummary: { type: 'DIGITAL' },
      sourceLayout: { blocks: [{ block_id: 'p1_b1', text: 'תקין' }] },
    }),
    true,
  );
});
