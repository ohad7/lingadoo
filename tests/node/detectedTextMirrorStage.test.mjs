import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDetectedTextMirroredArtifacts } from '../../src/lib/pdf-core/detectedTextMirrorStage.js';

test('detected text mirror stage mirrors blocks and resolves alignment per translated block', () => {
  const layout = {
    document_id: 'doc-1',
    page_id: 1,
    page_size_pt: [200, 100],
    blocks: [
      {
        block_id: 'b1',
        page_id: 1,
        type: 'text_line',
        bbox: [10, 10, 60, 20],
        text: 'שלום',
        style_id: 's1',
        reading_order: 1,
        text_tightness: 'tight',
      },
      {
        block_id: 'b2',
        page_id: 1,
        type: 'text_line',
        bbox: [70, 10, 120, 20],
        text: 'מספר חשבון',
        style_id: 's2',
        reading_order: 2,
        text_tightness: 'non-tight',
      },
      {
        block_id: 'b3',
        page_id: 1,
        type: 'text_line',
        bbox: [130, 10, 180, 20],
        text: 'כותרת',
        style_id: 's3',
        reading_order: 3,
        text_tightness: 'non-tight',
      },
    ],
    styles: [
      {
        style_id: 's1',
        font_family: 'unknown',
        font_size: 10,
        weight: 'normal',
        italic: false,
        color: '#000000',
        alignment: 'right',
        line_spacing: 1.2,
        render_mode: 0,
        stroke_width: 0,
      },
      {
        style_id: 's2',
        font_family: 'unknown',
        font_size: 10,
        weight: 'normal',
        italic: false,
        color: '#000000',
        alignment: 'left',
        line_spacing: 1.2,
        render_mode: 0,
        stroke_width: 0,
      },
      {
        style_id: 's3',
        font_family: 'unknown',
        font_size: 10,
        weight: 'normal',
        italic: false,
        color: '#000000',
        alignment: 'center',
        line_spacing: 1.2,
        render_mode: 0,
        stroke_width: 0,
      },
    ],
    images: [],
    graphic_regions: [],
  };
  const translations = {
    schema_version: '1.0',
    stage: 'translations',
    document_id: 'doc-1',
    page_id: 1,
    model_version: 'browser-translator-v1',
    glossary_version: 'browser-ui',
    prompt_version: 'browser-translator-v1',
    blocks: [
      {
        block_id: 'b1',
        page_id: 1,
        source_text: 'שלום',
        translated_text: 'Hello',
      },
      {
        block_id: 'b2',
        page_id: 1,
        source_text: 'מספר חשבון',
        translated_text: 'Account number',
      },
      {
        block_id: 'b3',
        page_id: 1,
        source_text: 'כותרת',
        translated_text: 'Quarterly title',
      },
    ],
  };

  const artifacts = buildDetectedTextMirroredArtifacts(layout, {
    translations,
    mirrorEnabled: true,
  });

  assert.deepEqual(artifacts.sourceLayout.blocks[0].bbox, [10, 10, 60, 20]);
  assert.deepEqual(artifacts.editorLayout.blocks[0].bbox, [140, 10, 190, 20]);
  assert.deepEqual(artifacts.editorLayout.blocks[1].bbox, [80, 10, 130, 20]);
  assert.deepEqual(artifacts.editorLayout.blocks[2].bbox, [20, 10, 70, 20]);
  assert.notEqual(artifacts.editorLayout.blocks[0].style_id, artifacts.editorLayout.blocks[1].style_id);

  const stylesById = new Map(artifacts.editorLayout.styles.map((style) => [style.style_id, style]));
  assert.equal(stylesById.get(artifacts.editorLayout.blocks[0].style_id).alignment, 'left');
  assert.equal(stylesById.get(artifacts.editorLayout.blocks[1].style_id).alignment, 'right');
  assert.equal(stylesById.get(artifacts.editorLayout.blocks[2].style_id).alignment, 'center');
});
