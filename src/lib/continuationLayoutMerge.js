import { detectContinuationGroups } from './sentenceContinuationDetector.js';
import { blockInCell, detectTableCells } from './tableCellDetector.js';

function cloneLayout(layout) {
  if (typeof structuredClone === 'function') {
    return structuredClone(layout);
  }
  return JSON.parse(JSON.stringify(layout));
}

function normalizeTextPart(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function mergeSourceTexts(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block) => normalizeTextPart(block?.text))
    .filter(Boolean)
    .join(' ');
}

function unionBBox(blocks, fieldName = 'bbox') {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const bbox = Array.isArray(block?.[fieldName]) ? block[fieldName] : null;
    if (!bbox || bbox.length !== 4) {
      continue;
    }
    const [bx1, by1, bx2, by2] = bbox.map((value) => Number(value));
    if (![bx1, by1, bx2, by2].every(Number.isFinite)) {
      continue;
    }
    x1 = Math.min(x1, bx1);
    y1 = Math.min(y1, by1);
    x2 = Math.max(x2, bx2);
    y2 = Math.max(y2, by2);
    found = true;
  }
  return found ? [x1, y1, x2, y2] : [0, 0, 1, 1];
}

function cellArea(cell) {
  return Math.max(0, Number(cell?.x2) - Number(cell?.x1)) * Math.max(0, Number(cell?.y2) - Number(cell?.y1));
}

function sameStyleFamily(leftStyle, rightStyle) {
  return String(leftStyle?.font_family || '') === String(rightStyle?.font_family || '');
}

function sameStyleWeight(leftStyle, rightStyle) {
  return String(leftStyle?.weight || '') === String(rightStyle?.weight || '');
}

function sameFontSize(leftStyle, rightStyle) {
  return Math.abs(Number(leftStyle?.font_size || 0) - Number(rightStyle?.font_size || 0)) <= 0.5;
}

function buildDetectionBlock(layoutBlock, style) {
  return {
    source_block_id: String(layoutBlock?.block_id || ''),
    bbox: Array.isArray(layoutBlock?.bbox) ? layoutBlock.bbox.map((value) => Number(value)) : [0, 0, 1, 1],
    source_text: String(layoutBlock?.text || ''),
    font_size: Number(style?.font_size || 10),
    font_family: String(style?.font_family || ''),
    block_type: String(layoutBlock?.type || ''),
  };
}

function intersectSharedCells(groupBlocks, tableCells) {
  const cellsByBlock = groupBlocks.map((block) => (
    tableCells.filter((cell) => blockInCell(block.bbox, cell))
  ));
  if (cellsByBlock.some((cells) => cells.length === 0)) {
    return { sharedCells: [], cellsByBlock };
  }
  const sharedCells = cellsByBlock[0].filter((cell) => (
    cellsByBlock.every((cells) => cells.some((candidate) => candidate.cellId === cell.cellId))
  ));
  return { sharedCells, cellsByBlock };
}

function selectConservativeSharedCell(groupBlocks, tableCells) {
  const { sharedCells, cellsByBlock } = intersectSharedCells(groupBlocks, tableCells);
  const fourWallSharedCells = sharedCells.filter((cell) => Number(cell?.walls) === 4);
  if (fourWallSharedCells.length === 0) {
    return null;
  }
  const ordered = [...fourWallSharedCells].sort((left, right) => (
    cellArea(left) - cellArea(right)
    || Number(left.x1) - Number(right.x1)
    || Number(left.y1) - Number(right.y1)
  ));
  const chosen = ordered[0];
  const chosenArea = cellArea(chosen);
  for (const cells of cellsByBlock) {
    const hasSmallerNonSharedCell = cells.some((cell) => (
      String(cell.cellId || '') !== String(chosen.cellId || '')
      && cellArea(cell) < (chosenArea - 1)
    ));
    if (hasSmallerNonSharedCell) {
      return null;
    }
  }
  return chosen;
}

function nextMergedBlockId(pageId, usedIds, startIndex = 1) {
  let index = Math.max(1, Number(startIndex) || 1);
  while (usedIds.has(`p${pageId}_m${index}`)) {
    index += 1;
  }
  return {
    blockId: `p${pageId}_m${index}`,
    nextIndex: index + 1,
  };
}

function buildMergedLayoutBlock({
  pageId,
  blockId,
  groupBlocks,
  anchorBlock,
}) {
  return {
    ...anchorBlock,
    block_id: blockId,
    page_id: Number(pageId),
    type: String(anchorBlock?.type || 'text_line'),
    bbox: unionBBox(groupBlocks, 'bbox'),
    text: mergeSourceTexts(groupBlocks),
    reading_order: Number(anchorBlock?.reading_order || 1),
    source: 'continuation_merge',
    confidence: Math.min(
      ...groupBlocks.map((block) => {
        const value = Number(block?.confidence);
        return Number.isFinite(value) ? value : 0.98;
      }),
      0.98,
    ),
    flattened_line_breaks: false,
    original_text: null,
    text_tightness: String(anchorBlock?.text_tightness || ''),
    source_text_orientation: String(anchorBlock?.source_text_orientation || 'horizontal'),
    source_line_bbox: unionBBox(groupBlocks.map((block) => ({
      source_line_bbox: Array.isArray(block?.source_line_bbox) ? block.source_line_bbox : block?.bbox,
    })), 'source_line_bbox'),
    source_bottom_inset_ratio: Number.isFinite(Number(anchorBlock?.source_bottom_inset_ratio))
      ? Number(anchorBlock.source_bottom_inset_ratio)
      : 0,
    mixed_bidi_reconstructed: groupBlocks.some((block) => Boolean(block?.mixed_bidi_reconstructed)),
    merged_from_block_ids: groupBlocks.map((block) => String(block?.block_id || '')),
    synthetic_merge: true,
  };
}

function renumberReadingOrder(blocks) {
  return blocks.map((block, index) => ({
    ...block,
    reading_order: index + 1,
  }));
}

function collectEligiblePairMerges(layout, {
  horizontalBarriers = [],
  verticalBarriers = [],
} = {}) {
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];
  if (blocks.length < 2) {
    return [];
  }
  const stylesById = new Map((layout?.styles || []).map((style) => [String(style?.style_id || ''), style]));
  const detectionBlocks = blocks.map((block) => buildDetectionBlock(block, stylesById.get(String(block?.style_id || '')) || null));
  const groups = detectContinuationGroups(detectionBlocks, { horizontalBarriers, verticalBarriers });
  if (groups.length === 0) {
    return [];
  }
  const pageWidth = Number(layout?.page_size_pt?.[0] || 0);
  const pageHeight = Number(layout?.page_size_pt?.[1] || 0);
  const tableCells = detectTableCells(horizontalBarriers, verticalBarriers, pageWidth, pageHeight);
  const blocksById = new Map(blocks.map((block) => [String(block?.block_id || ''), block]));
  const eligible = [];

  for (const group of groups) {
    if (!Array.isArray(group?.blockIds) || group.blockIds.length !== 2) {
      continue;
    }
    const groupBlocks = group.blockIds
      .map((blockId) => blocksById.get(String(blockId)))
      .filter(Boolean);
    if (groupBlocks.length !== 2) {
      continue;
    }
    if (!groupBlocks.every((block) => String(block?.type || '') === 'text_line')) {
      continue;
    }
    const [anchorBlock, tailBlock] = groupBlocks;
    const anchorStyle = stylesById.get(String(anchorBlock?.style_id || '')) || null;
    const tailStyle = stylesById.get(String(tailBlock?.style_id || '')) || null;
    if (!anchorStyle || !tailStyle) {
      continue;
    }
    if (String(anchorBlock?.style_id || '') !== String(tailBlock?.style_id || '')) {
      continue;
    }
    if (
      !sameStyleFamily(anchorStyle, tailStyle)
      || !sameStyleWeight(anchorStyle, tailStyle)
      || !sameFontSize(anchorStyle, tailStyle)
    ) {
      continue;
    }
    const sharedCell = selectConservativeSharedCell(groupBlocks, tableCells);
    if (!sharedCell) {
      continue;
    }
    eligible.push({
      blockIds: groupBlocks.map((block) => String(block.block_id || '')),
      groupBlocks,
      anchorBlock,
      sharedCell,
    });
  }

  return eligible;
}

export function mergeContinuationPairsInLayout(layout, {
  horizontalBarriers = [],
  verticalBarriers = [],
} = {}) {
  const nextLayout = cloneLayout(layout || {});
  const orderedBlocks = [...(nextLayout.blocks || [])].sort((left, right) => (
    Number(left?.reading_order || 0) - Number(right?.reading_order || 0)
  ));
  nextLayout.blocks = orderedBlocks;
  const eligibleMerges = collectEligiblePairMerges(nextLayout, {
    horizontalBarriers,
    verticalBarriers,
  });
  if (eligibleMerges.length === 0) {
    return nextLayout;
  }

  const mergeByLeadBlockId = new Map();
  const removedBlockIds = new Set();
  const usedIds = new Set(orderedBlocks.map((block) => String(block?.block_id || '')));
  let nextMergedIndex = 1;
  for (const merge of eligibleMerges) {
    if (merge.blockIds.some((blockId) => removedBlockIds.has(blockId))) {
      continue;
    }
    const { blockId, nextIndex } = nextMergedBlockId(nextLayout.page_id, usedIds, nextMergedIndex);
    nextMergedIndex = nextIndex;
    usedIds.add(blockId);
    mergeByLeadBlockId.set(String(merge.anchorBlock?.block_id || ''), {
      ...merge,
      mergedBlockId: blockId,
    });
    for (const blockIdValue of merge.blockIds) {
      removedBlockIds.add(String(blockIdValue));
    }
  }

  if (mergeByLeadBlockId.size === 0) {
    return nextLayout;
  }

  const mergedBlocks = [];
  for (const block of orderedBlocks) {
    const blockId = String(block?.block_id || '');
    const merge = mergeByLeadBlockId.get(blockId);
    if (merge) {
      mergedBlocks.push(buildMergedLayoutBlock({
        pageId: nextLayout.page_id,
        blockId: merge.mergedBlockId,
        groupBlocks: merge.groupBlocks,
        anchorBlock: merge.anchorBlock,
      }));
      continue;
    }
    if (removedBlockIds.has(blockId)) {
      continue;
    }
    mergedBlocks.push(block);
  }

  nextLayout.blocks = renumberReadingOrder(mergedBlocks);
  return nextLayout;
}
