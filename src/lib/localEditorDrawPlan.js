import {
  measureLinePt,
  truncateLineToWidth,
  wrapTextToWidth,
} from './textLayoutMetrics.js';
import { inferTextDirection, resolveEffectiveAlignment } from './textAlignmentPolicy.js';
import {
  resolveLogicalTextFrame,
  resolveTextOrientation,
  resolveTextPaddingPt,
  resolveTextRenderRotationDeg,
} from './textOrientation.js';

const RTL_PATTERN = /[\u0590-\u08FF]/u;
const LTR_VISUAL_RUN_PATTERN = /[A-Za-z0-9@+()[\]{}<>=%&$#*.,/:;!?'"_-]+/gu;

function isStrongLtrCharacter(character) {
  return /[A-Za-z0-9]/u.test(character);
}

function toVisualRtlText(text) {
  if (!RTL_PATTERN.test(String(text || ''))) {
    return String(text || '');
  }
  const reversed = String(text || '').split('').reverse().join('');
  return reversed.replace(LTR_VISUAL_RUN_PATTERN, (run) => {
    if ([...run].some((character) => isStrongLtrCharacter(character))) {
      return [...run].reverse().join('');
    }
    return run;
  });
}

export function prepareLineForPdfRender(line) {
  if (inferTextDirection(line) === 'rtl') {
    return toVisualRtlText(line);
  }
  return String(line || '');
}

export function wrapModeForSourceBlock(block) {
  if (resolveTextOrientation(block?.source_text_orientation) === 'vertical_ttb') {
    return 'none';
  }
  if (
    String(block?.type || '') === 'table_cell'
    || String(block?.type || '') === 'text_line'
    || Boolean(block?.flattened_line_breaks)
  ) {
    return 'word';
  }
  return 'none';
}

export function effectiveFontWeightForBlock(block) {
  const explicitWeight = String(block?.font_weight || 'normal');
  if (explicitWeight === 'bold') {
    return 'bold';
  }
  const policy = String(block?.faux_bold_policy || 'semantic');
  const renderMode = Number(block?.render_mode || 0);
  if (policy === 'semantic' && renderMode === 2) {
    return 'bold';
  }
  return 'normal';
}

export function shouldApplyFauxBoldStrokeForBlock(block, baseFontSize) {
  const policy = String(block?.faux_bold_policy || 'semantic');
  const renderMode = Number(block?.render_mode || 0);
  return policy === 'stroke' && renderMode === 2 && baseFontSize >= 10;
}

function lineSpacingForBlock(block, fontSize) {
  const lineHeight = Number(block?.line_height);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return 1.2;
  }
  const ratio = lineHeight / fontSize;
  if (!Number.isFinite(ratio) || ratio < 0.8 || ratio > 2.5) {
    return 1.2;
  }
  return ratio;
}

export function resolvedLineSpacingForBlock(block, {
  referenceFontSize = null,
} = {}) {
  const baseFontSize = Number.isFinite(referenceFontSize)
    ? Number(referenceFontSize)
    : Number(block?.font_size);
  const safeFontSize = Number.isFinite(baseFontSize) && baseFontSize > 0 ? baseFontSize : null;
  return lineSpacingForBlock(block, safeFontSize || 10);
}

export function rescaledLineHeightForFontSize(block, nextFontSize) {
  const safeFontSize = Math.max(1, Number(nextFontSize) || 10);
  const lineSpacing = resolvedLineSpacingForBlock(block, {
    referenceFontSize: Number(block?.font_size),
  });
  return Math.round((safeFontSize * lineSpacing) * 1000) / 1000;
}

export function resolveTextOrientationForBlock(block) {
  return resolveTextOrientation(block?.source_text_orientation || block?.text_orientation);
}

export function resolveTextRotationDegForBlock(block, { mirrorEnabled = false } = {}) {
  if (Number.isFinite(Number(block?.text_rotation_deg))) {
    const rotation = Number(block.text_rotation_deg);
    if (rotation === 90 || rotation === -90 || rotation === 0) {
      return rotation;
    }
  }
  return resolveTextRenderRotationDeg(resolveTextOrientationForBlock(block), mirrorEnabled);
}

function normalizedSourceBottomInsetRatio(block) {
  const ratio = Number(block?.source_bottom_inset_ratio);
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return Math.max(0, Math.min(1, ratio));
}

function preserveVerticalSourceAnchorForBlock(block, lineCount) {
  if (!Boolean(block?.preserve_vertical_source_anchor)) {
    return false;
  }
  if (Boolean(block?.bbox_edited)) {
    return false;
  }
  if (String(block?.block_type || '') !== 'text_line') {
    return false;
  }
  const tightness = String(block?.text_tightness || '').trim().toLowerCase();
  if (tightness !== 'tight' && tightness !== 'split-tight') {
    return false;
  }
  const sourceLineCount = Number(block?.source_line_count || 0);
  if (sourceLineCount !== 1) {
    return false;
  }
  return Number(lineCount) === 1;
}

export function resolveLineBaselinePt(block, {
  fontSize,
  lineHeight,
  contentHeight,
  lineIndex,
  lineCount,
} = {}) {
  const safeFontSize = Math.max(1, Number(fontSize) || 10);
  const safeLineHeight = Math.max(1, Number(lineHeight) || (safeFontSize * 1.2));
  const safeContentHeight = Math.max(1, Number(contentHeight) || 1);
  const safeIndex = Math.max(0, Number(lineIndex) || 0);
  const safeCount = Math.max(1, Number(lineCount) || 1);
  const textPaddingPt = resolveTextPaddingPt(resolveTextOrientationForBlock(block));
  if (preserveVerticalSourceAnchorForBlock(block, safeCount) && safeIndex === 0) {
    const bottomInset = safeContentHeight * normalizedSourceBottomInsetRatio(block);
    const anchoredBaseline = textPaddingPt + (safeContentHeight - bottomInset);
    return Math.max(textPaddingPt + safeFontSize, anchoredBaseline);
  }
  return textPaddingPt + safeFontSize + (safeIndex * safeLineHeight);
}

function clipResolvedForBlock(block) {
  const clipMode = String(block?.clip_mode || 'auto');
  const sourceClipDefault = Boolean(block?.source_clip_default);
  const bboxEdited = Boolean(block?.bbox_edited);
  if (clipMode === 'auto' && bboxEdited) {
    return false;
  }
  return clipMode === 'on' || (clipMode === 'auto' && sourceClipDefault);
}

function sourceLineHintForBlock(block) {
  if (Boolean(block?.bbox_edited)) {
    return 0;
  }
  const hint = Number(block?.source_line_count || 0);
  return Number.isFinite(hint) && hint > 0 ? Math.floor(hint) : 0;
}

function lineX(line, alignment, fontSize, fontWeight, maxWidth, textPaddingPt) {
  const lineWidth = measureLinePt(line, fontSize, fontWeight);
  if (alignment === 'right') {
    return Math.max(textPaddingPt, (maxWidth - lineWidth) + textPaddingPt);
  }
  if (alignment === 'center') {
    return Math.max(textPaddingPt, ((maxWidth - lineWidth) / 2) + textPaddingPt);
  }
  return textPaddingPt;
}

export function sourceClipDefaultsForLayout(layout) {
  const stylesById = new Map((layout?.styles || []).map((style) => [String(style.style_id), style]));
  return Object.fromEntries((layout?.blocks || []).map((block) => {
    const style = stylesById.get(String(block?.style_id || ''));
    if (!style) {
      return [block.block_id, false];
    }
    const bbox = Array.isArray(block.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1];
    const textOrientation = resolveTextOrientationForBlock(block);
    const frame = resolveLogicalTextFrame(bbox, {
      orientation: textOrientation,
      paddingPt: resolveTextPaddingPt(textOrientation),
    });
    const width = frame.contentWidth;
    const height = frame.contentHeight;
    const fontSize = Math.max(1, Number(style.font_size) || 10);
    const lineHeight = Math.max(1, fontSize * (Number(style.line_spacing) || 1.2));
    const sourceFontWeight = String(style.weight || 'normal');
    const lines = String(block.text || '').split(/\r?\n/u);
    const maxLineWidth = lines.length
      ? Math.max(...lines.map((line) => measureLinePt(line, fontSize, sourceFontWeight)))
      : 0;
    const requiredHeight = fontSize + (Math.max(0, lines.length - 1) * lineHeight);
    const widthOverflow = Math.max(0, maxLineWidth - width);
    const heightOverflow = Math.max(0, requiredHeight - height);
    return [block.block_id, widthOverflow > 1.0 || heightOverflow > 1.0];
  }));
}

export function rebuildLocalDrawPlan(block, { preferredLines = null } = {}) {
  const bbox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1];
  const textOrientation = resolveTextOrientationForBlock(block);
  const textPaddingPt = resolveTextPaddingPt(textOrientation);
  const frame = resolveLogicalTextFrame(bbox, {
    orientation: textOrientation,
    paddingPt: textPaddingPt,
  });
  const width = frame.contentWidth;
  const height = frame.contentHeight;
  const fontSize = Math.max(1, Number(block?.font_size) || 10);
  const lineHeight = Math.max(1, Number(block?.line_height) || (fontSize * 1.2));
  const fontWeight = effectiveFontWeightForBlock(block);
  const clipResolved = clipResolvedForBlock(block);
  const wrapMode = textOrientation === 'vertical_ttb'
    ? 'none'
    : (String(block?.wrap_mode || 'none') === 'word' ? 'word' : 'none');
  const normalizedText = String(block?.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const effectiveAlignment = resolveEffectiveAlignment({
    alignment: block?.alignment,
    text: normalizedText,
    textTightness: block?.text_tightness,
    alignmentEdited: Boolean(block?.alignment_edited),
  });

  let lines = Array.isArray(preferredLines) && preferredLines.length > 0
    ? preferredLines.map((line) => String(line || ''))
    : normalizedText.split('\n');
  if (lines.length <= 1 && wrapMode === 'word') {
    lines = wrapTextToWidth(String(block?.text || ''), width, fontSize, fontWeight);
  }
  if (clipResolved && lines.length <= 1 && wrapMode !== 'word') {
    lines = wrapTextToWidth(String(block?.text || ''), width, fontSize, fontWeight);
  }

  let maxLines = Math.max(1, Math.floor((height - fontSize) / lineHeight) + 1);
  const sourceHint = sourceLineHintForBlock(block);
  if (clipResolved && sourceHint > 0) {
    maxLines = Math.min(maxLines, sourceHint);
  }

  let truncated = false;
  if (clipResolved && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
    if (lines.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}...`;
    }
  }

  const plannedLines = [];
  for (const rawLine of lines) {
    const sourceLine = String(rawLine || '');
    let renderedLine = sourceLine;
    if (clipResolved) {
      const truncatedLine = truncateLineToWidth(renderedLine, width, fontSize, fontWeight);
      if (truncatedLine !== renderedLine) {
        truncated = true;
      }
      renderedLine = truncatedLine;
    }
    const xPt = lineX(
      renderedLine,
      effectiveAlignment,
      fontSize,
      fontWeight,
      width,
      textPaddingPt,
    );
    const baselinePt = resolveLineBaselinePt(block, {
      fontSize,
      lineHeight,
      contentHeight: height,
      lineIndex: plannedLines.length,
      lineCount: lines.length,
    });
    plannedLines.push({
      text: renderedLine,
      x_pt: Math.round(xPt * 1000) / 1000,
      baseline_pt: Math.round(baselinePt * 1000) / 1000,
    });
  }

  const maxLineWidth = plannedLines.length
    ? Math.max(...plannedLines.map((line) => measureLinePt(String(line.text || ''), fontSize, fontWeight)))
    : 0;
  const requiredHeight = fontSize + (Math.max(0, plannedLines.length - 1) * lineHeight);
  const widthOverflow = Math.max(0, maxLineWidth - width);
  const heightOverflow = Math.max(0, requiredHeight - height);
  const overflowDetected = widthOverflow > 0.5 || heightOverflow > 0.5;
  const clipMode = String(block?.clip_mode || 'auto');
  const overflowExpected = Boolean(clipResolved && clipMode === 'on');
  const overflowWarning = Boolean(overflowDetected && !overflowExpected);
  const redacted = Boolean(block?.collision) || overflowWarning || Boolean(truncated);

  return {
    drawPlan: {
      font_size: Math.round(fontSize * 1000) / 1000,
      line_height: Math.round(lineHeight * 1000) / 1000,
      font_weight: fontWeight,
      text_orientation: textOrientation,
      text_padding_pt: textPaddingPt,
      truncated: Boolean(truncated),
      lines: plannedLines,
      render_mode: Number(block?.render_mode || 0),
      stroke_width: Math.round((Number(block?.stroke_width || 0)) * 10000) / 10000,
      faux_bold_policy: String(block?.faux_bold_policy || 'semantic'),
    },
    truncated: Boolean(truncated),
    overflow: overflowWarning,
    redacted,
  };
}

export function buildStoredDrawPlanForFittedBlock({
  fittedBlock,
  sourceBlock,
  style,
  sourceClipDefault = false,
  clipMode = 'auto',
  bboxEdited = false,
  fauxBoldPolicy = 'semantic',
  preserveVerticalSourceAnchor = false,
  mirrorEnabled = false,
}) {
  const explicitWeight = String(style?.weight || 'normal');
  const effectiveWeight = (
    explicitWeight === 'bold'
    || (String(fauxBoldPolicy) === 'semantic' && Number(style?.render_mode || 0) === 2)
  ) ? 'bold' : 'normal';
  const lineSpacing = lineSpacingForBlock({ line_height: fittedBlock?.line_height }, Number(fittedBlock?.font_size || style?.font_size || 10));
  const blockForPlan = {
    source_block_id: String(fittedBlock?.source_block_id || sourceBlock?.block_id || ''),
    text: String(fittedBlock?.translated_text || ''),
    bbox: Array.isArray(fittedBlock?.bbox) ? fittedBlock.bbox.map((value) => Number(value)) : [0, 0, 1, 1],
    font_size: Number(fittedBlock?.font_size) || Number(style?.font_size) || 10,
    line_height: Number(fittedBlock?.line_height) || (Number(style?.font_size) || 10) * lineSpacing,
    alignment: String(style?.alignment || 'left'),
    alignment_edited: Boolean(fittedBlock?.alignment_edited || sourceBlock?.alignment_edited),
    font_family: String(style?.font_family || 'sans-serif'),
    font_weight: effectiveWeight,
    source_font_weight: explicitWeight,
    wrap_mode: wrapModeForSourceBlock(sourceBlock || {}),
    clip_mode: clipMode,
    overflow: Boolean(fittedBlock?.overflow),
    collision: Boolean(fittedBlock?.collision),
    redacted: Boolean(fittedBlock?.overflow || fittedBlock?.collision),
    block_type: String(sourceBlock?.type || 'paragraph'),
    render_mode: Number(style?.render_mode || 0),
    stroke_width: Number(style?.stroke_width || 0),
    faux_bold_policy: String(fauxBoldPolicy || 'semantic'),
    text_color: String(style?.color || '#000000'),
    source_text: String(sourceBlock?.text || ''),
    source_clip_default: Boolean(sourceClipDefault),
    bbox_edited: Boolean(bboxEdited),
    source_line_count: Math.max(1, String(sourceBlock?.text || '').split(/\r?\n/u).length),
    source_line_bbox: Array.isArray(sourceBlock?.source_line_bbox)
      ? sourceBlock.source_line_bbox.map((value) => Number(value))
      : undefined,
    source_bottom_inset_ratio: Number.isFinite(Number(sourceBlock?.source_bottom_inset_ratio))
      ? Number(sourceBlock.source_bottom_inset_ratio)
      : undefined,
    source_text_orientation: resolveTextOrientationForBlock(sourceBlock),
    text_rotation_deg: resolveTextRotationDegForBlock(sourceBlock, { mirrorEnabled }),
    preserve_vertical_source_anchor: Boolean(preserveVerticalSourceAnchor),
    style_id: String(fittedBlock?.style_id || style?.style_id || ''),
    text_tightness: String(sourceBlock?.text_tightness || fittedBlock?.text_tightness || ''),
    effective_font_weight: effectiveWeight,
    fit_strategy: fittedBlock?.fit_strategy ? String(fittedBlock.fit_strategy) : undefined,
    bucket_ratio: Number.isFinite(Number(fittedBlock?.bucket_ratio)) ? Number(fittedBlock.bucket_ratio) : undefined,
    nominal_font_size: Number.isFinite(Number(fittedBlock?.nominal_font_size))
      ? Number(fittedBlock.nominal_font_size)
      : undefined,
  };
  const drawMetrics = rebuildLocalDrawPlan(blockForPlan, {
    preferredLines: Array.isArray(fittedBlock?.lines) ? fittedBlock.lines : null,
  });
  return {
    block: {
      ...blockForPlan,
      draw_plan: drawMetrics.drawPlan,
      drawPlan: drawMetrics.drawPlan,
      truncated: drawMetrics.truncated,
      overflow: drawMetrics.overflow,
      redacted: drawMetrics.redacted,
    },
  };
}
