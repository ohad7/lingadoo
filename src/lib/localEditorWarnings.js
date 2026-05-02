import { rebuildLocalDrawPlan } from './localEditorDrawPlan.js';
import { measureLinePt } from './textLayoutMetrics.js';
import {
  fitEditableBlockToBBox,
  GLOBAL_MIN_FONT_SIZE,
  TEXT_BLOCK_NUDGE_STEPS,
  DEFAULT_EXPANSION_STEPS,
} from './pdf-core/fitting.js';
import {
  isVerticalTextOrientation,
  mapLogicalRectToPhysicalRect,
} from './textOrientation.js';

const FIT_ACTION_MIN_FONT_SIZE = 1.0;
const FIT_ACTION_ROUND_PRECISION = 2;
const COLLISION_MIN_INTERSECTION_AREA_PT2 = 0.5;
const COLLISION_MIN_AXIS_OVERLAP_PT = 0.75;
const COLLISION_MIN_SMALLER_BOX_COVERAGE = 0.01;
const TABLE_COLLISION_SEAM_MAX_THICKNESS_PT = 1.5;

function hasStoredDrawPlan(block) {
  if (block && Object.prototype.hasOwnProperty.call(block, 'draw_plan')) {
    return Boolean(block?.draw_plan && typeof block.draw_plan === 'object');
  }
  return Boolean(block?.drawPlan && typeof block.drawPlan === 'object');
}

function bboxArea(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return 0;
  return Math.max(0, Number(bbox[2]) - Number(bbox[0])) * Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

function intersectionMetrics(left, right) {
  const x0 = Math.max(left[0], right[0]);
  const y0 = Math.max(left[1], right[1]);
  const x1 = Math.min(left[2], right[2]);
  const y1 = Math.min(left[3], right[3]);
  if (x1 <= x0 || y1 <= y0) {
    return { area: 0, width: 0, height: 0 };
  }
  const width = x1 - x0;
  const height = y1 - y0;
  return { area: width * height, width, height };
}

function isMeaningfulBBoxCollision(left, right) {
  const { area, width, height } = intersectionMetrics(left, right);
  if (area <= COLLISION_MIN_INTERSECTION_AREA_PT2) {
    return false;
  }
  const minArea = Math.min(bboxArea(left), bboxArea(right));
  if (minArea <= 0) {
    return false;
  }
  const minCoverage = area / minArea;
  const seamLike = (
    (width < COLLISION_MIN_AXIS_OVERLAP_PT || height < COLLISION_MIN_AXIS_OVERLAP_PT)
    && minCoverage < COLLISION_MIN_SMALLER_BOX_COVERAGE
  );
  return !seamLike;
}

function isTableSeamOverlap(left, right) {
  const { area, width, height } = intersectionMetrics(left, right);
  if (area <= 0) {
    return false;
  }
  return Math.min(width, height) <= TABLE_COLLISION_SEAM_MAX_THICKNESS_PT;
}

function renderedTextBBox(block) {
  const drawPlan = (block?.draw_plan && typeof block.draw_plan === 'object')
    ? block.draw_plan
    : ((block?.drawPlan && typeof block.drawPlan === 'object') ? block.drawPlan : null);
  const blockBBox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : null;
  if (!drawPlan || !blockBBox) {
    return blockBBox;
  }
  const lines = Array.isArray(drawPlan.lines) ? drawPlan.lines : [];
  if (lines.length === 0) {
    return blockBBox;
  }
  const fontSize = Math.max(1, Number(drawPlan.font_size) || Number(block.font_size) || 10);
  const fontWeight = String(drawPlan.font_weight || block.font_weight || 'normal');
  const textOrientation = String(drawPlan.text_orientation || block.source_text_orientation || 'horizontal');
  const textRotationDeg = Number(block?.text_rotation_deg || 0);
  const blockWidth = Math.max(0, Number(blockBBox[2]) - Number(blockBBox[0]));
  const blockHeight = Math.max(0, Number(blockBBox[3]) - Number(blockBBox[1]));
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let hasVisibleLine = false;
  for (const line of lines) {
    const text = String(line?.text || '');
    const width = measureLinePt(text, fontSize, fontWeight);
    const logicalX0 = Number(line?.x_pt) || 0;
    const logicalBaseline = Number(line?.baseline_pt) || fontSize;
    const logicalY0 = logicalBaseline - fontSize;
    const logicalRect = [logicalX0, logicalY0, logicalX0 + width, logicalY0 + fontSize];
    const rect = isVerticalTextOrientation(textOrientation)
      ? mapLogicalRectToPhysicalRect(logicalRect, {
          physicalWidth: blockWidth,
          physicalHeight: blockHeight,
          rotationDeg: textRotationDeg,
        })
      : logicalRect;
    const lineX0 = Number(blockBBox[0]) + Number(rect[0] || 0);
    const lineY0 = Number(blockBBox[1]) + Number(rect[1] || 0);
    const lineX1 = Number(blockBBox[0]) + Number(rect[2] || 0);
    const lineY1 = Number(blockBBox[1]) + Number(rect[3] || 0);
    if (!Number.isFinite(lineX0) || !Number.isFinite(lineY0) || !Number.isFinite(lineX1) || !Number.isFinite(lineY1)) {
      continue;
    }
    x0 = Math.min(x0, lineX0);
    y0 = Math.min(y0, lineY0);
    x1 = Math.max(x1, lineX1);
    y1 = Math.max(y1, lineY1);
    hasVisibleLine = true;
  }
  if (!hasVisibleLine) {
    return blockBBox;
  }
  return [x0, y0, x1, y1];
}

function markVisualCollisions(blocks, {
  tableSourceBlockIds = new Set(),
} = {}) {
  for (const block of blocks) {
    block.collision = false;
    block.collides_with = [];
  }

  const visualBBoxes = new Map(
    blocks.map((block) => [String(block.source_block_id || ''), renderedTextBBox(block) || block.bbox]),
  );

  for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
      const left = blocks[leftIndex];
      const right = blocks[rightIndex];
      const leftBBox = visualBBoxes.get(String(left.source_block_id || '')) || left.bbox;
      const rightBBox = visualBBoxes.get(String(right.source_block_id || '')) || right.bbox;
      if (
        tableSourceBlockIds.has(left.source_block_id)
        && tableSourceBlockIds.has(right.source_block_id)
        && isTableSeamOverlap(leftBBox, rightBBox)
      ) {
        continue;
      }
      if (!isMeaningfulBBoxCollision(leftBBox, rightBBox)) {
        continue;
      }
      left.collision = true;
      right.collision = true;
      if (!left.collides_with.includes(right.source_block_id)) {
        left.collides_with.push(right.source_block_id);
      }
      if (!right.collides_with.includes(left.source_block_id)) {
        right.collides_with.push(left.source_block_id);
      }
    }
  }
}

export function recomputePageWarnings(page, {
  recomputeAllDrawPlans = false,
} = {}) {
  const nextBlocks = (page?.blocks || []).map((block) => {
    const nextBlock = { ...block };
    if (recomputeAllDrawPlans || !hasStoredDrawPlan(nextBlock)) {
      const drawMetrics = rebuildLocalDrawPlan(nextBlock);
      nextBlock.draw_plan = drawMetrics.drawPlan;
      nextBlock.drawPlan = drawMetrics.drawPlan;
      nextBlock.overflow = drawMetrics.overflow;
      nextBlock.truncated = drawMetrics.truncated;
      nextBlock.redacted = drawMetrics.redacted;
    }
    return nextBlock;
  });

  const tableSourceBlockIds = new Set(
    nextBlocks
      .filter((block) => String(block?.block_type || '') === 'table_cell')
      .map((block) => String(block.source_block_id || '')),
  );
  markVisualCollisions(nextBlocks, { tableSourceBlockIds });

  for (const block of nextBlocks) {
    block.redacted = Boolean(block.collision) || Boolean(block.overflow) || Boolean(block.truncated);
  }

  return {
    ...page,
    blocks: nextBlocks,
  };
}

function buildCandidateVisualBBox(block, candidateBBox, candidateFit) {
  const candidateBlock = {
    ...block,
    bbox: candidateBBox,
    font_size: candidateFit.fontSize,
    line_height: candidateFit.lineHeight,
    overflow: candidateFit.overflow,
    truncated: candidateFit.overflow,
  };
  const drawMetrics = rebuildLocalDrawPlan(candidateBlock);
  return renderedTextBBox({
    ...candidateBlock,
    draw_plan: drawMetrics.drawPlan,
    drawPlan: drawMetrics.drawPlan,
  }) || candidateBBox;
}

function collisionSafe(block, candidateBBox, candidateFit, blocks, pageSize, {
  strictBBoxCollisionEnabled = false,
} = {}) {
  const [pageWidth, pageHeight] = pageSize;
  if (candidateBBox[0] < 0 || candidateBBox[1] < 0
    || candidateBBox[2] > pageWidth || candidateBBox[3] > pageHeight) {
    return false;
  }
  const candidateVisualBBox = buildCandidateVisualBBox(block, candidateBBox, candidateFit);
  for (const other of blocks) {
    if (String(other.source_block_id) === String(block.source_block_id)) continue;
    if (strictBBoxCollisionEnabled && isMeaningfulBBoxCollision(candidateBBox, other.bbox)) {
      return false;
    }
    const otherVisualBBox = renderedTextBBox(other) || other.bbox;
    if (isMeaningfulBBoxCollision(candidateVisualBBox, otherVisualBBox)) return false;
  }
  return true;
}

function bboxAreaSafe(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return 0;
  return Math.max(0, Number(bbox[2]) - Number(bbox[0])) * Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

const NUDGE_PAGE_MARGIN = 4;

function nudgeBBoxRightwardWithoutHeightGrowth(bbox, { ratio, pageSize }) {
  const [x0, y0, x1, y1] = bbox;
  const [pageWidth] = pageSize;
  const width = Math.max(1, Number(x1) - Number(x0));
  const rightGrowth = width * ratio;
  return [
    x0,
    y0,
    Math.min(pageWidth - NUDGE_PAGE_MARGIN, x1 + rightGrowth),
    y1,
  ];
}

function nudgeBBoxDownwardWithoutWidthGrowth(bbox, { ratio, pageSize }) {
  const [x0, y0, x1, y1] = bbox;
  const [, pageHeight] = pageSize;
  const height = Math.max(1, Number(y1) - Number(y0));
  const downwardGrowth = height * ratio;
  return [
    x0,
    y0,
    x1,
    Math.min(pageHeight - NUDGE_PAGE_MARGIN, y1 + downwardGrowth),
  ];
}

function expandBBoxRightwardWithoutHeightGrowth(bbox, {
  ratio,
  pageSize,
  blockType,
}) {
  const [x0, y0, x1, y1] = bbox;
  const [pageWidth] = pageSize;
  const width = Math.max(1, Number(x1) - Number(x0));
  const rightGrowth = blockType === 'title'
    ? width * (ratio * 4)
    : width * (ratio * 0.2);
  return [
    x0,
    y0,
    Math.min(pageWidth, x1 + rightGrowth),
    y1,
  ];
}

function lineSpacingForWarningBlock(block) {
  const fontSize = Math.max(1, Number(block?.font_size) || 10);
  const wrapMode = (
    isVerticalTextOrientation(block?.source_text_orientation)
      ? 'none'
      : (String(block?.wrap_mode || '') === 'word' ? 'word' : 'none')
  );
  const lineHeight = Number(block?.line_height);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return wrapMode === 'word' ? 1.0 : 1.2;
  }
  const ratio = lineHeight / fontSize;
  if (!Number.isFinite(ratio) || ratio < 0.8 || ratio > 2.5) {
    return wrapMode === 'word' ? 1.0 : 1.2;
  }
  if (wrapMode === 'word') {
    return Math.max(1.0, ratio);
  }
  return ratio;
}

function roundFitValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return numeric;
  }
  return Math.round(numeric * (10 ** FIT_ACTION_ROUND_PRECISION)) / (10 ** FIT_ACTION_ROUND_PRECISION);
}

function shouldAttemptVerticalOverflowRepair(block) {
  if (Boolean(block?.bbox_edited)) {
    return false;
  }
  if (String(block?.block_type || '') === 'table_cell') {
    return false;
  }
  if (Boolean(block?.truncated) || !Boolean(block?.overflow)) {
    return false;
  }
  if (Math.max(1, Number(block?.source_line_count) || 0) !== 1) {
    return false;
  }
  const bbox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1];
  const contentHeight = Math.max(1, (Number(bbox[3]) - Number(bbox[1])) - 2);
  const lineHeight = Math.max(1, Number(block?.line_height) || ((Number(block?.font_size) || 10) * 1.2));
  return lineHeight > contentHeight + 0.5;
}

function evaluateWarningAlignedFit(block, {
  bbox,
  fontSize,
  blocks,
  pageSize,
  roundOutput = false,
}) {
  const lineSpacing = lineSpacingForWarningBlock(block);
  const resolvedFontSize = roundOutput ? roundFitValue(fontSize) : fontSize;
  const resolvedLineHeight = roundOutput
    ? roundFitValue(resolvedFontSize * lineSpacing)
    : (resolvedFontSize * lineSpacing);
  const candidateFit = {
    fontSize: resolvedFontSize,
    lineHeight: resolvedLineHeight,
    overflow: false,
  };
  const candidateBlock = {
    ...block,
    bbox,
    font_size: resolvedFontSize,
    line_height: resolvedLineHeight,
  };
  const drawMetrics = rebuildLocalDrawPlan(candidateBlock);
  const nextBlock = {
    ...candidateBlock,
    draw_plan: drawMetrics.drawPlan,
    drawPlan: drawMetrics.drawPlan,
    overflow: drawMetrics.overflow,
    truncated: drawMetrics.truncated,
    redacted: drawMetrics.redacted,
  };
  const collisionFree = collisionSafe(block, bbox, {
    ...candidateFit,
    overflow: nextBlock.overflow,
  }, blocks, pageSize);
  return {
    block: nextBlock,
    collisionFree,
    clean: !nextBlock.overflow && !nextBlock.truncated && collisionFree,
  };
}

function findBestWarningAlignedShrink(block, {
  bbox,
  blocks,
  pageSize,
  minFontSize = FIT_ACTION_MIN_FONT_SIZE,
  maxFontSize,
  roundOutput = false,
}) {
  const low = Math.max(1, Number(minFontSize) || FIT_ACTION_MIN_FONT_SIZE);
  const high = Math.max(low, Number(maxFontSize) || low);
  const atHigh = evaluateWarningAlignedFit(block, {
    bbox,
    fontSize: high,
    blocks,
    pageSize,
    roundOutput,
  });
  if (atHigh.clean) {
    return atHigh.block;
  }
  const atLow = evaluateWarningAlignedFit(block, {
    bbox,
    fontSize: low,
    blocks,
    pageSize,
    roundOutput,
  });
  if (!atLow.clean) {
    return atLow.block;
  }

  let lo = low;
  let hi = high;
  let best = atLow.block;
  for (let index = 0; index < 16; index += 1) {
    const mid = (lo + hi) / 2;
    const attempt = evaluateWarningAlignedFit(block, {
      bbox,
      fontSize: mid,
      blocks,
      pageSize,
      roundOutput,
    });
    if (attempt.clean) {
      best = attempt.block;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

export function fitBlockToWarningPreview(block, {
  blocks,
  pageSize,
  minFontSize = FIT_ACTION_MIN_FONT_SIZE,
  maxFontSize = null,
  allowGrowth = true,
} = {}) {
  const bbox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1];
  const optimisticFit = fitEditableBlockToBBox(block, {
    minFontSize,
    maxFontSize,
    allowGrowth,
  });
  const optimisticFontSize = Number(optimisticFit.fontSize);
  if (!Number.isFinite(optimisticFontSize) || optimisticFontSize <= 0) {
    return {
      ...block,
      overflow: true,
    };
  }

  const alignedBlock = findBestWarningAlignedShrink(block, {
    bbox,
    blocks: Array.isArray(blocks) ? blocks : [block],
    pageSize: Array.isArray(pageSize) ? pageSize : [1, 1],
    minFontSize,
    maxFontSize: optimisticFontSize,
    roundOutput: true,
  });
  return {
    ...alignedBlock,
    fit_strategy: block?.fit_strategy,
  };
}

function isBetterFit(candidate, current, {
  maxFontSize,
  candidateBBox,
  currentBBox,
}) {
  const candidateFits = !candidate.overflow;
  const currentFits = !current.overflow;
  if (candidateFits && !currentFits) return true;
  if (!candidateFits && currentFits) return false;
  const cap = Math.max(1, Number(maxFontSize) || 0) + 0.01;
  const candidateFont = Math.min(candidate.fontSize, cap);
  const currentFont = Math.min(current.fontSize, cap);
  if (Math.abs(candidateFont - currentFont) > 0.01) return candidateFont > currentFont;
  const candidateArea = bboxAreaSafe(candidateBBox);
  const currentArea = bboxAreaSafe(currentBBox);
  if (candidateFits && currentFits) {
    if (candidateArea + 0.1 < currentArea) return true;
    return false;
  }
  if (candidateArea > currentArea + 0.1) return true;
  return false;
}

function findRightBarrierLimit(blockBBox, horizontalBarriers) {
  if (!Array.isArray(horizontalBarriers) || horizontalBarriers.length === 0) return Infinity;
  const blockY0 = Number(blockBBox[1]);
  const blockY1 = Number(blockBBox[3]);
  const blockHeight = blockY1 - blockY0;
  if (blockHeight <= 0) return Infinity;
  const blockX1 = Number(blockBBox[2]);
  let closest = Infinity;
  for (const barrier of horizontalBarriers) {
    const bx = Number(barrier.x);
    if (bx <= blockX1) continue;
    const overlapY0 = Math.max(blockY0, Number(barrier.y1));
    const overlapY1 = Math.min(blockY1, Number(barrier.y2));
    const overlap = Math.max(0, overlapY1 - overlapY0);
    if (overlap >= blockHeight * 0.5 && bx < closest) {
      closest = bx;
    }
  }
  return closest === Infinity ? Infinity : closest - 1.5;
}

export function applyAutoNudgeToPage(page, {
  repairVerticalOverflowEnabled = false,
  horizontalBarriers = [],
  strictAutoNudgeBBoxCollisionEnabled = true,
} = {}) {
  const warningPage = recomputePageWarnings(page, { recomputeAllDrawPlans: true });
  const blocks = warningPage.blocks.map((b) => ({ ...b }));
  const pageSize = page.page_size_pt || [1, 1];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.block_type === 'table_cell') continue;

    const currentFontSize = Math.max(1, Number(block.font_size) || 10);
    const hasIssue = block.overflow || block.truncated;
    if (!hasIssue) continue;

    let bestBBox = block.bbox;
    let bestFit = {
      fontSize: currentFontSize,
      lineHeight: Number(block.line_height) || (currentFontSize * 1.2),
      lines: Array.isArray(block.draw_plan?.lines)
        ? block.draw_plan.lines.map((line) => String(line?.text || ''))
        : String(block.text || '').split(/\r?\n/u),
      overflow: Boolean(block.overflow || block.truncated),
      lineSpacing: currentFontSize > 0
        ? ((Number(block.line_height) || (currentFontSize * 1.2)) / currentFontSize)
        : 1.2,
    };

    const rightBarrierLimit = findRightBarrierLimit(block.bbox, horizontalBarriers);

    for (const ratio of TEXT_BLOCK_NUDGE_STEPS) {
      let nudgedBBox = nudgeBBoxRightwardWithoutHeightGrowth(block.bbox, {
        ratio, pageSize,
      });
      if (nudgedBBox[2] > rightBarrierLimit) {
        nudgedBBox = [nudgedBBox[0], nudgedBBox[1], rightBarrierLimit, nudgedBBox[3]];
      }
      const candidate = fitEditableBlockToBBox({ ...block, bbox: nudgedBBox }, {
        minFontSize: currentFontSize,
        maxFontSize: currentFontSize,
      });
      if (!collisionSafe(block, nudgedBBox, candidate, blocks, pageSize, {
        strictBBoxCollisionEnabled: strictAutoNudgeBBoxCollisionEnabled,
      })) continue;
      if (isBetterFit(candidate, bestFit, {
        maxFontSize: currentFontSize,
        candidateBBox: nudgedBBox,
        currentBBox: bestBBox,
      })) {
        bestBBox = nudgedBBox;
        bestFit = candidate;
      }
    }

    if (bestFit.overflow) {
      for (const ratio of DEFAULT_EXPANSION_STEPS) {
        let expandedBBox = expandBBoxRightwardWithoutHeightGrowth(block.bbox, {
          ratio, pageSize, blockType: block.block_type,
        });
        if (expandedBBox[2] > rightBarrierLimit) {
          expandedBBox = [expandedBBox[0], expandedBBox[1], rightBarrierLimit, expandedBBox[3]];
        }
        const candidate = fitEditableBlockToBBox({ ...block, bbox: expandedBBox }, {
          minFontSize: currentFontSize,
          maxFontSize: currentFontSize,
        });
        if (!collisionSafe(block, expandedBBox, candidate, blocks, pageSize, {
          strictBBoxCollisionEnabled: strictAutoNudgeBBoxCollisionEnabled,
        })) continue;
        if (isBetterFit(candidate, bestFit, {
          maxFontSize: currentFontSize,
          candidateBBox: expandedBBox,
          currentBBox: bestBBox,
        })) {
          bestBBox = expandedBBox;
          bestFit = candidate;
        }
      }
    }

    if (repairVerticalOverflowEnabled === true && shouldAttemptVerticalOverflowRepair({
      ...block,
      bbox: bestBBox,
      font_size: bestFit.fontSize,
      line_height: bestFit.lineHeight,
      overflow: bestFit.overflow,
      truncated: false,
    })) {
      for (const ratio of TEXT_BLOCK_NUDGE_STEPS) {
        const verticallyNudgedBBox = nudgeBBoxDownwardWithoutWidthGrowth(bestBBox, {
          ratio, pageSize,
        });
        const candidate = fitEditableBlockToBBox({ ...block, bbox: verticallyNudgedBBox }, {
          minFontSize: currentFontSize,
          maxFontSize: currentFontSize,
        });
        if (!collisionSafe(block, verticallyNudgedBBox, candidate, blocks, pageSize, {
          strictBBoxCollisionEnabled: strictAutoNudgeBBoxCollisionEnabled,
        })) continue;
        if (isBetterFit(candidate, bestFit, {
          maxFontSize: currentFontSize,
          candidateBBox: verticallyNudgedBBox,
          currentBBox: bestBBox,
        })) {
          bestBBox = verticallyNudgedBBox;
          bestFit = candidate;
        }
      }
    }

    const usesBucketRatio = String(block.fit_strategy || '') === 'bucket_ratio';
    const bboxChanged = bestBBox !== block.bbox;
    const fontChanged = Math.abs(bestFit.fontSize - currentFontSize) > 0.01;
    if (bboxChanged || fontChanged || usesBucketRatio) {
      let nextBlock = {
        ...block,
        bbox: bestBBox,
        font_size: bestFit.fontSize,
        line_height: bestFit.lineHeight,
        overflow: bestFit.overflow,
        truncated: bestFit.overflow,
      };
      let drawMetrics = rebuildLocalDrawPlan(nextBlock);
      nextBlock = {
        ...nextBlock,
        draw_plan: drawMetrics.drawPlan,
        drawPlan: drawMetrics.drawPlan,
        overflow: drawMetrics.overflow,
        truncated: drawMetrics.truncated,
        redacted: drawMetrics.redacted,
      };

      if (usesBucketRatio && (nextBlock.overflow || nextBlock.truncated)) {
        const fallbackBlock = findBestWarningAlignedShrink(nextBlock, {
          bbox: nextBlock.bbox,
          blocks,
          pageSize,
          minFontSize: GLOBAL_MIN_FONT_SIZE,
          maxFontSize: currentFontSize,
        });
        const fallbackImproves = (
          (!(fallbackBlock.overflow || fallbackBlock.truncated) && (nextBlock.overflow || nextBlock.truncated))
          || Number(fallbackBlock.font_size) < (Number(nextBlock.font_size) || currentFontSize) - 0.01
        );
        if (fallbackImproves) {
          nextBlock = fallbackBlock;
        }
      }

      blocks[i] = nextBlock;
    }
  }

  return recomputePageWarnings({ ...warningPage, blocks }, { recomputeAllDrawPlans: true });
}

export function finalizeEditorPageWarnings(page, {
  autoNudgeEnabled = true,
  repairVerticalOverflowEnabled = false,
  horizontalBarriers = [],
  strictAutoNudgeBBoxCollisionEnabled = true,
} = {}) {
  if (autoNudgeEnabled === false) {
    return recomputePageWarnings(page, { recomputeAllDrawPlans: true });
  }
  return applyAutoNudgeToPage(page, {
    repairVerticalOverflowEnabled,
    horizontalBarriers,
    strictAutoNudgeBBoxCollisionEnabled,
  });
}
