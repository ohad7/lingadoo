import { extractFeatures } from './continuationFeatures.js';
import { scorePair } from './continuationModel.js';
import continuationWeights from './continuationWeights.json' with { type: 'json' };

/**
 * Sentence continuation detector for Hebrew PDF text blocks.
 *
 * Detects groups of adjacent blocks whose source_text likely forms
 * a single sentence that was split across multiple extraction blocks.
 * This is a diagnostic tool — it reports groups but does not merge them.
 */

const HEBREW_CHAR_RE = /[\u0590-\u05FF]/;

const MAX_VERTICAL_GAP_FACTOR = 2.0;
const MAX_HORIZONTAL_GAP_PT = 15;
const BARRIER_EDGE_TOLERANCE_PT = 2;
const BBOX_PADDING = 2;

function normalizeHorizontalBarrier(barrier) {
  return {
    ...barrier,
    x: Number(barrier?.x),
    y1: Number(barrier?.y1),
    y2: Number(barrier?.y2),
  };
}

function normalizeVerticalBarrier(barrier) {
  return {
    ...barrier,
    y: Number(barrier?.y),
    x1: Number(barrier?.x1),
    x2: Number(barrier?.x2),
  };
}

export function projectContinuationBarriers({
  horizontalBarriers = [],
  verticalBarriers = [],
  pageWidthPt = 0,
  mirrorEnabled = false,
} = {}) {
  const normalizedHorizontalBarriers = Array.isArray(horizontalBarriers)
    ? horizontalBarriers.map(normalizeHorizontalBarrier)
    : [];
  const normalizedVerticalBarriers = Array.isArray(verticalBarriers)
    ? verticalBarriers.map(normalizeVerticalBarrier)
    : [];
  const numericPageWidth = Number(pageWidthPt);
  if (!mirrorEnabled || !Number.isFinite(numericPageWidth) || numericPageWidth <= 0) {
    return {
      horizontalBarriers: normalizedHorizontalBarriers,
      verticalBarriers: normalizedVerticalBarriers,
    };
  }
  return {
    horizontalBarriers: normalizedHorizontalBarriers.map((barrier) => ({
      ...barrier,
      x: numericPageWidth - Number(barrier.x),
    })),
    verticalBarriers: normalizedVerticalBarriers.map((barrier) => ({
      ...barrier,
      x1: numericPageWidth - Number(barrier.x2),
      x2: numericPageWidth - Number(barrier.x1),
    })),
  };
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

function centerY(bbox) {
  return (Number(bbox[1]) + Number(bbox[3])) / 2;
}

function sameRow(a, b) {
  const aH = rectHeight(a);
  const bH = rectHeight(b);
  const minH = Math.min(aH, bH);
  if (minH <= 0) return false;
  const overlap = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return (overlap / minH) >= 0.5;
}

function verticalGap(bboxA, bboxB) {
  const botA = Math.max(bboxA[1], bboxA[3]);
  const topB = Math.min(bboxB[1], bboxB[3]);
  const botB = Math.max(bboxB[1], bboxB[3]);
  const topA = Math.min(bboxA[1], bboxA[3]);
  if (botA <= topB) return topB - botA;
  if (botB <= topA) return topA - botB;
  return 0; // overlapping
}

function horizontalGap(bboxA, bboxB) {
  const gap1 = bboxA[0] - bboxB[2]; // B is to the left of A
  const gap2 = bboxB[0] - bboxA[2]; // A is to the left of B
  if (gap1 >= 0) return gap1;
  if (gap2 >= 0) return gap2;
  return 0; // overlapping — treat as zero gap (adjacent)
}

function horizontalOverlapRatio(bboxA, bboxB) {
  const overlapStart = Math.max(bboxA[0], bboxB[0]);
  const overlapEnd = Math.min(bboxA[2], bboxB[2]);
  if (overlapEnd <= overlapStart) return 0;
  const minWidth = Math.min(rectWidth(bboxA), rectWidth(bboxB));
  return minWidth > 0 ? (overlapEnd - overlapStart) / minWidth : 0;
}

function rectWidth(bbox) {
  return Math.max(0, Number(bbox[2]) - Number(bbox[0]));
}

function isProximate(bboxA, bboxB) {
  if (sameRow(bboxA, bboxB)) {
    return horizontalGap(bboxA, bboxB) <= MAX_HORIZONTAL_GAP_PT;
  }
  const maxBlockHeight = Math.max(rectHeight(bboxA), rectHeight(bboxB));
  const vGap = verticalGap(bboxA, bboxB);
  if (vGap > maxBlockHeight * MAX_VERTICAL_GAP_FACTOR) return false;
  // Non-same-row blocks must have some horizontal overlap to be considered
  // vertically adjacent (prevents merging blocks in different columns)
  return horizontalOverlapRatio(bboxA, bboxB) >= 0.2;
}

function containsHebrew(text) {
  return HEBREW_CHAR_RE.test(text);
}

/**
 * Check if a vertical barrier (detected horizontal line) separates two vertically-stacked blocks.
 * Vertical barriers have { y, x1, x2 } in pt coordinates — blocks top↔bottom merges.
 */
function hasVerticalBarrier(bboxA, bboxB, verticalBarriers) {
  if (!Array.isArray(verticalBarriers) || verticalBarriers.length === 0) return false;
  // Determine vertical gap between the two blocks
  // gapStart = bottom of the upper block, gapEnd = top of the lower block
  const gapStart = Math.min(Math.max(bboxA[1], bboxA[3]), Math.max(bboxB[1], bboxB[3]));
  const gapEnd = Math.max(Math.min(bboxA[1], bboxA[3]), Math.min(bboxB[1], bboxB[3]));
  if (gapStart >= gapEnd) return false; // blocks overlap vertically, no gap for barrier
  // Horizontal span of the pair
  const pairX0 = Math.min(bboxA[0], bboxB[0]);
  const pairX1 = Math.max(bboxA[2], bboxB[2]);
  const pairWidth = pairX1 - pairX0;
  if (pairWidth <= 0) return false;
  for (const barrier of verticalBarriers) {
    const by = Number(barrier.y);
    const bx1 = Number(barrier.x1);
    const bx2 = Number(barrier.x2);
    // Treat dividers that land on a block edge as blockers too; this is
    // intentionally conservative to avoid false-positive merge candidates.
    if (by < (gapStart - BARRIER_EDGE_TOLERANCE_PT) || by > (gapEnd + BARRIER_EDGE_TOLERANCE_PT)) continue;
    // Barrier must overlap horizontally with the pair
    const overlapX0 = Math.max(pairX0, bx1);
    const overlapX1 = Math.min(pairX1, bx2);
    if (overlapX1 <= overlapX0) continue;
    const overlapRatio = (overlapX1 - overlapX0) / pairWidth;
    if (overlapRatio >= 0.3) return true;
  }
  return false;
}

/**
 * Check if a horizontal barrier (detected vertical line/edge) separates two blocks horizontally.
 * Horizontal barriers have { x, y1, y2 } in pt coordinates — blocks left↔right merges.
 */
function hasHorizontalBarrier(bboxA, bboxB, horizontalBarriers) {
  if (!Array.isArray(horizontalBarriers) || horizontalBarriers.length === 0) return false;
  // Determine horizontal span between the two blocks
  const leftEdge = Math.min(bboxA[2], bboxB[2]);
  const rightEdge = Math.max(bboxA[0], bboxB[0]);
  if (leftEdge >= rightEdge) return false; // blocks overlap horizontally, no gap for barrier
  // Vertical span of the pair
  const pairY0 = Math.min(bboxA[1], bboxB[1]);
  const pairY1 = Math.max(bboxA[3], bboxB[3]);
  const pairHeight = pairY1 - pairY0;
  if (pairHeight <= 0) return false;
  for (const barrier of horizontalBarriers) {
    const bx = Number(barrier.x);
    const by1 = Number(barrier.y1);
    const by2 = Number(barrier.y2);
    // Be conservative here as well: a divider touching either block edge
    // should still suppress the merge candidate.
    if (bx < (leftEdge - BARRIER_EDGE_TOLERANCE_PT) || bx > (rightEdge + BARRIER_EDGE_TOLERANCE_PT)) continue;
    // Barrier must overlap vertically with the pair
    const overlapY0 = Math.max(pairY0, by1);
    const overlapY1 = Math.min(pairY1, by2);
    if (overlapY1 <= overlapY0) continue;
    const overlapRatio = (overlapY1 - overlapY0) / pairHeight;
    if (overlapRatio >= 0.3) return true;
  }
  return false;
}

function shouldMergePairDirected(a, b) {
  const textA = String(a.source_text || '').trim();
  const textB = String(b.source_text || '').trim();
  if (!textA || !textB) return false;
  if (!containsHebrew(textA)) return false;
  if (!isProximate(a.bbox, b.bbox)) return false;

  const features = extractFeatures(a, b);
  return scorePair(features, continuationWeights) > 0;
}

function shouldMergePair(a, b) {
  if (shouldMergePairDirected(a, b)) return true;
  // RTL reading order may place a non-Hebrew block (date/number) before
  // the Hebrew block on the same row. Try the reverse direction.
  if (sameRow(a.bbox, b.bbox) && shouldMergePairDirected(b, a)) return true;
  return false;
}

function hasBarrier(aIdx, bIdx, allBlocks) {
  const candidateA = allBlocks[aIdx];
  const candidateB = allBlocks[bIdx];
  const lo = Math.min(aIdx, bIdx);
  const hi = Math.max(aIdx, bIdx);
  for (let i = lo + 1; i < hi; i++) {
    const between = allBlocks[i];
    const bboxBetween = between.bbox;

    // Barrier must be vertically between A and B
    const bottomA = Math.max(candidateA.bbox[1], candidateA.bbox[3]);
    const topB = Math.min(candidateB.bbox[1], candidateB.bbox[3]);
    const topBetween = Math.min(bboxBetween[1], bboxBetween[3]);
    const bottomBetween = Math.max(bboxBetween[1], bboxBetween[3]);
    const vertBetween = topBetween >= bottomA && bottomBetween <= topB;

    // Barrier must overlap horizontally with the A-B span
    const spanX0 = Math.min(candidateA.bbox[0], candidateB.bbox[0]);
    const spanX2 = Math.max(candidateA.bbox[2], candidateB.bbox[2]);
    const barrierX0 = Math.min(bboxBetween[0], bboxBetween[2]);
    const barrierX2 = Math.max(bboxBetween[0], bboxBetween[2]);
    const horizOverlap = barrierX0 < spanX2 && barrierX2 > spanX0;

    if (vertBetween && horizOverlap) {
      return true;
    }
  }
  return false;
}

function sortByReadingOrder(blocks) {
  return [...blocks].sort((a, b) => {
    const dy = centerY(a.bbox) - centerY(b.bbox);
    if (Math.abs(dy) > 2) return dy;
    // RTL: higher x comes first
    return Number(b.bbox[0]) - Number(a.bbox[0]);
  });
}

function unionBBox(bboxes) {
  return [
    Math.min(...bboxes.map((b) => b[0])) - BBOX_PADDING,
    Math.min(...bboxes.map((b) => b[1])) - BBOX_PADDING,
    Math.max(...bboxes.map((b) => b[2])) + BBOX_PADDING,
    Math.max(...bboxes.map((b) => b[3])) + BBOX_PADDING,
  ];
}

/**
 * Detect groups of blocks whose source_text likely continues across block boundaries.
 *
 * @param {Array} blocks - Array of PageBlock objects with source_block_id, bbox, source_text,
 *                         font_size, font_family, block_type
 * @param {{horizontalBarriers?: Array<{x: number, y1: number, y2: number}>, verticalBarriers?: Array<{y: number, x1: number, x2: number}>}} [options]
 * @returns {Array<{blockIds: string[], bbox: number[]}>} Continuation groups
 */
export function detectContinuationGroups(blocks, options = {}) {
  const horizontalBarriers = options.horizontalBarriers || [];
  const verticalBarriers = options.verticalBarriers || [];
  if (!Array.isArray(blocks) || blocks.length < 2) return [];

  // Filter: skip table cells and blocks without source_text
  const eligible = blocks.filter((b) => {
    if (!b.source_text || !String(b.source_text).trim()) return false;
    if (b.block_type === 'table_cell') return false;
    return true;
  });

  if (eligible.length < 2) return [];

  const sorted = sortByReadingOrder(eligible);

  // Pairwise scanning with greedy chaining
  const groups = [];
  const used = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const currentGroup = [i];

    let tail = i;
    let found = true;
    while (found) {
      found = false;
      for (let j = tail + 1; j < sorted.length; j++) {
        if (used.has(j)) continue;
        if (shouldMergePair(sorted[tail], sorted[j]) && !hasBarrier(tail, j, sorted) && !hasHorizontalBarrier(sorted[tail].bbox, sorted[j].bbox, horizontalBarriers) && !hasVerticalBarrier(sorted[tail].bbox, sorted[j].bbox, verticalBarriers)) {
          currentGroup.push(j);
          used.add(j);
          tail = j;
          found = true;
          break;
        }
      }
    }

    if (currentGroup.length >= 2) {
      groups.push({
        blockIds: currentGroup.map((idx) => sorted[idx].source_block_id),
        bbox: unionBBox(currentGroup.map((idx) => sorted[idx].bbox)),
      });
    }
  }

  return groups;
}
