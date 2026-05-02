import { validBBox } from './browserTextDetection.js';

const MIN_VERTICAL_GAP_PT = 0.5;
const MAX_VERTICAL_GAP_HEIGHT_RATIO = 1.15;
const MAX_ABSOLUTE_VERTICAL_GAP_PT = 18;
const MIN_HEIGHT_RATIO = 0.78;
const MAX_HEIGHT_RATIO = 1.28;
const MIN_HORIZONTAL_OVERLAP_RATIO = 0.45;
const MAX_EDGE_DELTA_HEIGHT_RATIO = 0.75;
const MAX_CENTER_DELTA_HEIGHT_RATIO = 0.6;

function rectWidth(bbox) {
  return Math.max(0, Number(bbox?.[2] || 0) - Number(bbox?.[0] || 0));
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox?.[3] || 0) - Number(bbox?.[1] || 0));
}

function rectCenterX(bbox) {
  return (Number(bbox?.[0] || 0) + Number(bbox?.[2] || 0)) / 2;
}

function verticalGap(top, bottom) {
  return Number(bottom?.bbox?.[1] || 0) - Number(top?.bbox?.[3] || 0);
}

function horizontalOverlapRatio(leftBBox, rightBBox) {
  const overlap = Math.max(0, Math.min(Number(leftBBox[2]), Number(rightBBox[2])) - Math.max(Number(leftBBox[0]), Number(rightBBox[0])));
  const minWidth = Math.min(rectWidth(leftBBox), rectWidth(rightBBox));
  if (minWidth <= 0) {
    return 0;
  }
  return overlap / minWidth;
}

function bboxesIntersect(leftBBox, rightBBox) {
  return !(
    Number(leftBBox?.[2] || 0) <= Number(rightBBox?.[0] || 0)
    || Number(leftBBox?.[0] || 0) >= Number(rightBBox?.[2] || 0)
    || Number(leftBBox?.[3] || 0) <= Number(rightBBox?.[1] || 0)
    || Number(leftBBox?.[1] || 0) >= Number(rightBBox?.[3] || 0)
  );
}

function unionBBoxes(bboxes) {
  return [
    Math.min(...bboxes.map((bbox) => Number(bbox[0]))),
    Math.min(...bboxes.map((bbox) => Number(bbox[1]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[2]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[3]))),
  ];
}

function tokenCount(text) {
  return String(text || '').trim().split(/\s+/u).filter(Boolean).length;
}

function digitLikeRatio(text) {
  const sample = String(text || '').trim();
  if (!sample) {
    return 1;
  }
  let digitLike = 0;
  let visible = 0;
  for (const char of sample) {
    if (!/\S/u.test(char)) {
      continue;
    }
    visible += 1;
    if (/[\d.,/%\-:()]/u.test(char)) {
      digitLike += 1;
    }
  }
  if (visible === 0) {
    return 1;
  }
  return digitLike / visible;
}

function lineLooksStructural(text) {
  const sample = String(text || '').trim();
  if (!sample) {
    return true;
  }
  if (sample.length <= 1) {
    return true;
  }
  if (sample.endsWith(':') && tokenCount(sample) <= 3) {
    return true;
  }
  if (tokenCount(sample) <= 1 && sample.length < 8) {
    return true;
  }
  if (digitLikeRatio(sample) >= 0.7 && tokenCount(sample) <= 4) {
    return true;
  }
  return false;
}

function sameSourceBlock(left, right) {
  const leftBlocks = new Set(
    Array.isArray(left?.mergedSourceBlockIndexes)
      ? left.mergedSourceBlockIndexes.filter(Number.isFinite)
      : [left?.sourceBlockIndex].filter(Number.isFinite),
  );
  const rightBlocks = new Set(
    Array.isArray(right?.mergedSourceBlockIndexes)
      ? right.mergedSourceBlockIndexes.filter(Number.isFinite)
      : [right?.sourceBlockIndex].filter(Number.isFinite),
  );
  if (leftBlocks.size !== 1 || rightBlocks.size !== 1) {
    return false;
  }
  return [...leftBlocks][0] === [...rightBlocks][0];
}

function compatibleHeights(left, right) {
  const leftHeight = Math.max(1, rectHeight(left?.bbox));
  const rightHeight = Math.max(1, rectHeight(right?.bbox));
  const ratio = Math.min(leftHeight, rightHeight) / Math.max(leftHeight, rightHeight);
  return ratio >= MIN_HEIGHT_RATIO && ratio <= MAX_HEIGHT_RATIO;
}

function sameLane(left, right) {
  const leftBBox = left?.bbox || [0, 0, 0, 0];
  const rightBBox = right?.bbox || [0, 0, 0, 0];
  const overlapRatio = horizontalOverlapRatio(leftBBox, rightBBox);
  if (overlapRatio >= MIN_HORIZONTAL_OVERLAP_RATIO) {
    return true;
  }
  const referenceHeight = Math.max(1, Math.min(rectHeight(leftBBox), rectHeight(rightBBox)));
  const leftEdgeDelta = Math.abs(Number(leftBBox[0]) - Number(rightBBox[0]));
  const rightEdgeDelta = Math.abs(Number(leftBBox[2]) - Number(rightBBox[2]));
  const centerDelta = Math.abs(rectCenterX(leftBBox) - rectCenterX(rightBBox));
  if (leftEdgeDelta <= (referenceHeight * MAX_EDGE_DELTA_HEIGHT_RATIO)) {
    return true;
  }
  if (rightEdgeDelta <= (referenceHeight * MAX_EDGE_DELTA_HEIGHT_RATIO)) {
    return true;
  }
  if (centerDelta <= (referenceHeight * MAX_CENTER_DELTA_HEIGHT_RATIO)) {
    return true;
  }
  return false;
}

function intersectsAnyTableRegion(bbox, tableRegions) {
  return (tableRegions || []).some((region) => validBBox(region) && bboxesIntersect(bbox, region));
}

function shouldMergePair(top, bottom, { tableRegions = [] } = {}) {
  if (!validBBox(top?.bbox) || !validBBox(bottom?.bbox)) {
    return false;
  }
  if (!sameSourceBlock(top, bottom)) {
    return false;
  }
  if (!compatibleHeights(top, bottom)) {
    return false;
  }
  const gap = verticalGap(top, bottom);
  if (gap < MIN_VERTICAL_GAP_PT) {
    return false;
  }
  const minHeight = Math.max(1, Math.min(rectHeight(top?.bbox), rectHeight(bottom?.bbox)));
  const gapThreshold = Math.min(MAX_ABSOLUTE_VERTICAL_GAP_PT, Math.max(2.5, minHeight * MAX_VERTICAL_GAP_HEIGHT_RATIO));
  if (gap > gapThreshold) {
    return false;
  }
  if (!sameLane(top, bottom)) {
    return false;
  }
  if (intersectsAnyTableRegion(unionBBoxes([top.bbox, bottom.bbox]), tableRegions)) {
    return false;
  }
  if (lineLooksStructural(top?.text) || lineLooksStructural(bottom?.text)) {
    return false;
  }
  return true;
}

function mergeText(top, bottom) {
  const topText = String(top?.text || '').trim();
  const bottomText = String(bottom?.text || '').trim();
  if (!topText) {
    return bottomText;
  }
  if (!bottomText) {
    return topText;
  }
  return `${topText}\n${bottomText}`.trim();
}

function mergePair(top, bottom) {
  const verticalMergedElementIds = [
    ...(Array.isArray(top?.verticalMergedElementIds)
      ? top.verticalMergedElementIds
      : [String(top?.debugElementId || '')].filter(Boolean)),
    ...(Array.isArray(bottom?.verticalMergedElementIds)
      ? bottom.verticalMergedElementIds
      : [String(bottom?.debugElementId || '')].filter(Boolean)),
  ];
  const mergedSourceBlockIndexes = [
    ...(Array.isArray(top?.mergedSourceBlockIndexes)
      ? top.mergedSourceBlockIndexes
      : [top?.sourceBlockIndex].filter(Number.isFinite)),
    ...(Array.isArray(bottom?.mergedSourceBlockIndexes)
      ? bottom.mergedSourceBlockIndexes
      : [bottom?.sourceBlockIndex].filter(Number.isFinite)),
  ];
  const mergedElementIds = [
    ...(Array.isArray(top?.mergedElementIds) ? top.mergedElementIds : []),
    ...(Array.isArray(bottom?.mergedElementIds) ? bottom.mergedElementIds : []),
  ];
  const mergedSourceIds = [
    ...(Array.isArray(top?.mergedSourceIds) ? top.mergedSourceIds : []),
    ...(Array.isArray(bottom?.mergedSourceIds) ? bottom.mergedSourceIds : []),
  ];
  const uniqueSourceBlockIndexes = [...new Set(mergedSourceBlockIndexes)];
  return {
    ...top,
    bbox: unionBBoxes([top.bbox, bottom.bbox]),
    text: mergeText(top, bottom),
    rawText: mergeText(top?.rawText, bottom?.rawText),
    chars: [...(top?.chars || []), ...(bottom?.chars || [])],
    sourceBlockIndex: uniqueSourceBlockIndexes.length === 1 ? uniqueSourceBlockIndexes[0] : null,
    mergedSourceBlockIndexes: uniqueSourceBlockIndexes,
    mergedElementIds: [...new Set(mergedElementIds)],
    mergedSourceIds: [...new Set(mergedSourceIds)],
    verticalMergedElementIds: [...new Set(verticalMergedElementIds)],
  };
}

function sortByVisualOrder(elements) {
  return [...(elements || [])].sort((left, right) => (
    (Number(left?.bbox?.[1] || 0) - Number(right?.bbox?.[1] || 0))
    || (Number(left?.bbox?.[0] || 0) - Number(right?.bbox?.[0] || 0))
  ));
}

export function mergeDetectedTextElementsVertically(elements, { tableRegions = [] } = {}) {
  const ordered = sortByVisualOrder((elements || []).filter((element) => validBBox(element?.bbox)));
  const merged = [];
  for (const candidate of ordered) {
    const previous = merged[merged.length - 1];
    const normalized = {
      ...candidate,
      bbox: candidate.bbox.map((value) => Number(value)),
      verticalMergedElementIds: Array.isArray(candidate?.verticalMergedElementIds)
        ? [...candidate.verticalMergedElementIds]
        : [String(candidate?.debugElementId || '')].filter(Boolean),
    };
    if (!previous) {
      merged.push(normalized);
      continue;
    }
    if (shouldMergePair(previous, normalized, { tableRegions })) {
      merged[merged.length - 1] = mergePair(previous, normalized);
      continue;
    }
    merged.push(normalized);
  }
  return merged;
}

function sourceBlockKey(element) {
  const mergedSourceBlockIndexes = Array.isArray(element?.mergedSourceBlockIndexes)
    ? element.mergedSourceBlockIndexes.filter(Number.isFinite)
    : [element?.sourceBlockIndex].filter(Number.isFinite);
  if (mergedSourceBlockIndexes.length !== 1) {
    return null;
  }
  return String(mergedSourceBlockIndexes[0]);
}

function mergeElementsInOrder(elements) {
  const ordered = sortByVisualOrder(elements);
  if (ordered.length === 0) {
    return null;
  }
  return ordered.slice(1).reduce((accumulator, current) => mergePair(accumulator, current), {
    ...ordered[0],
    bbox: ordered[0].bbox.map((value) => Number(value)),
    verticalMergedElementIds: Array.isArray(ordered[0]?.verticalMergedElementIds)
      ? [...ordered[0].verticalMergedElementIds]
      : [String(ordered[0]?.debugElementId || '')].filter(Boolean),
  });
}

export function mergeDetectedTextElementsBySourceBlock(elements) {
  const groupedBySourceBlock = new Map();
  for (const element of sortByVisualOrder((elements || []).filter((candidate) => validBBox(candidate?.bbox)))) {
    const key = sourceBlockKey(element);
    if (!key) {
      continue;
    }
    if (!groupedBySourceBlock.has(key)) {
      groupedBySourceBlock.set(key, []);
    }
    groupedBySourceBlock.get(key).push({
      ...element,
      bbox: element.bbox.map((value) => Number(value)),
      verticalMergedElementIds: Array.isArray(element?.verticalMergedElementIds)
        ? [...element.verticalMergedElementIds]
        : [String(element?.debugElementId || '')].filter(Boolean),
    });
  }
  return [...groupedBySourceBlock.values()]
    .map((group) => mergeElementsInOrder(group))
    .filter((group) => group && Array.isArray(group.verticalMergedElementIds) && group.verticalMergedElementIds.length > 1)
    .sort((left, right) => (
      (Number(left?.bbox?.[1] || 0) - Number(right?.bbox?.[1] || 0))
      || (Number(left?.bbox?.[0] || 0) - Number(right?.bbox?.[0] || 0))
    ));
}
