import { rebuildLocalDrawPlan } from './localEditorDrawPlan.js';

const TEXT_PADDING_PT = 1.0;
const MIN_TIGHTENING_MARGIN_PT = 2.0;
const MIN_TIGHTENING_MARGIN_RATIO = 0.15;
const MIN_BBOX_TO_FONT_RATIO = 1.5;
const MAX_BOTTOM_SLACK_REDUCTION_PT = 1.0;

function rectHeight(bbox) {
  return Math.max(0, Number(bbox?.[3] || 0) - Number(bbox?.[1] || 0));
}

function validBBox(candidate) {
  return Array.isArray(candidate) && candidate.length === 4
    ? candidate.map((value) => Number(value))
    : null;
}

function sourceBBoxForBlock(block) {
  return validBBox(block?.source_bbox) || validBBox(block?.bbox);
}

function sourceLineBBoxForBlock(block) {
  return validBBox(block?.source_line_bbox);
}

function clampUnitRatio(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function inferredBottomSlackPt(block, bbox) {
  const sourceLineBBox = sourceLineBBoxForBlock(block);
  if (sourceLineBBox) {
    return Math.max(0, Number(sourceLineBBox[3]) - Number(bbox[3]));
  }
  return rectHeight(bbox) * clampUnitRatio(Number(block?.source_bottom_inset_ratio));
}

function internalBottomMarginPt(block, bbox) {
  const candidateFontSize = Number(block?.font_size);
  if (!Number.isFinite(candidateFontSize) || candidateFontSize <= 0) {
    return 0;
  }
  const candidateLineHeight = Number.isFinite(Number(block?.line_height))
    ? Number(block.line_height)
    : (candidateFontSize * 1.2);
  const candidateBlock = {
    ...block,
    bbox,
    font_size: candidateFontSize,
    line_height: candidateLineHeight,
  };
  const drawMetrics = rebuildLocalDrawPlan(candidateBlock);
  const lines = Array.isArray(drawMetrics?.drawPlan?.lines) ? drawMetrics.drawPlan.lines : [];
  if (lines.length === 0) {
    return 0;
  }
  const textBottom = Math.max(...lines.map((line) => Number(line?.baseline_pt) || 0));
  return Math.max(0, rectHeight(bbox) - textBottom);
}

export function isEligibleForTightTextBBox(block) {
  if (String(block?.block_type || '') !== 'text_line') {
    return false;
  }
  if (Boolean(block?.bbox_edited)) {
    return false;
  }
  const tightness = String(block?.text_tightness || '').trim().toLowerCase();
  if (tightness !== 'tight' && tightness !== 'split-tight') {
    return false;
  }
  if (Number(block?.source_line_count || 0) !== 1) {
    return false;
  }
  const bbox = Array.isArray(block?.bbox) ? block.bbox : null;
  if (!bbox || bbox.length !== 4) {
    return false;
  }
  const sourceFontSize = Number(block?.source_font_size || 0);
  if (!Number.isFinite(sourceFontSize) || sourceFontSize <= 0) {
    return false;
  }
  const currentHeight = rectHeight(bbox);
  if (currentHeight <= 0) {
    return false;
  }
  return (currentHeight / sourceFontSize) >= MIN_BBOX_TO_FONT_RATIO;
}

export function proposeTightTextBBox(block) {
  if (!isEligibleForTightTextBBox(block)) {
    return null;
  }
  const bbox = block.bbox.map((value) => Number(value));
  const currentHeight = rectHeight(bbox);
  const sourceFontSize = Number(block?.source_font_size || 0);
  const slackReduction = Math.min(
    MAX_BOTTOM_SLACK_REDUCTION_PT,
    Math.max(0, inferredBottomSlackPt(block, bbox) * 0.5),
  );
  const tightenedHeight = Math.min(
    currentHeight,
    Math.max((sourceFontSize * 1.15), sourceFontSize + (TEXT_PADDING_PT * 2)) - slackReduction,
  );
  const margin = currentHeight - tightenedHeight;
  const requiredMargin = Math.max(MIN_TIGHTENING_MARGIN_PT, currentHeight * MIN_TIGHTENING_MARGIN_RATIO);
  if (margin < requiredMargin) {
    return null;
  }
  const tightenedBBox = [
    bbox[0],
    bbox[3] - tightenedHeight,
    bbox[2],
    bbox[3],
  ];
  const internalBottomMargin = internalBottomMarginPt(block, tightenedBBox);
  if (internalBottomMargin <= 0.1) {
    return tightenedBBox;
  }
  return [
    tightenedBBox[0],
    tightenedBBox[1] - internalBottomMargin,
    tightenedBBox[2],
    tightenedBBox[3] - internalBottomMargin,
  ];
}

export function applyTightTextBBoxToEditorBlock(block) {
  const proposal = proposeTightTextBBox(block);
  if (!proposal) {
    return block;
  }
  const nextBlock = {
    ...block,
    bbox: proposal,
    pre_fit_bbox: proposal.map((value) => Number(value)),
  };
  const drawMetrics = rebuildLocalDrawPlan(nextBlock);
  return {
    ...nextBlock,
    draw_plan: drawMetrics.drawPlan,
    drawPlan: drawMetrics.drawPlan,
    overflow: drawMetrics.overflow,
    truncated: drawMetrics.truncated,
    redacted: drawMetrics.redacted,
  };
}

export function resolveTightTextBBoxPreview(block) {
  const sourceBBox = sourceBBoxForBlock(block);
  if (!sourceBBox) {
    return null;
  }
  const proposal = proposeTightTextBBox({
    ...block,
    bbox: sourceBBox,
  });
  return {
    sourceBBox,
    displayBBox: proposal || sourceBBox,
    tightened: Boolean(proposal),
  };
}
