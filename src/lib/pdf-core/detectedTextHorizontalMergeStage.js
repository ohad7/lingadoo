import {
  DETECTED_TEXT_SPLIT_REASON,
  TEXT_ELEMENT_RENDER_KIND,
  validBBox,
} from './browserTextDetection.js';

const MIN_VERTICAL_OVERLAP_RATIO = 0.82;
const MAX_CENTER_Y_DELTA_RATIO = 0.18;
const MIN_HEIGHT_RATIO = 0.8;
const MAX_HEIGHT_RATIO = 1.25;
const MAX_ABSOLUTE_GAP_PT = 9;
const MAX_GAP_HEIGHT_RATIO = 0.45;
const MAX_GAP_CHAR_WIDTH_RATIO = 1.35;
const RTL_CHAR_RE = /[\u0590-\u08FF]/u;
const LTR_CHAR_RE = /[A-Za-z]/u;

function rectWidth(bbox) {
  return Math.max(0, Number(bbox?.[2] || 0) - Number(bbox?.[0] || 0));
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox?.[3] || 0) - Number(bbox?.[1] || 0));
}

function centerY(bbox) {
  return (Number(bbox?.[1] || 0) + Number(bbox?.[3] || 0)) / 2;
}

function verticalOverlapRatio(left, right) {
  const overlap = Math.max(0, Math.min(Number(left[3]), Number(right[3])) - Math.max(Number(left[1]), Number(right[1])));
  const minHeight = Math.min(rectHeight(left), rectHeight(right));
  if (minHeight <= 0) {
    return 0;
  }
  return overlap / minHeight;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianNonSpaceCharWidth(element) {
  const widths = (element?.chars || [])
    .filter((char) => String(char?.c || '').trim().length > 0 && validBBox(char?.bbox))
    .map((char) => rectWidth(char.bbox))
    .filter((width) => width > 0);
  return median(widths);
}

function sortByVisualOrder(elements) {
  return [...(elements || [])].sort((left, right) => (
    (centerY(left.bbox) - centerY(right.bbox))
    || (Number(left?.bbox?.[0] || 0) - Number(right?.bbox?.[0] || 0))
  ));
}

function sameVisualRow(left, right) {
  const overlapRatio = verticalOverlapRatio(left.bbox, right.bbox);
  if (overlapRatio < MIN_VERTICAL_OVERLAP_RATIO) {
    return false;
  }
  const minHeight = Math.min(rectHeight(left.bbox), rectHeight(right.bbox));
  if (minHeight <= 0) {
    return false;
  }
  const deltaY = Math.abs(centerY(left.bbox) - centerY(right.bbox));
  if (deltaY > (minHeight * MAX_CENTER_Y_DELTA_RATIO)) {
    return false;
  }
  const leftHeight = Math.max(1, rectHeight(left.bbox));
  const rightHeight = Math.max(1, rectHeight(right.bbox));
  const heightRatio = Math.min(leftHeight, rightHeight) / Math.max(leftHeight, rightHeight);
  return heightRatio >= MIN_HEIGHT_RATIO && heightRatio <= MAX_HEIGHT_RATIO;
}

function shouldMergePair(left, right) {
  if (!sameVisualRow(left, right)) {
    return false;
  }
  const gap = Number(right?.bbox?.[0] || 0) - Number(left?.bbox?.[2] || 0);
  if (gap < 0) {
    return false;
  }
  const charWidth = Math.max(
    1.5,
    median([medianNonSpaceCharWidth(left), medianNonSpaceCharWidth(right)].filter((value) => value > 0)),
  );
  const minHeight = Math.max(1, Math.min(rectHeight(left.bbox), rectHeight(right.bbox)));
  const gapThreshold = Math.min(
    MAX_ABSOLUTE_GAP_PT,
    Math.max(2.5, charWidth * MAX_GAP_CHAR_WIDTH_RATIO, minHeight * MAX_GAP_HEIGHT_RATIO),
  );
  if (gap > gapThreshold) {
    return false;
  }
  const blockedReasons = new Set([
    DETECTED_TEXT_SPLIT_REASON.LARGE_VISUAL_GAP,
    DETECTED_TEXT_SPLIT_REASON.LONG_WHITESPACE_RUN,
    DETECTED_TEXT_SPLIT_REASON.WIDE_SPACE_GLYPH,
  ]);
  if (blockedReasons.has(String(left?.splitReason || '')) || blockedReasons.has(String(right?.splitReason || ''))) {
    return false;
  }
  return true;
}

function unionBBoxes(bboxes) {
  return [
    Math.min(...bboxes.map((bbox) => Number(bbox[0]))),
    Math.min(...bboxes.map((bbox) => Number(bbox[1]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[2]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[3]))),
  ];
}

function averageFinite(values) {
  const finite = (values || []).filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return 0;
  }
  return finite.reduce((sum, value) => sum + Number(value), 0) / finite.length;
}

function inferTextDirection(text) {
  let rtl = 0;
  let ltr = 0;
  for (const char of String(text || '')) {
    if (RTL_CHAR_RE.test(char)) {
      rtl += 1;
    } else if (LTR_CHAR_RE.test(char)) {
      ltr += 1;
    }
  }
  if (rtl === 0 && ltr === 0) {
    return 'neutral';
  }
  return rtl > ltr ? 'rtl' : 'ltr';
}

function mergeText(left, right) {
  const leftText = String(left?.text || '').trim();
  const rightText = String(right?.text || '').trim();
  if (!leftText) {
    return rightText;
  }
  if (!rightText) {
    return leftText;
  }
  const mergedDirection = inferTextDirection(`${leftText} ${rightText}`);
  if (mergedDirection === 'rtl') {
    return `${rightText} ${leftText}`.trim();
  }
  return `${leftText} ${rightText}`.trim();
}

function mergePair(left, right) {
  const mergedSourceBlockIndexes = [
    ...(Array.isArray(left.mergedSourceBlockIndexes)
      ? left.mergedSourceBlockIndexes
      : [left.sourceBlockIndex].filter(Number.isFinite)),
    ...(Array.isArray(right.mergedSourceBlockIndexes)
      ? right.mergedSourceBlockIndexes
      : [right.sourceBlockIndex].filter(Number.isFinite)),
  ];
  const uniqueSourceBlockIndexes = [...new Set(mergedSourceBlockIndexes)];
  const leftRenderKind = String(left?.renderKind || TEXT_ELEMENT_RENDER_KIND.TIGHT);
  const rightRenderKind = String(right?.renderKind || TEXT_ELEMENT_RENDER_KIND.TIGHT);
  const mergedRenderKind = (
    leftRenderKind === TEXT_ELEMENT_RENDER_KIND.TIGHT
    && rightRenderKind === TEXT_ELEMENT_RENDER_KIND.TIGHT
  )
    ? TEXT_ELEMENT_RENDER_KIND.TIGHT
    : TEXT_ELEMENT_RENDER_KIND.SPLIT_TIGHT;
  return {
    ...left,
    bbox: unionBBoxes([left.bbox, right.bbox]),
    text: mergeText(left, right),
    rawText: mergeText(left.rawText, right.rawText),
    chars: [...(left.chars || []), ...(right.chars || [])],
    sourceLineId: left.sourceLineId === right.sourceLineId ? left.sourceLineId : null,
    sourceLineBBox: null,
    sourceBottomInsetRatio: averageFinite([
      Number(left?.sourceBottomInsetRatio),
      Number(right?.sourceBottomInsetRatio),
    ]),
    sourceBlockIndex: uniqueSourceBlockIndexes.length === 1 ? uniqueSourceBlockIndexes[0] : null,
    splitReason: null,
    mergedElementIds: [
      ...(Array.isArray(left.mergedElementIds) ? left.mergedElementIds : [String(left.debugElementId || '')].filter(Boolean)),
      ...(Array.isArray(right.mergedElementIds) ? right.mergedElementIds : [String(right.debugElementId || '')].filter(Boolean)),
    ],
    mergedSourceIds: [
      ...(Array.isArray(left.mergedSourceIds) ? left.mergedSourceIds : [String(left.sourceLineId || left.text || '')]),
      ...(Array.isArray(right.mergedSourceIds) ? right.mergedSourceIds : [String(right.sourceLineId || right.text || '')]),
    ],
    mergedSourceBlockIndexes: uniqueSourceBlockIndexes,
    renderKind: mergedRenderKind,
    tightness: 'tight',
  };
}

export function mergeDetectedTextElementsHorizontally(elements) {
  const ordered = sortByVisualOrder((elements || []).filter((element) => validBBox(element?.bbox)));
  const merged = [];
  for (const candidate of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({
        ...candidate,
        bbox: candidate.bbox.map((value) => Number(value)),
        mergedElementIds: Array.isArray(candidate?.mergedElementIds)
          ? [...candidate.mergedElementIds]
          : [String(candidate?.debugElementId || '')].filter(Boolean),
        mergedSourceBlockIndexes: Array.isArray(candidate?.mergedSourceBlockIndexes)
          ? [...candidate.mergedSourceBlockIndexes]
          : [candidate?.sourceBlockIndex].filter(Number.isFinite),
      });
      continue;
    }
    if (shouldMergePair(previous, candidate)) {
      merged[merged.length - 1] = mergePair(previous, candidate);
      continue;
    }
    merged.push({
      ...candidate,
      bbox: candidate.bbox.map((value) => Number(value)),
      mergedElementIds: Array.isArray(candidate?.mergedElementIds)
        ? [...candidate.mergedElementIds]
        : [String(candidate?.debugElementId || '')].filter(Boolean),
      mergedSourceBlockIndexes: Array.isArray(candidate?.mergedSourceBlockIndexes)
        ? [...candidate.mergedSourceBlockIndexes]
        : [candidate?.sourceBlockIndex].filter(Number.isFinite),
    });
  }
  return merged;
}
