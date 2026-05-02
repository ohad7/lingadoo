import { fitPageLayout } from './fitting.js';
import { mirrorBBox } from './mirrorRenderPlan.js';

function mirroredAlignment(alignment) {
  if (alignment === 'left') {
    return 'right';
  }
  if (alignment === 'right') {
    return 'left';
  }
  return alignment;
}

function buildMirroredLayoutForFitting(layout) {
  const pageWidth = Number(layout.page_size_pt[0]);
  return {
    ...layout,
    blocks: (layout.blocks || []).map((block) => ({
      ...block,
      bbox: mirrorBBox(block.bbox, pageWidth),
    })),
    styles: (layout.styles || []).map((style) => ({
      ...style,
      alignment: mirroredAlignment(style.alignment),
    })),
  };
}

function buildLayoutForFitting(layout, { mirrorEnabled = true } = {}) {
  if (mirrorEnabled === false) {
    return {
      ...layout,
      blocks: (layout.blocks || []).map((block) => ({ ...block })),
      styles: (layout.styles || []).map((style) => ({ ...style })),
    };
  }
  return buildMirroredLayoutForFitting(layout);
}

export function buildPassthroughTranslations(layout) {
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

export function sourceWrapDefaultsForLayout(layout) {
  return Object.fromEntries(
    (layout.blocks || []).map((block) => [
      block.block_id,
      block.type === 'table_cell' || block.type === 'text_line' || Boolean(block.flattened_line_breaks) ? 'word' : 'none',
    ]),
  );
}

export function buildWebPreviewArtifacts(layout, {
  translations = null,
  mirrorEnabled = true,
} = {}) {
  const mirroredLayout = buildLayoutForFitting(layout, { mirrorEnabled });
  const suspiciousSourceStyles = (layout.styles || []).filter((style) => Number(style?.font_size) < 1.0);
  if (suspiciousSourceStyles.length > 0) {
    console.warn('[web-preview-artifacts] suspicious source layout font sizes', {
      documentId: layout.document_id,
      pageId: layout.page_id,
      suspiciousStyles: suspiciousSourceStyles.map((style) => ({
        styleId: style.style_id,
        fontSize: Number(style.font_size),
        fontFamily: style.font_family,
        alignment: style.alignment,
      })),
    });
  }
  const suspiciousMirroredStyles = (mirroredLayout.styles || []).filter((style) => Number(style?.font_size) < 1.0);
  if (suspiciousMirroredStyles.length > 0) {
    console.warn('[web-preview-artifacts] suspicious mirrored layout font sizes', {
      documentId: mirroredLayout.document_id,
      pageId: mirroredLayout.page_id,
      suspiciousStyles: suspiciousMirroredStyles.map((style) => ({
        styleId: style.style_id,
        fontSize: Number(style.font_size),
        fontFamily: style.font_family,
        alignment: style.alignment,
      })),
    });
  }
  const effectiveTranslations = translations || buildPassthroughTranslations(layout);
  const wrapModeOverridesByBlockId = Object.fromEntries(
    Object.entries(sourceWrapDefaultsForLayout(mirroredLayout)).filter(([, mode]) => mode === 'word'),
  );
  const fitted = fitPageLayout(
    mirroredLayout,
    effectiveTranslations,
    {
      minFontSize: 5.0,
      wrapMode: 'none',
      wrapModeOverridesByBlockId,
    },
  );
  return {
    sourceLayout: layout,
    mirrorEnabled: mirrorEnabled !== false,
    editorLayout: mirroredLayout,
    mirroredLayout,
    fitted,
    translations: effectiveTranslations,
  };
}
