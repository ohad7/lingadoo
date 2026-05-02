import { fitPageLayout, GLOBAL_MIN_FONT_SIZE } from './fitting.js';
import { mirrorBBox } from './mirrorRenderPlan.js';
import { resolveMirroredAlignment } from '../textAlignmentPolicy.js';

function cloneLayout(layout) {
  return {
    ...layout,
    blocks: (layout.blocks || []).map((block) => ({
      ...block,
      bbox: Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1],
    })),
    styles: (layout.styles || []).map((style) => ({ ...style })),
  };
}

function buildPassthroughTranslations(layout) {
  return {
    schema_version: '1.0',
    stage: 'translations',
    document_id: layout.document_id,
    page_id: layout.page_id,
    model_version: 'browser-passthrough-v1',
    glossary_version: 'browser-ui',
    prompt_version: 'browser-ui-v1',
    blocks: (layout.blocks || []).map((block, index) => ({
      block_id: block.block_id,
      page_id: layout.page_id,
      source_text: block.text,
      translated_text: block.text,
      translation_hash: String(index + 1).padStart(64, '0'),
      status: 'translated',
      attempts: 1,
      issues: [],
    })),
  };
}

function sourceWrapDefaultsForLayout(layout) {
  return Object.fromEntries(
    (layout.blocks || []).map((block) => [
      String(block.block_id || ''),
      (
        String(block.type || '') === 'table_cell'
        || String(block.type || '') === 'text_line'
        || Boolean(block.flattened_line_breaks)
      ) ? 'word' : 'none',
    ]),
  );
}

function createMirroredStyle(baseStyle, {
  nextStyleId,
  translatedText,
  textTightness,
  mirrorEnabled,
}) {
  return {
    ...baseStyle,
    style_id: nextStyleId,
    alignment: resolveMirroredAlignment({
      sourceAlignment: baseStyle?.alignment,
      translatedText,
      textTightness,
      mirrorEnabled,
    }),
  };
}

export function buildDetectedTextMirroredArtifacts(layout, {
  translations = null,
  mirrorEnabled = true,
  useBucketFontRatioEnabled = false,
} = {}) {
  const sourceLayout = cloneLayout(layout);
  const effectiveTranslations = translations || buildPassthroughTranslations(sourceLayout);
  const baseStylesById = new Map(
    (sourceLayout.styles || []).map((style) => [String(style.style_id || ''), style]),
  );
  const translationByBlockId = new Map(
    (effectiveTranslations.blocks || []).map((block) => [String(block.block_id || ''), block]),
  );
  const pageWidth = Number(sourceLayout.page_size_pt?.[0] || 0);
  const mirroredStyles = [];
  const mirroredBlocks = (sourceLayout.blocks || []).map((block) => {
    const sourceStyleId = String(block.style_id || '');
    const sourceStyle = baseStylesById.get(sourceStyleId) || {
      style_id: sourceStyleId || 's1',
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
    const translatedText = String(
      translationByBlockId.get(String(block.block_id || ''))?.translated_text
      || block.text
      || '',
    );
    const mirroredStyleId = `${sourceStyle.style_id}__${String(block.block_id || 'block')}`;
    mirroredStyles.push(createMirroredStyle(sourceStyle, {
      nextStyleId: mirroredStyleId,
      translatedText,
      textTightness: block?.text_tightness,
      mirrorEnabled,
    }));
    return {
      ...block,
      style_id: mirroredStyleId,
      bbox: mirrorEnabled
        ? mirrorBBox(
          Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1],
          pageWidth,
        )
        : (Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1]),
    };
  });

  const mirroredLayout = {
    ...sourceLayout,
    blocks: mirroredBlocks,
    styles: mirroredStyles,
  };
  const wrapModeOverridesByBlockId = Object.fromEntries(
    Object.entries(sourceWrapDefaultsForLayout(mirroredLayout)).filter(([, mode]) => mode === 'word'),
  );
  const fitted = fitPageLayout(mirroredLayout, effectiveTranslations, {
    useBucketFontRatio: useBucketFontRatioEnabled === true,
    minFontSize: GLOBAL_MIN_FONT_SIZE,
    wrapMode: 'none',
    wrapModeOverridesByBlockId,
  });

  return {
    sourceLayout,
    editorLayout: mirroredLayout,
    mirrorEnabled: mirrorEnabled !== false,
    mirroredLayout,
    fitted,
    translations: effectiveTranslations,
  };
}
