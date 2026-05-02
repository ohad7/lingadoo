import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { fitEditableBlockToBBox, fitPageLayout } from '../../src/lib/pdf-core/fitting.js';
import {
  buildStoredDrawPlanForFittedBlock,
  sourceClipDefaultsForLayout,
} from '../../src/lib/localEditorDrawPlan.js';
import {
  buildDetectedTextLayoutsFromPdfData,
  buildManifestFromPdfData,
  detectBackgroundTextImageWarning,
  detectExtractionWarningForText,
} from '../../src/lib/pdf-core/mupdfExtraction.js';
import { sourceWrapDefaultsForLayout } from '../../src/lib/pdf-core/webPreviewArtifacts.js';
import {
  applyAutoNudgeToPage,
  finalizeEditorPageWarnings,
  recomputePageWarnings,
} from '../../src/lib/localEditorWarnings.js';
import { createLocalEditorSession } from '../../src/lib/localEditorSession.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('detected text extraction emits text_line blocks and preserves styles', async () => {
  const fixturePath = path.join(repoRoot, 'tests', 'documents', 'report_1_test.pdf');
  const pdfBytes = await fs.readFile(fixturePath);
  const manifest = await buildManifestFromPdfData(pdfBytes, {
    sourcePdf: 'report_1_test.pdf',
    documentId: 'detected-text-test',
  });
  const layouts = await buildDetectedTextLayoutsFromPdfData(pdfBytes, {
    manifest,
    requestedPages: [1],
  });

  assert.equal(layouts.length, 1);
  const layout = layouts[0];
  assert.ok(Array.isArray(layout.blocks));
  assert.ok(layout.blocks.length > 0);
  assert.ok(layout.blocks.every((block) => block.type === 'text_line'));
  assert.ok(layout.blocks.every((block) => typeof block.style_id === 'string' && block.style_id.length > 0));
  assert.ok(layout.blocks.every((block) => typeof block.text_tightness === 'string' && block.text_tightness.length > 0));
  assert.ok(layout.blocks.some((block) => String(block.text).includes('פקס')));
  assert.ok(layout.blocks.some((block) => String(block.text) === 'פקס: 073-2462700'));
  assert.ok(Array.isArray(layout.styles));
  assert.ok(layout.styles.length > 0);
});

test('page extraction warning detector flags mojibake and ignores normal text', () => {
  const suspicious = detectExtractionWarningForText('��…‰ ��”„');
  const normal = detectExtractionWarningForText('סוג אישור Certificate Type');

  assert.equal(suspicious?.suspicious, true);
  assert.ok(Array.isArray(suspicious?.reasons));
  assert.ok(suspicious.reasons.includes('replacement_chars'));
  assert.equal(normal, null);
});

test('background text image warning flags text-heavy full-page image layouts', () => {
  const warning = detectBackgroundTextImageWarning({
    pageSize: [595, 842],
    imageBlocks: [{
      bbox: [0, 0, 600, 837],
    }],
    blockCount: 17,
    textLength: 209,
  });
  const normal = detectBackgroundTextImageWarning({
    pageSize: [595, 842],
    imageBlocks: [{
      bbox: [40, 40, 140, 140],
    }],
    blockCount: 12,
    textLength: 48,
  });

  assert.equal(warning?.suspicious, true);
  assert.ok(warning?.reasons.includes('background_text_image'));
  assert.equal(normal, null);
});

test('local editor session preserves page extraction warnings', async () => {
  const extractionWarning = {
    suspicious: true,
    reasons: ['replacement_chars'],
    score: 0.91,
  };
  const layout = {
    document_id: 'warning-doc',
    page_id: 1,
    page_size_pt: [120, 120],
    extraction_warning: extractionWarning,
    blocks: [{
      block_id: 'p1_b1',
      page_id: 1,
      type: 'text_line',
      bbox: [10, 10, 60, 20],
      text: '��…‰',
      style_id: 's1',
      reading_order: 1,
      text_tightness: 'tight',
    }],
    styles: [{
      style_id: 's1',
      font_family: 'unknown',
      font_size: 10,
      weight: 'normal',
      italic: false,
      color: '#000000',
      alignment: 'left',
      line_spacing: 1.2,
      render_mode: 0,
      stroke_width: 0,
    }],
    graphic_regions: [],
  };
  const fitted = {
    document_id: 'warning-doc',
    page_id: 1,
    blocks: [{
      source_block_id: 'p1_b1',
      style_id: 's1',
      translated_text: 'garbled',
      bbox: [10, 10, 60, 20],
      font_size: 10,
      line_height: 12,
      lines: ['garbled'],
      overflow: false,
      collision: false,
    }],
  };
  const { session, runtime } = createLocalEditorSession({
    sourcePdfName: 'warning.pdf',
    sourcePdfBytes: new Uint8Array([1, 2, 3]),
    manifest: {
      document_id: 'warning-doc',
      source_pdf: 'warning.pdf',
      page_count: 1,
      pages: [{ page_id: 1 }],
    },
    pageArtifactsById: new Map([[1, { layout, fitted }]]),
    renderedPages: [{
      pageId: 1,
      widthPt: 120,
      heightPt: 120,
      pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
      tables: [],
    }],
    openingNotice: 'Skipped page 2 because it looks scanned or image-only.',
    previewMode: 'detected-text-editor',
  });

  const page = await runtime.fetchPage(session, 1);
  runtime.disposeSession(session);
  assert.deepEqual(page.extraction_warning, extractionWarning);
  assert.equal(session.opening_notice, 'Skipped page 2 because it looks scanned or image-only.');
});

test('text_line blocks default to word wrap during fitting', () => {
  const wrapDefaults = sourceWrapDefaultsForLayout({
    blocks: [
      {
        block_id: 'b1',
        type: 'text_line',
        flattened_line_breaks: false,
      },
    ],
  });
  assert.equal(wrapDefaults.b1, 'word');

  const fit = fitEditableBlockToBBox({
    text: 'This translated line needs wrapping in a narrow detected text box',
    bbox: [0, 0, 110, 36],
    font_size: 12,
    source_font_size: 12,
    line_height: 14.4,
    block_type: 'text_line',
    wrap_mode: 'none',
  });
  assert.ok(fit.lines.length > 1);
});

test('local draw plan ignores semantic alignment for tight text but preserves it for non-tight text', () => {
  const style = {
    style_id: 's1',
    font_family: 'unknown',
    font_size: 10,
    weight: 'normal',
    italic: false,
    color: '#000000',
    alignment: 'center',
    line_spacing: 1.2,
    render_mode: 0,
    stroke_width: 0,
  };
  const tightBuilt = buildStoredDrawPlanForFittedBlock({
    fittedBlock: {
      source_block_id: 'b1',
      translated_text: 'Hello',
      bbox: [0, 0, 80, 20],
      font_size: 10,
      line_height: 12,
      overflow: false,
      text_tightness: 'tight',
    },
    sourceBlock: {
      block_id: 'b1',
      type: 'text_line',
      text: 'שלום',
      text_tightness: 'tight',
    },
    style,
    sourceClipDefault: false,
    clipMode: 'auto',
    bboxEdited: false,
    fauxBoldPolicy: 'semantic',
  }).block;
  const nonTightBuilt = buildStoredDrawPlanForFittedBlock({
    fittedBlock: {
      source_block_id: 'b2',
      translated_text: 'Hello',
      bbox: [0, 0, 80, 20],
      font_size: 10,
      line_height: 12,
      overflow: false,
      text_tightness: 'non-tight',
    },
    sourceBlock: {
      block_id: 'b2',
      type: 'text_line',
      text: 'שלום',
      text_tightness: 'non-tight',
    },
    style,
    sourceClipDefault: false,
    clipMode: 'auto',
    bboxEdited: false,
    fauxBoldPolicy: 'semantic',
  }).block;

  const tightX = Number(tightBuilt.draw_plan.lines[0].x_pt);
  const nonTightX = Number(nonTightBuilt.draw_plan.lines[0].x_pt);
  assert.equal(tightX, 1, 'tight text should render from the start edge');
  assert.ok(nonTightX > tightX + 5, 'non-tight text should still honor centered alignment');
});

test('local draw plan honors manual semantic alignment override for tight text', () => {
  const style = {
    style_id: 's1',
    font_family: 'unknown',
    font_size: 10,
    weight: 'normal',
    italic: false,
    color: '#000000',
    alignment: 'center',
    line_spacing: 1.2,
    render_mode: 0,
    stroke_width: 0,
  };
  const built = buildStoredDrawPlanForFittedBlock({
    fittedBlock: {
      source_block_id: 'b1',
      translated_text: 'Hello',
      bbox: [0, 0, 80, 20],
      font_size: 10,
      line_height: 12,
      overflow: false,
      text_tightness: 'tight',
      alignment_edited: true,
    },
    sourceBlock: {
      block_id: 'b1',
      type: 'text_line',
      text: 'שלום',
      text_tightness: 'tight',
    },
    style,
    sourceClipDefault: false,
    clipMode: 'auto',
    bboxEdited: false,
    fauxBoldPolicy: 'semantic',
  }).block;

  const centeredX = Number(built.draw_plan.lines[0].x_pt);
  assert.ok(centeredX > 5, 'tight text with manual alignment override should honor centered alignment');
});

test('local draw plan can preserve vertical source anchor for tight single-line text', () => {
  const style = {
    style_id: 's1',
    font_family: 'unknown',
    font_size: 10,
    weight: 'normal',
    italic: false,
    color: '#000000',
    alignment: 'left',
    line_spacing: 1.2,
    render_mode: 0,
    stroke_width: 0,
  };
  const baseArgs = {
    fittedBlock: {
      source_block_id: 'b1',
      translated_text: 'Frame total',
      bbox: [0, 0, 140, 26],
      font_size: 10,
      line_height: 12,
      overflow: false,
      text_tightness: 'split-tight',
    },
    sourceBlock: {
      block_id: 'b1',
      type: 'text_line',
      text: 'סכום המסגרת',
      text_tightness: 'split-tight',
      source_bottom_inset_ratio: 0.14,
    },
    style,
    sourceClipDefault: false,
    clipMode: 'auto',
    bboxEdited: false,
    fauxBoldPolicy: 'semantic',
  };
  const withoutAnchor = buildStoredDrawPlanForFittedBlock({
    ...baseArgs,
    preserveVerticalSourceAnchor: false,
  }).block;
  const withAnchor = buildStoredDrawPlanForFittedBlock({
    ...baseArgs,
    preserveVerticalSourceAnchor: true,
  }).block;

  const baselineWithout = Number(withoutAnchor.draw_plan.lines[0].baseline_pt);
  const baselineWith = Number(withAnchor.draw_plan.lines[0].baseline_pt);
  assert.ok(baselineWith > baselineWithout + 2, 'preserved source anchor should push the single line lower in the bbox');
  assert.equal(withAnchor.bbox[1], withoutAnchor.bbox[1]);
  assert.equal(withAnchor.bbox[3], withoutAnchor.bbox[3]);
  assert.equal(withAnchor.font_size, withoutAnchor.font_size);
});

test('editable bbox fit can cap resize refit at the current font size', () => {
  const block = {
    text: 'Quarterly report for the end of the quarter',
    bbox: [0, 0, 180, 26],
    font_size: 7.4,
    source_font_size: 11.8,
    line_height: 8.88,
    block_type: 'text_line',
    wrap_mode: 'word',
    bbox_edited: true,
  };
  const uncapped = fitEditableBlockToBBox(block);
  const capped = fitEditableBlockToBBox(block, { maxFontSize: 7.4 });

  assert.ok(uncapped.fontSize > 7.4, 'default resize fit still grows toward the source font size');
  assert.ok(capped.fontSize <= 7.4, 'capped resize fit should not grow beyond the current font size');
});

test('edited joined blocks ignore inherited single-line clip hints during fit', () => {
  const joinedBlock = {
    text: 'בדוק אם סכומי הביטוח שלך מתאימים לצרכיך',
    bbox: [503.486, 202.14, 546.706, 252.07],
    font_size: 6.828,
    source_font_size: 10.86,
    line_height: 8.1936,
    block_type: 'text_line',
    wrap_mode: 'word',
    source_clip_default: true,
    source_line_count: 1,
    clip_mode: 'auto',
  };

  const inherited = fitEditableBlockToBBox(joinedBlock);
  const edited = fitEditableBlockToBBox({
    ...joinedBlock,
    bbox_edited: true,
  });

  assert.ok(inherited.fontSize <= 5, 'inherited single-line clip hints should force a small fallback font');
  assert.equal(inherited.overflow, true);
  assert.ok(edited.fontSize > inherited.fontSize);
  assert.equal(edited.overflow, false);
});

test('stored draw plan does not suppress overflow warnings from source_clip_default', () => {
  const built = buildStoredDrawPlanForFittedBlock({
    fittedBlock: {
      source_block_id: 'b1',
      style_id: 's1',
      translated_text: '226313',
      bbox: [0, 0, 30, 8.4],
      font_size: 7.7,
      line_height: 9.24,
      lines: ['226313'],
      overflow: true,
      collision: false,
    },
    sourceBlock: {
      block_id: 'b1',
      text: '226313',
      type: 'text_line',
      text_tightness: 'tight',
    },
    style: {
      style_id: 's1',
      font_family: 'LingadooPreview',
      font_size: 11,
      weight: 'bold',
      italic: false,
      color: '#000000',
      alignment: 'left',
      line_spacing: 1.2,
      render_mode: 0,
      stroke_width: 0,
    },
    sourceClipDefault: true,
    clipMode: 'auto',
    bboxEdited: false,
    fauxBoldPolicy: 'semantic',
  }).block;

  assert.equal(built.truncated, false);
  assert.equal(built.overflow, true, 'source_clip_default should no longer hide overflow in the editor draw plan');
  assert.equal(built.redacted, true);
});

test('stored draw plan still suppresses overflow warnings for explicit clip mode on', () => {
  const built = buildStoredDrawPlanForFittedBlock({
    fittedBlock: {
      source_block_id: 'b1',
      style_id: 's1',
      translated_text: '226313',
      bbox: [0, 0, 30, 8.4],
      font_size: 7.7,
      line_height: 9.24,
      lines: ['226313'],
      overflow: true,
      collision: false,
    },
    sourceBlock: {
      block_id: 'b1',
      text: '226313',
      type: 'text_line',
      text_tightness: 'tight',
    },
    style: {
      style_id: 's1',
      font_family: 'LingadooPreview',
      font_size: 11,
      weight: 'bold',
      italic: false,
      color: '#000000',
      alignment: 'left',
      line_spacing: 1.2,
      render_mode: 0,
      stroke_width: 0,
    },
    sourceClipDefault: true,
    clipMode: 'on',
    bboxEdited: false,
    fauxBoldPolicy: 'semantic',
  }).block;

  assert.equal(built.truncated, false);
  assert.equal(built.overflow, false, 'explicit clip mode should continue to suppress overflow warnings');
  assert.equal(built.redacted, false);
});

test('detected text fit survives stored draw-plan rebuild for tight one-line blocks', async () => {
  const fixturePath = path.join(repoRoot, 'tests', 'documents', 'report_1_test.pdf');
  const pdfBytes = await fs.readFile(fixturePath);
  const manifest = await buildManifestFromPdfData(pdfBytes, {
    sourcePdf: 'report_1_test.pdf',
    documentId: 'detected-text-fit-regression',
  });
  const [layout] = await buildDetectedTextLayoutsFromPdfData(pdfBytes, {
    manifest,
    requestedPages: [1],
  });
  const targetIds = new Set(['p1_b10']);
  const targetBlocks = layout.blocks.filter((block) => targetIds.has(String(block.block_id)));
  const fitted = fitPageLayout(
    { ...layout, blocks: targetBlocks },
    {
      document_id: layout.document_id,
      page_id: layout.page_id,
      blocks: targetBlocks.map((block) => ({
        block_id: block.block_id,
        translated_text: block.text,
      })),
    },
    {
      wrapMode: 'none',
      wrapModeOverridesByBlockId: Object.fromEntries(targetBlocks.map((block) => [block.block_id, 'word'])),
    },
  );
  const stylesById = new Map(layout.styles.map((style) => [String(style.style_id), style]));
  const sourceClipDefaultsById = sourceClipDefaultsForLayout(layout);

  for (const fittedBlock of fitted.blocks) {
    const sourceBlock = targetBlocks.find((block) => block.block_id === fittedBlock.source_block_id);
    const style = stylesById.get(String(fittedBlock.style_id));
    const built = buildStoredDrawPlanForFittedBlock({
      fittedBlock,
      sourceBlock,
      style,
      sourceClipDefault: Boolean(sourceClipDefaultsById[String(fittedBlock.source_block_id)]),
      clipMode: 'auto',
      bboxEdited: false,
      fauxBoldPolicy: 'semantic',
    }).block;
    assert.equal(built.truncated, false, `${fittedBlock.source_block_id} should not truncate after fit`);
    assert.equal(built.overflow, false, `${fittedBlock.source_block_id} should not overflow after fit`);
  }
});

test('detected text mirror stage preserves p1_b17 bbox during main fitting by default', async () => {
  const fixturePath = path.join(repoRoot, 'tests', 'documents', 'report_1_test.pdf');
  const translationsPath = path.join(__dirname, 'fixtures', 'report_1_test.browser-translator.json');
  const pdfBytes = await fs.readFile(fixturePath);
  const mockRun = JSON.parse(await fs.readFile(translationsPath, 'utf8'));
  const manifest = await buildManifestFromPdfData(pdfBytes, {
    sourcePdf: 'report_1_test.pdf',
    documentId: 'detected-text-no-expansion-default',
  });
  const [layout] = await buildDetectedTextLayoutsFromPdfData(pdfBytes, {
    manifest,
    requestedPages: [1],
  });
  const translations = {
    ...mockRun.translations[0],
    document_id: layout.document_id,
  };
  const { buildDetectedTextMirroredArtifacts } = await import('../../src/lib/pdf-core/detectedTextMirrorStage.js');
  const artifacts = buildDetectedTextMirroredArtifacts(layout, {
    translations,
    mirrorEnabled: true,
  });
  const block = artifacts.fitted.blocks.find((item) => item.source_block_id === 'p1_b17');
  assert.ok(block, 'p1_b17 should exist in fitted blocks');
  assert.deepEqual(block.bbox, block.pre_fit_bbox, 'main fitting should preserve the original mirrored bbox by default');
  assert.equal(block.collision, false, 'preserving the original bbox should not introduce a collision');
});

function makeSyntheticLayout(blocks, styles, pageSize = [595, 842]) {
  return {
    document_id: 'test-doc',
    page_id: 1,
    page_size_pt: pageSize,
    blocks,
    styles,
  };
}

function makeSyntheticTranslations(blocks) {
  return {
    document_id: 'test-doc',
    page_id: 1,
    blocks: blocks.map((block) => ({
      block_id: block.block_id,
      translated_text: block.translated_text || block.text,
    })),
  };
}

test('main fit keeps source bbox even when translated text overflows', () => {
  const style = {
    style_id: 's1',
    font_size: 12,
    line_spacing: 1.2,
    alignment: 'left',
    weight: 'normal',
  };
  const block = {
    block_id: 'b1',
    type: 'paragraph',
    style_id: 's1',
    bbox: [50, 100, 140, 118],
    text: 'source',
    reading_order: 1,
  };
  const layout = makeSyntheticLayout([block], [style]);
  const translations = makeSyntheticTranslations([{
    block_id: 'b1',
    translated_text: 'This is a longer translated text that overflows',
  }]);

  const result = fitPageLayout(layout, translations, {
    wrapMode: 'none',
  });
  const fitted = result.blocks[0];
  assert.equal(fitted.overflow, true, 'overflow should remain when no post-fit expansion exists');
  assert.deepEqual(fitted.bbox, [50, 100, 140, 118], 'main fit should preserve the source bbox');
});

test('bucket ratio mode assigns one nominal font size across the same style bucket', () => {
  const style = {
    style_id: 's1',
    font_family: 'Subset+Helvetica',
    font_size: 12,
    line_spacing: 1.2,
    alignment: 'left',
    weight: 'normal',
    italic: false,
  };
  const blocks = [
    {
      block_id: 'b1',
      type: 'text_line',
      style_id: 's1',
      bbox: [50, 100, 260, 118],
      text: 'source one',
      reading_order: 1,
      translated_text: 'Expected payments from the provident fund',
    },
    {
      block_id: 'b2',
      type: 'text_line',
      style_id: 's1',
      bbox: [50, 130, 170, 148],
      text: 'source two',
      reading_order: 2,
      translated_text: 'Expected payments from the provident fund',
    },
  ];
  const layout = makeSyntheticLayout(blocks, [style]);
  const translations = makeSyntheticTranslations(blocks);

  const defaultFit = fitPageLayout(layout, translations, {
    wrapMode: 'none',
    wrapModeOverridesByBlockId: { b1: 'word', b2: 'word' },
  });
  const bucketFit = fitPageLayout(layout, translations, {
    wrapMode: 'none',
    wrapModeOverridesByBlockId: { b1: 'word', b2: 'word' },
    useBucketFontRatio: true,
  });

  assert.notEqual(defaultFit.blocks[0].font_size, defaultFit.blocks[1].font_size, 'default fit should still size the blocks independently');
  assert.equal(bucketFit.blocks[0].font_size, bucketFit.blocks[1].font_size, 'bucket ratio mode should assign one nominal size to the whole bucket');
  assert.equal(bucketFit.blocks[0].fit_strategy, 'bucket_ratio');
  assert.equal(bucketFit.blocks[1].fit_strategy, 'bucket_ratio');
  assert.ok(bucketFit.blocks[0].bucket_ratio > 0);
  assert.ok(bucketFit.blocks[1].bucket_ratio > 0);
});

// --- Post-warning auto-nudge (applyAutoNudgeToPage) tests ---

function makeEditorPage(blocks, pageSize = [595, 842]) {
  return {
    session_id: 'test',
    document_id: 'test-doc',
    page_id: 1,
    page_size_pt: pageSize,
    preview_url: '',
    blocks: blocks.map((b) => ({
      source_block_id: b.source_block_id || b.block_id,
      block_type: b.block_type || 'paragraph',
      bbox: b.bbox,
      text: b.text,
      font_size: b.font_size || 12,
      source_font_size: b.source_font_size || 12,
      font_weight: b.font_weight || 'normal',
      alignment: b.alignment || 'left',
      line_height: b.line_height || 14.4,
      line_spacing: b.line_spacing || 1.2,
      overflow: false,
      truncated: false,
      collision: false,
      collides_with: [],
      wrap_mode: b.wrap_mode || 'word',
      source_line_count: b.source_line_count || 1,
      source_clip_default: false,
      clip_mode: 'auto',
      bbox_edited: false,
      pre_fit_bbox: b.pre_fit_bbox || undefined,
      ...b.extra,
    })),
    tables: [],
  };
}

test('post-warning auto-nudge expands bbox for overflowing block', () => {
  const page = makeEditorPage([{
    source_block_id: 'b1',
    bbox: [50, 100, 140, 118],
    text: 'This is a long translated text that definitely overflows the tiny box',
    font_size: 12,
    source_font_size: 12,
  }]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks[0];
  const originalWidth = 140 - 50;
  const resultWidth = block.bbox[2] - block.bbox[0];
  assert.ok(resultWidth > originalWidth, 'bbox should be wider after post-warning auto-nudge');
});

test('post-warning bucket ratio mode shrinks only after rightward nudge fails', () => {
  const page = makeEditorPage([{
    source_block_id: 'b1',
    bbox: [530, 100, 590, 118],
    text: 'Expected payments from the provident fund during the reporting period',
    font_size: 12,
    source_font_size: 12,
    line_height: 14.4,
    block_type: 'text_line',
    wrap_mode: 'word',
    alignment: 'left',
    extra: {
      fit_strategy: 'bucket_ratio',
      bucket_ratio: 1,
      nominal_font_size: 12,
      overflow: true,
      truncated: true,
    },
  }]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks[0];
  assert.ok(block.font_size < 12, 'bucket ratio fallback should shrink only after rightward nudge cannot clear the issue');
  assert.equal(block.bbox[0], 530, 'fallback shrink should keep the original left edge');
  assert.equal(block.truncated, false, 'warning-aligned fallback shrink should clear truncation when it finds a fitting size');
});

test('post-warning auto-nudge does not increase font size while expanding bbox', () => {
  const page = makeEditorPage([{
    source_block_id: 'b1',
    bbox: [50, 100, 180, 118],
    text: 'This translated line needs more horizontal room but should keep its current font size',
    font_size: 8.4,
    source_font_size: 12,
    line_height: 10.08,
  }]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks[0];
  assert.equal(block.font_size, 8.4, 'auto-nudge should preserve the current font size');
  assert.ok((block.bbox[2] - block.bbox[0]) > 130, 'bbox should still expand to improve fit');
});

test('post-warning auto-nudge skips low-readability blocks when they already fit', () => {
  const page = makeEditorPage([{
    source_block_id: 'b1',
    bbox: [50, 100, 180, 118],
    text: 'Fits already',
    font_size: 8,
    source_font_size: 12,
    line_height: 9.6,
  }]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks[0];
  assert.equal(block.overflow, false, 'block should remain non-overflowing');
  assert.equal(block.font_size, 8, 'auto-nudge should preserve the current font size');
  assert.deepEqual(block.bbox, [50, 100, 180, 118], 'already-fitting blocks should not be nudged just for readability ratio');
});

test('post-warning auto-nudge keeps searching for the largest safe bbox', () => {
  const page = makeEditorPage([
    {
      source_block_id: 'a1',
      bbox: [140, 100, 220, 118],
      text: 'This line should keep growing until just before the neighbor',
      font_size: 8,
      source_font_size: 12,
      line_height: 9.6,
      alignment: 'right',
    },
    {
      source_block_id: 'b1',
      bbox: [54, 100, 72, 118],
      text: 'neighbor',
      font_size: 8,
      source_font_size: 8,
      line_height: 9.6,
      alignment: 'left',
    },
  ]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks.find((item) => item.source_block_id === 'a1');
  assert.ok(block, 'target block should exist');
  assert.equal(block.bbox[0], 140, 'post-warning auto-nudge should preserve the left edge');
  assert.ok(block.bbox[2] > 236, 'bbox should continue past the first safe nudge ratio by extending rightward');
  assert.equal(block.collision, false, 'bbox should remain collision-free while growing further');
  assert.equal(block.font_size, 8, 'larger safe bbox should not increase font size');
});

test('post-warning auto-nudge stops at the smallest sufficient bbox once fit is cleared', () => {
  const page = makeEditorPage([
    {
      source_block_id: 'a1',
      bbox: [50, 100, 170, 118],
      text: 'a. Expected payments from the provident fund',
      font_size: 5.79,
      source_font_size: 5.79,
      line_height: 6.948,
      alignment: 'center',
      block_type: 'text_line',
      wrap_mode: 'word',
      extra: {
        source_clip_default: true,
        source_line_count: 1,
      },
    },
  ]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks.find((item) => item.source_block_id === 'a1');
  assert.ok(block, 'target block should exist');
  const width = block.bbox[2] - block.bbox[0];
  assert.ok(width >= 144 && width < 150, 'bbox should stop at the first sufficient 0.2 nudge rather than the largest safe bbox');
  assert.equal(block.font_size, 5.79, 'font size should remain unchanged');
  assert.equal(block.truncated, false, 'first sufficient nudge should clear truncation');
});

test('post-warning vertical overflow repair grows downward only when enabled', () => {
  const page = makeEditorPage([
    {
      source_block_id: 'v1',
      bbox: [50, 100, 270, 108.4],
      text: 'gyp',
      font_size: 7.7,
      source_font_size: 11,
      line_height: 9.24,
      alignment: 'left',
      block_type: 'text_line',
      wrap_mode: 'word',
      extra: {
        source_clip_default: true,
        source_line_count: 1,
      },
    },
    {
      source_block_id: 'v2',
      bbox: [271, 100, 360, 116],
      text: 'neighbor',
      font_size: 8,
      source_font_size: 8,
      line_height: 9.6,
      alignment: 'left',
      block_type: 'text_line',
    },
  ]);

  const withoutRepair = applyAutoNudgeToPage(page);
  const withRepair = applyAutoNudgeToPage(page, { repairVerticalOverflowEnabled: true });
  const withoutBlock = withoutRepair.blocks.find((item) => item.source_block_id === 'v1');
  const withBlock = withRepair.blocks.find((item) => item.source_block_id === 'v1');
  assert.ok(withoutBlock && withBlock, 'target block should exist');

  assert.equal(withoutBlock.bbox[3], 108.4);
  assert.equal(withoutBlock.overflow, true, 'without repair the vertical overflow should remain');

  assert.equal(withBlock.bbox[0], withoutBlock.bbox[0], 'repair should not move the left edge');
  assert.equal(withBlock.bbox[1], withoutBlock.bbox[1], 'repair should not move the top edge');
  assert.equal(withBlock.bbox[2], withoutBlock.bbox[2], 'repair should not change width relative to the regular auto-nudge result');
  assert.ok(withBlock.bbox[3] > withoutBlock.bbox[3] + 1, 'repair should extend the bottom edge downward');
  assert.equal(withBlock.font_size, withoutBlock.font_size, 'repair should keep the font size fixed');
  assert.equal(withBlock.overflow, false, 'downward growth should clear the vertical overflow');
});

test('post-warning horizontal nudge does not grow into the next row vertically', () => {
  const page = makeEditorPage([
    {
      source_block_id: 'a1',
      bbox: [140, 100, 270, 112],
      text: 'B. Movements in your account during the reporting period',
      font_size: 5,
      source_font_size: 12,
      line_height: 6,
      alignment: 'left',
      block_type: 'text_line',
    },
    {
      source_block_id: 'b1',
      bbox: [250, 112.2, 310, 124],
      text: 'neighbor below',
      font_size: 8,
      source_font_size: 8,
      line_height: 9.6,
      alignment: 'left',
      block_type: 'text_line',
    },
  ]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks.find((item) => item.source_block_id === 'a1');
  assert.ok(block, 'target block should exist');
  assert.ok((block.bbox[2] - block.bbox[0]) > 130, 'bbox should widen horizontally');
  assert.equal(block.bbox[0], 140, 'horizontal nudge should not extend leftward');
  assert.equal(block.bbox[3], 112, 'horizontal nudge should preserve the original bbox height');
  assert.equal(block.collision, false, 'wider bbox should remain collision-free');
});

test('post-warning auto-nudge clears translated p1_b31 truncation in report fixture', async () => {
  const fixturePath = path.join(repoRoot, 'tests', 'documents', 'report_1_test.pdf');
  const pdfBytes = await fs.readFile(fixturePath);
  const manifest = await buildManifestFromPdfData(pdfBytes, {
    sourcePdf: 'report_1_test.pdf',
    documentId: 'post-warning-p1-b31-regression',
  });
  const [layout] = await buildDetectedTextLayoutsFromPdfData(pdfBytes, {
    manifest,
    requestedPages: [1],
  });
  const translations = {
    document_id: layout.document_id,
    page_id: layout.page_id,
    blocks: layout.blocks.map((block) => ({
      block_id: block.block_id,
      translated_text: block.block_id === 'p1_b31'
        ? 'B. Movements in your account during the reporting period'
        : block.text,
    })),
  };
  const { buildDetectedTextMirroredArtifacts } = await import('../../src/lib/pdf-core/detectedTextMirrorStage.js');
  const artifacts = buildDetectedTextMirroredArtifacts(layout, { translations, mirrorEnabled: true });
  const stylesById = new Map((artifacts.editorLayout.styles || []).map((style) => [String(style.style_id), style]));
  const sourceBlocksById = new Map((artifacts.sourceLayout.blocks || []).map((block) => [String(block.block_id), block]));
  const sourceClipDefaultsById = sourceClipDefaultsForLayout(artifacts.editorLayout);
  const page = {
    session_id: 'test',
    document_id: 'test-doc',
    page_id: 1,
    page_size_pt: artifacts.editorLayout.page_size_pt,
    preview_url: '',
    tables: [],
    blocks: artifacts.fitted.blocks.map((fittedBlock) => {
      const sourceBlock = sourceBlocksById.get(String(fittedBlock.source_block_id)) || {};
      const style = stylesById.get(String(fittedBlock.style_id)) || {};
      const built = buildStoredDrawPlanForFittedBlock({
        fittedBlock,
        sourceBlock,
        style,
        sourceClipDefault: Boolean(sourceClipDefaultsById[String(sourceBlock.block_id || fittedBlock.source_block_id)]),
        clipMode: 'auto',
        bboxEdited: false,
        fauxBoldPolicy: 'semantic',
      }).block;
      return {
        ...built,
        source_font_size: Number(style.font_size) || Number(built.font_size) || 10,
        pre_fit_bbox: Array.isArray(fittedBlock.pre_fit_bbox)
          ? fittedBlock.pre_fit_bbox.map((value) => Number(value))
          : undefined,
      };
    }),
  };
  const originalBlock = page.blocks.find((item) => item.source_block_id === 'p1_b31');
  assert.ok(originalBlock, 'p1_b31 should exist before auto-nudge');

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks.find((item) => item.source_block_id === 'p1_b31');
  assert.ok(block, 'p1_b31 should exist in the result');
  assert.ok(block.font_size <= originalBlock.font_size, 'auto-nudge should not increase the current font size');
  assert.equal(block.truncated, false, 'auto-nudge should clear translated truncation');
  assert.equal(block.bbox[0], originalBlock.bbox[0], 'translated p1_b31 should keep its left edge');
  assert.ok(block.bbox[2] >= originalBlock.bbox[2], 'auto-nudge should not narrow the translated line bbox');
});

test('post-warning bucket ratio shrink aligns p1_b39 with final warning state', async () => {
  const fixturePath = path.join(repoRoot, 'tests', 'documents', 'report_1_test.pdf');
  const translationsPath = path.join(__dirname, 'fixtures', 'report_1_test.browser-translator.json');
  const pdfBytes = await fs.readFile(fixturePath);
  const mockRun = JSON.parse(await fs.readFile(translationsPath, 'utf8'));
  const manifest = await buildManifestFromPdfData(pdfBytes, {
    sourcePdf: 'report_1_test.pdf',
    documentId: 'bucket-p1-b39-warning-regression',
  });
  const [layout] = await buildDetectedTextLayoutsFromPdfData(pdfBytes, {
    manifest,
    requestedPages: [1],
  });
  const translations = {
    ...mockRun.translations[0],
    document_id: layout.document_id,
  };
  const { buildDetectedTextMirroredArtifacts } = await import('../../src/lib/pdf-core/detectedTextMirrorStage.js');
  const artifacts = buildDetectedTextMirroredArtifacts(layout, {
    translations,
    mirrorEnabled: true,
    useBucketFontRatioEnabled: true,
  });
  const stylesById = new Map((artifacts.editorLayout.styles || []).map((style) => [String(style.style_id), style]));
  const sourceBlocksById = new Map((artifacts.sourceLayout.blocks || []).map((block) => [String(block.block_id), block]));
  const sourceClipDefaultsById = sourceClipDefaultsForLayout(artifacts.editorLayout);
  const page = {
    session_id: 'test',
    document_id: 'test-doc',
    page_id: 1,
    page_size_pt: artifacts.editorLayout.page_size_pt,
    preview_url: '',
    tables: [],
    blocks: artifacts.fitted.blocks.map((fittedBlock) => {
      const sourceBlock = sourceBlocksById.get(String(fittedBlock.source_block_id)) || {};
      const style = stylesById.get(String(fittedBlock.style_id)) || {};
      const built = buildStoredDrawPlanForFittedBlock({
        fittedBlock,
        sourceBlock,
        style,
        sourceClipDefault: Boolean(sourceClipDefaultsById[String(sourceBlock.block_id || fittedBlock.source_block_id)]),
        clipMode: 'auto',
        bboxEdited: false,
        fauxBoldPolicy: 'semantic',
      }).block;
      return {
        ...built,
        source_font_size: Number(style.font_size) || Number(built.font_size) || 10,
        pre_fit_bbox: Array.isArray(fittedBlock.pre_fit_bbox)
          ? fittedBlock.pre_fit_bbox.map((value) => Number(value))
          : undefined,
      };
    }),
  };

  const before = page.blocks.find((item) => item.source_block_id === 'p1_b39');
  assert.ok(before, 'p1_b39 should exist before auto-nudge');
  assert.equal(before.font_size, 7.602);
  assert.equal(before.truncated, true);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks.find((item) => item.source_block_id === 'p1_b39');
  assert.ok(block, 'p1_b39 should exist after auto-nudge');
  assert.ok(block.font_size < before.font_size, 'bucket ratio fallback should shrink p1_b39 after nudge fails');
  assert.equal(block.truncated, false, 'final warning-aligned shrink should clear truncation for p1_b39');
});

test('post-warning auto-nudge does not expand into neighboring block', () => {
  const page = makeEditorPage([
    {
      source_block_id: 'a1',
      bbox: [50, 100, 140, 118],
      text: 'This is a very long translated text that would love to expand rightward but should not collide',
      font_size: 12,
      source_font_size: 12,
    },
    {
      source_block_id: 'b1',
      bbox: [145, 100, 300, 118],
      text: 'neighbor',
      font_size: 12,
      source_font_size: 12,
    },
  ]);

  const result = applyAutoNudgeToPage(page);
  const blockA = result.blocks.find((b) => b.source_block_id === 'a1');
  const blockB = result.blocks.find((b) => b.source_block_id === 'b1');
  assert.equal(blockA.collision, false, 'nudged block should not collide with neighbor');
  assert.equal(blockB.collision, false, 'neighbor should not be collided into');
});

test('post-warning auto-nudge skips blocks that already fit', () => {
  const page = makeEditorPage([{
    source_block_id: 'b1',
    bbox: [50, 100, 400, 118],
    text: 'short',
    font_size: 12,
    source_font_size: 12,
  }]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks[0];
  assert.deepEqual(block.bbox, [50, 100, 400, 118], 'bbox should not change for fitting block');
});

test('post-warning auto-nudge preserves pre_fit_bbox', () => {
  const preFitBBox = [45, 95, 145, 120];
  const page = makeEditorPage([{
    source_block_id: 'b1',
    bbox: [50, 100, 140, 118],
    text: 'This is a long translated text that definitely overflows the box',
    font_size: 12,
    source_font_size: 12,
    pre_fit_bbox: preFitBBox,
  }]);

  const result = applyAutoNudgeToPage(page);
  const block = result.blocks[0];
  assert.deepEqual(block.pre_fit_bbox, preFitBBox, 'pre_fit_bbox should be unchanged by post-warning nudge');
});

test('finalizeEditorPageWarnings can disable post-fit auto-nudge entirely', () => {
  const page = makeEditorPage([{
    source_block_id: 'b1',
    bbox: [50, 100, 140, 118],
    text: 'This is a long translated text that definitely overflows the box',
    font_size: 12,
    source_font_size: 12,
  }]);

  const disabled = finalizeEditorPageWarnings(page, { autoNudgeEnabled: false });
  const enabled = finalizeEditorPageWarnings(page, { autoNudgeEnabled: true });

  assert.deepEqual(disabled.blocks[0].bbox, [50, 100, 140, 118], 'disabled flag should preserve the original fitted bbox');
  assert.ok(
    enabled.blocks[0].bbox[2] > disabled.blocks[0].bbox[2],
    'enabled flag should still allow post-fit auto-nudge expansion',
  );
});

test('strict auto-nudge bbox collision is enabled by default and can be disabled explicitly', () => {
  const page = makeEditorPage([
    {
      source_block_id: 'a1',
      bbox: [50, 100, 160, 118],
      text: 'the balance of funds intended for a one-time withdrawal starting from the',
      font_size: 4,
      source_font_size: 12,
      line_height: 4.8,
      alignment: 'left',
      block_type: 'text_line',
      wrap_mode: 'none',
    },
    {
      source_block_id: 'b1',
      bbox: [180, 100, 230, 118],
      text: '9',
      font_size: 12,
      source_font_size: 12,
      line_height: 14.4,
      alignment: 'right',
      block_type: 'text_line',
      wrap_mode: 'none',
    },
  ]);

  const defaultResult = applyAutoNudgeToPage(page);
  const optOutResult = applyAutoNudgeToPage(page, {
    strictAutoNudgeBBoxCollisionEnabled: false,
  });
  const defaultBlock = defaultResult.blocks.find((item) => item.source_block_id === 'a1');
  const optOutBlock = optOutResult.blocks.find((item) => item.source_block_id === 'a1');
  const neighbor = defaultResult.blocks.find((item) => item.source_block_id === 'b1');

  assert.ok(defaultBlock && optOutBlock && neighbor, 'all test blocks should exist');
  assert.ok(
    defaultBlock.bbox[2] <= neighbor.bbox[0],
    'default auto-nudge should stop growth before the neighboring container bbox',
  );
  assert.ok(
    optOutBlock.bbox[2] > neighbor.bbox[0],
    'disabling the strict bbox collision flag should allow overlap with the neighboring container bbox',
  );
  assert.equal(defaultBlock.collision, false, 'default strict blocking should avoid introducing a warning collision');
});

test('post-warning auto-nudge does not widen already-fitting neighboring blocks into collision', () => {
  const page = makeEditorPage([
    {
      source_block_id: 'a1',
      bbox: [70, 92, 194, 103],
      text: '123 Main St.',
      font_size: 7.5,
      source_font_size: 10.86,
      line_height: 9.0,
      alignment: 'right',
      block_type: 'text_line',
      overflow: false,
      truncated: false,
    },
    {
      source_block_id: 'b1',
      bbox: [202, 94, 275, 103],
      text: 'Office',
      font_size: 5.67,
      source_font_size: 8.39,
      line_height: 6.8,
      alignment: 'left',
      block_type: 'text_line',
      overflow: false,
      truncated: false,
    },
  ]);

  const result = applyAutoNudgeToPage(page);
  const blockA = result.blocks.find((item) => item.source_block_id === 'a1');
  const blockB = result.blocks.find((item) => item.source_block_id === 'b1');
  assert.deepEqual(blockA.bbox, [70, 92, 194, 103], 'already-fitting block should not widen');
  assert.deepEqual(blockB.bbox, [202, 94, 275, 103], 'neighbor should not widen');
  assert.equal(blockA.redacted, false, 'already-fitting block should remain clean');
  assert.equal(blockB.redacted, false, 'neighbor should remain clean');
});
