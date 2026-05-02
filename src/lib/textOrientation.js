export const TEXT_ORIENTATION = {
  HORIZONTAL: 'horizontal',
  VERTICAL_TTB: 'vertical_ttb',
};

const HORIZONTAL_TEXT_PADDING_PT = 1.0;
const VERTICAL_TEXT_PADDING_PT = 0.0;
const VERTICAL_TEXT_MIN_NON_WHITESPACE_CHARS = 3;
const VERTICAL_TEXT_MIN_ASPECT_RATIO = 3.0;
const VERTICAL_TEXT_AXIS_DOMINANCE_RATIO = 2.0;
const VERTICAL_TEXT_MIN_MONOTONIC_RATIO = 0.75;

function rectWidth(bbox) {
  return Math.max(0, Number(bbox?.[2]) - Number(bbox?.[0]));
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox?.[3]) - Number(bbox?.[1]));
}

function unionBBoxes(bboxes) {
  if (!Array.isArray(bboxes) || bboxes.length === 0) {
    return [0, 0, 0, 0];
  }
  return [
    Math.min(...bboxes.map((bbox) => Number(bbox?.[0]) || 0)),
    Math.min(...bboxes.map((bbox) => Number(bbox?.[1]) || 0)),
    Math.max(...bboxes.map((bbox) => Number(bbox?.[2]) || 0)),
    Math.max(...bboxes.map((bbox) => Number(bbox?.[3]) || 0)),
  ];
}

function nonWhitespaceChars(chars) {
  return (Array.isArray(chars) ? chars : []).filter((char) => String(char?.c || '').trim().length > 0);
}

function charCenter(char) {
  const bbox = Array.isArray(char?.bbox) ? char.bbox : [0, 0, 0, 0];
  return {
    x: (Number(bbox[0]) + Number(bbox[2])) / 2,
    y: (Number(bbox[1]) + Number(bbox[3])) / 2,
  };
}

export function resolveTextOrientation(value) {
  return String(value || '') === TEXT_ORIENTATION.VERTICAL_TTB
    ? TEXT_ORIENTATION.VERTICAL_TTB
    : TEXT_ORIENTATION.HORIZONTAL;
}

export function isVerticalTextOrientation(value) {
  return resolveTextOrientation(value) === TEXT_ORIENTATION.VERTICAL_TTB;
}

export function resolveTextPaddingPt(value) {
  return isVerticalTextOrientation(value)
    ? VERTICAL_TEXT_PADDING_PT
    : HORIZONTAL_TEXT_PADDING_PT;
}

export function resolveTextRenderRotationDeg(orientation, mirrorEnabled = false) {
  if (!isVerticalTextOrientation(orientation)) {
    return 0;
  }
  return mirrorEnabled ? -90 : 90;
}

export function detectTextOrientationFromChars(chars) {
  const visibleChars = nonWhitespaceChars(chars);
  if (visibleChars.length < VERTICAL_TEXT_MIN_NON_WHITESPACE_CHARS) {
    return TEXT_ORIENTATION.HORIZONTAL;
  }
  const bbox = unionBBoxes(visibleChars.map((char) => char.bbox));
  const width = rectWidth(bbox);
  const height = rectHeight(bbox);
  if (!(width > 0 && height > 0) || (height / width) < VERTICAL_TEXT_MIN_ASPECT_RATIO) {
    return TEXT_ORIENTATION.HORIZONTAL;
  }

  const centers = visibleChars.map(charCenter);
  const xSpread = Math.max(...centers.map((point) => point.x)) - Math.min(...centers.map((point) => point.x));
  const ySpread = Math.max(...centers.map((point) => point.y)) - Math.min(...centers.map((point) => point.y));
  if (ySpread < xSpread * VERTICAL_TEXT_AXIS_DOMINANCE_RATIO) {
    return TEXT_ORIENTATION.HORIZONTAL;
  }

  let totalAbsDx = 0;
  let totalAbsDy = 0;
  let forwardCount = 0;
  let backwardCount = 0;
  let pairCount = 0;
  for (let index = 0; index < centers.length - 1; index += 1) {
    const current = centers[index];
    const next = centers[index + 1];
    const deltaX = Number(next.x) - Number(current.x);
    const deltaY = Number(next.y) - Number(current.y);
    totalAbsDx += Math.abs(deltaX);
    totalAbsDy += Math.abs(deltaY);
    if (deltaY >= -0.01) {
      forwardCount += 1;
    }
    if (deltaY <= 0.01) {
      backwardCount += 1;
    }
    pairCount += 1;
  }
  if (pairCount === 0) {
    return TEXT_ORIENTATION.HORIZONTAL;
  }
  if (totalAbsDy < totalAbsDx * VERTICAL_TEXT_AXIS_DOMINANCE_RATIO) {
    return TEXT_ORIENTATION.HORIZONTAL;
  }
  if ((Math.max(forwardCount, backwardCount) / pairCount) < VERTICAL_TEXT_MIN_MONOTONIC_RATIO) {
    return TEXT_ORIENTATION.HORIZONTAL;
  }
  return TEXT_ORIENTATION.VERTICAL_TTB;
}

export function resolveLogicalTextFrame(bbox, {
  orientation = TEXT_ORIENTATION.HORIZONTAL,
  paddingPt = resolveTextPaddingPt(orientation),
} = {}) {
  const physicalWidth = rectWidth(bbox);
  const physicalHeight = rectHeight(bbox);
  const logicalWidth = isVerticalTextOrientation(orientation) ? physicalHeight : physicalWidth;
  const logicalHeight = isVerticalTextOrientation(orientation) ? physicalWidth : physicalHeight;
  return {
    physicalWidth,
    physicalHeight,
    logicalWidth,
    logicalHeight,
    contentWidth: Math.max(1, logicalWidth - (paddingPt * 2)),
    contentHeight: Math.max(1, logicalHeight - (paddingPt * 2)),
    paddingPt,
  };
}

export function mapLogicalRectToPhysicalRect(logicalRect, {
  physicalWidth,
  physicalHeight,
  rotationDeg = 0,
} = {}) {
  const rect = Array.isArray(logicalRect) ? logicalRect.map((value) => Number(value) || 0) : [0, 0, 0, 0];
  if (Number(rotationDeg) === 90) {
    return [
      Number(physicalWidth) - rect[3],
      rect[0],
      Number(physicalWidth) - rect[1],
      rect[2],
    ];
  }
  if (Number(rotationDeg) === -90) {
    return [
      rect[1],
      Number(physicalHeight) - rect[2],
      rect[3],
      Number(physicalHeight) - rect[0],
    ];
  }
  return rect;
}
