import { normalizeFauxBoldPolicy, resolveEffectiveWeightValue } from './fontWeightPolicy.js';
import { resolveMirroredAlignment } from '../textAlignmentPolicy.js';

const RTL_PATTERN = /[\u0590-\u08FF]/u;
const LTR_PATTERN = /[A-Za-z]/u;
const LTR_VISUAL_RUN_PATTERN = /[A-Za-z0-9@._:/\\\-+%#*=]+/gu;
const URL_OR_EMAIL_PATTERN = /(https?:\/\/|www\.|@)/u;

export const MIRRORED_TEXT_PADDING_PT = 1.0;

function countMatches(text, regex) {
  let count = 0;
  for (const char of String(text || '')) {
    if (regex.test(char)) {
      count += 1;
    }
  }
  return count;
}

export function inferTextDirection(text) {
  const rtlCount = countMatches(text, RTL_PATTERN);
  const ltrCount = countMatches(text, LTR_PATTERN);
  if (rtlCount === 0 && ltrCount === 0) {
    return 'unknown';
  }
  return rtlCount > ltrCount ? 'rtl' : 'ltr';
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function compactText(text) {
  return String(text || '').replace(/\s+/g, '');
}

function isLtrSourceText(text) {
  const normalized = String(text || '');
  if (!normalized.trim()) {
    return false;
  }
  if (RTL_PATTERN.test(normalized)) {
    return false;
  }
  if (LTR_PATTERN.test(normalized)) {
    return true;
  }
  return /\d/u.test(normalized);
}

export function shouldPreserveSourceLtrBlock(sourceText, translatedText, mode = 'auto', { blockType = null } = {}) {
  if (mode === 'never') {
    return false;
  }
  if (!isLtrSourceText(sourceText)) {
    return false;
  }
  if (mode === 'always') {
    return true;
  }
  if (blockType === 'table_cell') {
    return false;
  }

  const normalizedSource = normalizeWhitespace(sourceText);
  const normalizedTranslated = normalizeWhitespace(translatedText);
  if (normalizedSource === normalizedTranslated) {
    return true;
  }
  if (URL_OR_EMAIL_PATTERN.test(String(sourceText || ''))) {
    return compactText(sourceText) === compactText(translatedText);
  }
  return false;
}

function isStrongLtrCharacter(character) {
  return /[A-Za-z0-9]/u.test(character);
}

function toVisualRtlText(text) {
  if (!RTL_PATTERN.test(text)) {
    return text;
  }
  const reversed = [...String(text || '')].reverse().join('');
  return reversed.replace(LTR_VISUAL_RUN_PATTERN, (run) => {
    if ([...run].some((character) => isStrongLtrCharacter(character))) {
      return [...run].reverse().join('');
    }
    return run;
  });
}

export function prepareLineForRender(line) {
  return inferTextDirection(line) === 'rtl' ? toVisualRtlText(line) : line;
}

export function mirrorBBox(bbox, pageWidth) {
  const [x0, y0, x1, y1] = bbox;
  const mirrored = [
    Math.max(0, pageWidth - x1),
    y0,
    Math.min(pageWidth, pageWidth - x0),
    y1,
  ];
  if (mirrored[2] <= mirrored[0]) {
    return [...bbox];
  }
  return mirrored;
}

export function resolveMirroredTextAlignment(sourceAlignment, translatedText, {
  blockType = null,
  textTightness = '',
} = {}) {
  if (blockType === 'table_cell' && inferTextDirection(translatedText) === 'rtl') {
    return 'right';
  }
  return resolveMirroredAlignment({
    sourceAlignment,
    translatedText,
    textTightness,
    mirrorEnabled: true,
  });
}

function insetBBox(bbox, inset) {
  return [
    bbox[0] + inset,
    bbox[1] + inset,
    bbox[2] - inset,
    bbox[3] - inset,
  ];
}

function validBBox(bbox) {
  return bbox[2] > bbox[0] && bbox[3] > bbox[1];
}

export function buildMirroredPageRenderPlan(layout, fitted, {
  mirrorTextBboxes = true,
  preserveLtrSource = 'auto',
  allowOverflowCompaction = true,
  allowOverflowClipping = true,
  clippingSourceBlockIds = null,
  uncappedSourceLineBlockIds = null,
  fauxBoldPolicy = 'semantic',
} = {}) {
  const pageWidth = layout.page_size_pt[0];
  const sourceBlocksById = new Map(layout.blocks.map((block) => [block.block_id, block]));
  const stylesById = new Map(layout.styles.map((style) => [style.style_id, style]));
  const preservedSourceSpans = [];
  const clippingSourceIds = clippingSourceBlockIds ? new Set(clippingSourceBlockIds) : null;
  const uncappedSourceIds = uncappedSourceLineBlockIds ? new Set(uncappedSourceLineBlockIds) : null;
  const normalizedFauxBoldPolicy = normalizeFauxBoldPolicy(fauxBoldPolicy);

  const masks = layout.blocks.map((block) => {
    const renderBBox = mirrorBBox(block.bbox, pageWidth);
    if (block.type === 'table_cell') {
      const maskBBox = mirrorBBox(insetBBox(block.bbox, 1.0), pageWidth);
      return {
        source_block_id: block.block_id,
        block_type: block.type,
        source_bbox: [...block.bbox],
        render_bbox: validBBox(maskBBox) ? maskBBox : renderBBox,
        border_bbox: renderBBox,
        preserve_border: true,
      };
    }
    return {
      source_block_id: block.block_id,
      block_type: block.type,
      source_bbox: [...block.bbox],
      render_bbox: renderBBox,
      border_bbox: null,
      preserve_border: false,
    };
  });

  const images = (layout.images || []).map((image) => ({
    image_id: image.image_id,
    source_bbox: [...image.bbox],
    render_bbox: mirrorBBox(image.bbox, pageWidth),
  }));

  const texts = [...fitted.blocks]
    .sort((left, right) => {
      const leftOrder = sourceBlocksById.get(left.source_block_id)?.reading_order || Number.MAX_SAFE_INTEGER;
      const rightOrder = sourceBlocksById.get(right.source_block_id)?.reading_order || Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    })
    .filter((block) => {
      const sourceBlock = sourceBlocksById.get(block.source_block_id) || null;
      if (!sourceBlock) {
        return true;
      }
      const preserveSource = shouldPreserveSourceLtrBlock(
        sourceBlock.text,
        block.translated_text,
        preserveLtrSource,
        { blockType: sourceBlock.type || null },
      );
      if (!preserveSource) {
        return true;
      }
      preservedSourceSpans.push({
        source_block_id: sourceBlock.block_id,
        text: sourceBlock.text,
        source_bbox: [...sourceBlock.bbox],
        render_bbox: mirrorBBox(sourceBlock.bbox, pageWidth),
      });
      return false;
    })
    .map((block) => {
      const sourceBlock = sourceBlocksById.get(block.source_block_id) || null;
      const style = stylesById.get(block.style_id) || null;
      const renderBBox = mirrorTextBboxes ? mirrorBBox(block.bbox, pageWidth) : [...block.bbox];
      return {
        block_id: block.block_id,
        source_block_id: block.source_block_id,
        block_type: sourceBlock?.type || null,
        style_id: block.style_id,
        bbox: renderBBox,
        source_text: sourceBlock?.text || '',
        translated_text: block.translated_text,
        lines: [...block.lines],
        font_size: block.font_size,
        line_height: block.line_height,
        overflow: Boolean(block.overflow),
        collision: Boolean(block.collision),
        allow_overflow_compaction: allowOverflowCompaction,
        allow_overflow_clipping: clippingSourceIds
          ? clippingSourceIds.has(block.source_block_id)
          : allowOverflowClipping,
        source_line_count_hint: (
          (clippingSourceIds ? clippingSourceIds.has(block.source_block_id) : allowOverflowClipping)
          && (!uncappedSourceIds || !uncappedSourceIds.has(block.source_block_id))
          && sourceBlock
        )
          ? sourceBlock.text.split(/\r\n|\r|\n/u).filter((line, index, linesArray) => (
            line.length > 0 || index < linesArray.length - 1
          )).length || 1
          : null,
        color: style?.color || '#000000',
        weight: resolveEffectiveWeightValue({
          explicitWeight: style?.weight || 'normal',
          renderMode: style?.render_mode || 0,
          policy: normalizedFauxBoldPolicy,
        }),
        source_weight: style?.weight || 'normal',
        italic: Boolean(style?.italic),
        render_mode: style?.render_mode || 0,
        stroke_width: style?.stroke_width || 0,
        text_tightness: String(sourceBlock?.text_tightness || ''),
        alignment: resolveMirroredTextAlignment(
          style?.alignment || 'left',
          block.translated_text,
          {
            blockType: sourceBlock?.type || null,
            textTightness: String(sourceBlock?.text_tightness || ''),
          },
        ),
      };
    });

  return {
    page_id: layout.page_id,
    page_size_pt: [...layout.page_size_pt],
    faux_bold_policy: normalizedFauxBoldPolicy,
    masks,
    images,
    preserved_source_spans: preservedSourceSpans,
    texts,
  };
}
