import { detectTextOrientationFromChars } from '../textOrientation.js';

const STRUCTURED_TEXT_LINE_OPTIONS = 'preserve-whitespace,collect-styles';
const LONG_SPACE_RUN_THRESHOLD = 3;
const LARGE_VISUAL_GAP_PT_THRESHOLD = 12;
const LARGE_VISUAL_GAP_FACTOR = 2.5;
const WIDE_SPACE_GLYPH_PT_THRESHOLD = 10;
const WIDE_SPACE_GLYPH_FACTOR = 2.25;
const RTL_CHAR_RE = /[\u0590-\u08FF]/u;
const LTR_CHAR_RE = /[A-Za-z]/u;
const DIGIT_CHAR_RE = /[0-9]/u;
const NO_SPACE_BEFORE_RE = /^[.,;:!?%)\]}]/u;
const SINGLE_RTL_PREFIX_RE = /(?:^|\s)[\u0590-\u05FF]$/u;

export const TEXT_ELEMENT_TIGHTNESS = {
  TIGHT: 'tight',
  NON_TIGHT: 'non-tight',
  EMPTY: 'empty',
};

export const TEXT_ELEMENT_RENDER_KIND = {
  TIGHT: 'tight',
  SPLIT_TIGHT: 'split-tight',
  NON_TIGHT: 'non-tight',
  EMPTY: 'empty',
};

export const DETECTED_TEXT_SPLIT_REASON = {
  LARGE_VISUAL_GAP: 'large-visual-gap',
  LONG_WHITESPACE_RUN: 'long-whitespace-run',
  WIDE_SPACE_GLYPH: 'wide-space-glyph',
};

function rectWidth(bbox) {
  return Math.max(0, Number(bbox[2]) - Number(bbox[0]));
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

export function validBBox(bbox) {
  return Array.isArray(bbox) && bbox.length >= 4 && rectWidth(bbox) > 0 && rectHeight(bbox) > 0;
}

function normalizeStructuredTextBBox(bbox) {
  if (Array.isArray(bbox) && bbox.length >= 4) {
    return bbox.slice(0, 4).map((value) => Number(value) || 0);
  }
  if (!bbox || typeof bbox !== 'object') {
    return null;
  }
  if ('x0' in bbox && 'y0' in bbox && 'x1' in bbox && 'y1' in bbox) {
    return [
      Number(bbox.x0) || 0,
      Number(bbox.y0) || 0,
      Number(bbox.x1) || 0,
      Number(bbox.y1) || 0,
    ];
  }
  if ('x' in bbox && 'y' in bbox && 'w' in bbox && 'h' in bbox) {
    return [
      Number(bbox.x) || 0,
      Number(bbox.y) || 0,
      (Number(bbox.x) || 0) + (Number(bbox.w) || 0),
      (Number(bbox.y) || 0) + (Number(bbox.h) || 0),
    ];
  }
  return null;
}

function bboxFromQuad(quad) {
  if (Array.isArray(quad) && quad.length >= 8) {
    const xs = [quad[0], quad[2], quad[4], quad[6]].map((value) => Number(value) || 0);
    const ys = [quad[1], quad[3], quad[5], quad[7]].map((value) => Number(value) || 0);
    return [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
  }
  return normalizeStructuredTextBBox(quad);
}

function isWhitespaceChar(char) {
  return char === ' ' || char === '\t' || char === '\u00A0';
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/[ \t\u00A0]+/g, ' ').trim();
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

function sortCharsByVisualOrder(chars) {
  return [...(chars || [])].sort((left, right) => (
    (Number(left?.bbox?.[0] || 0) - Number(right?.bbox?.[0] || 0))
    || (Number(left?.bbox?.[1] || 0) - Number(right?.bbox?.[1] || 0))
    || (Number(left?.originalIndex || 0) - Number(right?.originalIndex || 0))
  ));
}

function sortCharsByOriginalOrder(chars) {
  return [...(chars || [])].sort((left, right) => (
    Number(left?.originalIndex || 0) - Number(right?.originalIndex || 0)
  ));
}

function trimEdgeWhitespaceChars(chars) {
  const orderedChars = sortCharsByOriginalOrder(chars);
  if (orderedChars.length === 0) {
    return [];
  }
  let start = 0;
  let end = orderedChars.length - 1;
  while (start <= end && isWhitespaceChar(orderedChars[start]?.c)) {
    start += 1;
  }
  while (end >= start && isWhitespaceChar(orderedChars[end]?.c)) {
    end -= 1;
  }
  if (start > end) {
    return [];
  }
  return orderedChars.slice(start, end + 1);
}

function unionBBoxes(bboxes) {
  if (!Array.isArray(bboxes) || bboxes.length === 0) {
    return [0, 0, 0, 0];
  }
  return [
    Math.min(...bboxes.map((bbox) => Number(bbox[0]) || 0)),
    Math.min(...bboxes.map((bbox) => Number(bbox[1]) || 0)),
    Math.max(...bboxes.map((bbox) => Number(bbox[2]) || 0)),
    Math.max(...bboxes.map((bbox) => Number(bbox[3]) || 0)),
  ];
}

function clampUnitRatio(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function bidiClassForChar(char) {
  if (RTL_CHAR_RE.test(char)) {
    return 'rtl';
  }
  if (LTR_CHAR_RE.test(char) || DIGIT_CHAR_RE.test(char)) {
    return 'ltr';
  }
  if (isWhitespaceChar(char)) {
    return 'space';
  }
  return 'neutral';
}

function inferLineStrongDirection(chars) {
  let rtlCount = 0;
  let ltrCount = 0;
  for (const char of chars || []) {
    const value = String(char?.c || '');
    if (RTL_CHAR_RE.test(value)) {
      rtlCount += 1;
    } else if (LTR_CHAR_RE.test(value)) {
      ltrCount += 1;
    }
  }
  if (rtlCount === 0 && ltrCount === 0) {
    return 'neutral';
  }
  return rtlCount >= ltrCount ? 'rtl' : 'ltr';
}

function buildBidiTokensFromChars(chars) {
  const orderedChars = sortCharsByOriginalOrder(chars);
  const tokens = [];
  let currentChars = [];
  let currentDirection = null;

  function finalizeToken() {
    if (currentChars.length === 0) {
      currentDirection = null;
      return;
    }
    const text = normalizeWhitespace(currentChars.map((char) => String(char?.c || '')).join(''));
    if (text) {
      tokens.push({
        text,
        bbox: unionBBoxes(currentChars.map((char) => char.bbox)),
        direction: currentDirection || inferLineStrongDirection(currentChars),
      });
    }
    currentChars = [];
    currentDirection = null;
  }

  for (const char of orderedChars) {
    const bidiClass = bidiClassForChar(String(char?.c || ''));
    if (bidiClass === 'space') {
      finalizeToken();
      continue;
    }
    if (
      currentChars.length > 0
      && bidiClass !== 'neutral'
      && currentDirection
      && bidiClass !== currentDirection
    ) {
      finalizeToken();
    }
    currentChars.push(char);
    if (!currentDirection && bidiClass !== 'neutral') {
      currentDirection = bidiClass;
    }
  }
  finalizeToken();
  return tokens;
}

function joinMixedBidiTokens(tokens) {
  const chunks = [];
  for (const tokenEntry of tokens || []) {
    const token = normalizeWhitespace(tokenEntry?.text || '');
    if (!token) {
      continue;
    }
    if (chunks.length === 0) {
      chunks.push(token);
      continue;
    }
    const previous = chunks[chunks.length - 1];
    const colonValueMatch = /^:([A-Za-z0-9@(+].*)$/u.exec(token);
    if (colonValueMatch && RTL_CHAR_RE.test(previous)) {
      chunks[chunks.length - 1] = `${previous}: ${colonValueMatch[1].trim()}`;
      continue;
    }
    if (SINGLE_RTL_PREFIX_RE.test(previous) && /[A-Za-z0-9]/u.test(token) && token.endsWith('-')) {
      chunks[chunks.length - 1] = `${previous}-${token.slice(0, -1)}`;
      continue;
    }
    if (NO_SPACE_BEFORE_RE.test(token)) {
      chunks[chunks.length - 1] = `${previous}${token}`;
      continue;
    }
    if (/[([{/]$/.test(previous) || previous.endsWith('-')) {
      chunks[chunks.length - 1] = `${previous}${token}`;
      continue;
    }
    if (previous.endsWith('.') && token.length <= 2) {
      chunks[chunks.length - 1] = `${previous}${token}`;
      continue;
    }
    chunks.push(token);
  }
  return normalizeWhitespace(chunks.join(' '));
}

function reconstructMixedBidiLineTextFromChars(chars, {
  sourceTextOrientation = 'horizontal',
} = {}) {
  const orderedChars = sortCharsByOriginalOrder(chars);
  const originalText = orderedChars.map((char) => String(char?.c || '')).join('');
  if (String(sourceTextOrientation || 'horizontal') !== 'horizontal') {
    return originalText;
  }
  const lineDirection = inferLineStrongDirection(orderedChars);
  if (lineDirection !== 'rtl') {
    return originalText;
  }
  const tokens = buildBidiTokensFromChars(orderedChars);
  const strongDirections = new Set(tokens.map((token) => token.direction).filter((direction) => direction === 'rtl' || direction === 'ltr'));
  if (!strongDirections.has('rtl') || !strongDirections.has('ltr')) {
    return originalText;
  }
  const orderedTokens = [...tokens].sort((left, right) => (
    Number(right?.bbox?.[0] || 0) - Number(left?.bbox?.[0] || 0)
  ));
  const reconstructed = joinMixedBidiTokens(orderedTokens);
  return reconstructed || originalText;
}

function computeLineVisualGapMetrics(lineChars) {
  const charsWithBBoxes = (lineChars || [])
    .filter((char) => validBBox(char?.bbox))
    .map((char) => ({
      c: String(char?.c || ''),
      bbox: char.bbox.map((value) => Number(value) || 0),
    }));
  if (charsWithBBoxes.length === 0) {
    return {
      maxGap: 0,
      maxSpaceWidth: 0,
      medianNonSpaceWidth: 0,
    };
  }
  const visualOrder = [...charsWithBBoxes].sort((left, right) => (
    (Number(left.bbox[0]) - Number(right.bbox[0]))
    || (Number(left.bbox[1]) - Number(right.bbox[1]))
  ));
  let maxGap = 0;
  for (let index = 0; index < visualOrder.length - 1; index += 1) {
    const current = visualOrder[index];
    const next = visualOrder[index + 1];
    maxGap = Math.max(maxGap, Number(next.bbox[0]) - Number(current.bbox[2]));
  }
  const nonSpaceWidths = charsWithBBoxes
    .filter((char) => !isWhitespaceChar(char.c))
    .map((char) => rectWidth(char.bbox))
    .filter((width) => width > 0);
  const spaceWidths = charsWithBBoxes
    .filter((char) => isWhitespaceChar(char.c))
    .map((char) => rectWidth(char.bbox))
    .filter((width) => width > 0);
  const fallbackWidths = charsWithBBoxes
    .map((char) => rectWidth(char.bbox))
    .filter((width) => width > 0);
  return {
    maxGap,
    maxSpaceWidth: spaceWidths.length > 0 ? Math.max(...spaceWidths) : 0,
    medianNonSpaceWidth: median(nonSpaceWidths.length > 0 ? nonSpaceWidths : fallbackWidths),
  };
}

function buildDetectedTextElementFromChars(chars, metadata = {}) {
  const rawChars = sortCharsByOriginalOrder(chars)
    .filter((char) => validBBox(char?.bbox))
    .map((char) => ({
      c: String(char?.c || ''),
      bbox: char.bbox.map((value) => Number(value) || 0),
      originalIndex: Number(char?.originalIndex || 0),
    }));
  const trimmedChars = trimEdgeWhitespaceChars(rawChars);
  const effectiveChars = trimmedChars.length > 0 ? trimmedChars : rawChars;
  const bbox = unionBBoxes(effectiveChars.map((char) => char.bbox));
  const sourceTextOrientation = metadata?.sourceTextOrientation || detectTextOrientationFromChars(effectiveChars);
  const originalText = effectiveChars.map((char) => char.c).join('');
  const text = metadata?.reconstructMixedBidiLines === true
    ? reconstructMixedBidiLineTextFromChars(effectiveChars, { sourceTextOrientation })
    : originalText;
  return {
    bbox,
    text,
    rawText: rawChars.map((char) => char.c).join(''),
    chars: effectiveChars,
    sourceTextOrientation,
    sourceLineId: metadata?.sourceLineId || null,
    sourceLineBBox: Array.isArray(metadata?.sourceLineBBox) ? metadata.sourceLineBBox.map((value) => Number(value) || 0) : null,
    sourceBottomInsetRatio: (
      Array.isArray(metadata?.sourceLineBBox)
      && validBBox(metadata.sourceLineBBox)
      && rectHeight(metadata.sourceLineBBox) > 0
    )
      ? clampUnitRatio((Number(metadata.sourceLineBBox[3]) - Number(bbox[3])) / rectHeight(metadata.sourceLineBBox))
      : 0,
    sourceLineIndex: Number.isInteger(metadata?.sourceLineIndex) ? Number(metadata.sourceLineIndex) : null,
    sourceBlockIndex: Number.isInteger(metadata?.sourceBlockIndex) ? Number(metadata.sourceBlockIndex) : null,
    splitReason: metadata?.splitReason || null,
    reconstructMixedBidiLines: metadata?.reconstructMixedBidiLines === true,
    mixedBidiReconstructed: metadata?.reconstructMixedBidiLines === true && text !== originalText,
    tightness: classifyDetectedTextTightness(text, {
      lineChars: effectiveChars,
    }),
    renderKind: TEXT_ELEMENT_RENDER_KIND.NON_TIGHT,
  };
}

function splitCharsByLongWhitespaceRuns(chars, {
  longSpaceRunThreshold = LONG_SPACE_RUN_THRESHOLD,
} = {}) {
  const orderedChars = sortCharsByOriginalOrder(chars);
  const groups = [];
  let currentGroup = [];
  let index = 0;
  while (index < orderedChars.length) {
    const char = orderedChars[index];
    if (isWhitespaceChar(char.c)) {
      let runEnd = index;
      while (runEnd < orderedChars.length && isWhitespaceChar(orderedChars[runEnd].c)) {
        runEnd += 1;
      }
      if ((runEnd - index) >= longSpaceRunThreshold) {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
        index = runEnd;
        continue;
      }
    }
    currentGroup.push(char);
    index += 1;
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  return groups.filter((group) => group.some((char) => String(char?.c || '').trim().length > 0));
}

function splitCharsByWideSpaceGlyphs(chars, {
  wideSpaceGlyphPtThreshold = WIDE_SPACE_GLYPH_PT_THRESHOLD,
  wideSpaceGlyphFactor = WIDE_SPACE_GLYPH_FACTOR,
} = {}) {
  const orderedChars = sortCharsByOriginalOrder(chars);
  const metrics = computeLineVisualGapMetrics(orderedChars);
  const threshold = Math.max(
    wideSpaceGlyphPtThreshold,
    metrics.medianNonSpaceWidth * wideSpaceGlyphFactor,
  );
  const groups = [];
  let currentGroup = [];
  for (const char of orderedChars) {
    if (isWhitespaceChar(char.c) && rectWidth(char.bbox) >= threshold) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      continue;
    }
    currentGroup.push(char);
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  return groups.filter((group) => group.some((char) => String(char?.c || '').trim().length > 0));
}

function splitCharsByLargeVisualGaps(chars, {
  largeVisualGapPtThreshold = LARGE_VISUAL_GAP_PT_THRESHOLD,
  largeVisualGapFactor = LARGE_VISUAL_GAP_FACTOR,
} = {}) {
  const visualOrder = sortCharsByVisualOrder(chars);
  if (visualOrder.length <= 1) {
    return [visualOrder];
  }
  const metrics = computeLineVisualGapMetrics(visualOrder);
  const threshold = Math.max(
    largeVisualGapPtThreshold,
    metrics.medianNonSpaceWidth * largeVisualGapFactor,
  );
  const groups = [];
  let currentGroup = [visualOrder[0]];
  for (let index = 1; index < visualOrder.length; index += 1) {
    const previous = visualOrder[index - 1];
    const current = visualOrder[index];
    const gap = Number(current.bbox[0]) - Number(previous.bbox[2]);
    if (gap >= threshold) {
      groups.push(currentGroup);
      currentGroup = [current];
      continue;
    }
    currentGroup.push(current);
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  return groups.filter((group) => group.some((char) => String(char?.c || '').trim().length > 0));
}

function chooseBestSplitCandidate(candidates) {
  let best = null;
  function compareScores(left, right) {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] === right[index]) {
        continue;
      }
      return left[index] - right[index];
    }
    return 0;
  }
  for (const candidateEntry of candidates) {
    const candidate = candidateEntry?.groups;
    if (!Array.isArray(candidate) || candidate.length <= 1) {
      continue;
    }
    const elements = candidate.map((group) => buildDetectedTextElementFromChars(group));
    const nonEmpty = elements.filter((element) => element.text.trim().length > 0);
    if (nonEmpty.length <= 1) {
      continue;
    }
    const tightCount = nonEmpty.filter((element) => element.tightness === TEXT_ELEMENT_TIGHTNESS.TIGHT).length;
    const nonTightCount = nonEmpty.filter((element) => element.tightness === TEXT_ELEMENT_TIGHTNESS.NON_TIGHT).length;
    const score = [
      nonTightCount === 0 ? 1 : 0,
      -nonTightCount,
      tightCount,
      nonEmpty.length,
    ];
    if (!best || compareScores(score, best.score) > 0) {
      best = {
        groups: candidate,
        score,
        splitReason: candidateEntry?.splitReason || null,
      };
    }
  }
  return best || null;
}

function splitNonTightCharsRecursively(chars, metadata = {}, depth = 0) {
  const baseElement = buildDetectedTextElementFromChars(chars, metadata);
  if (baseElement.tightness !== TEXT_ELEMENT_TIGHTNESS.NON_TIGHT || depth >= 3) {
    return [baseElement];
  }
  const bestCandidate = chooseBestSplitCandidate([
    {
      splitReason: DETECTED_TEXT_SPLIT_REASON.LARGE_VISUAL_GAP,
      groups: splitCharsByLargeVisualGaps(chars),
    },
    {
      splitReason: DETECTED_TEXT_SPLIT_REASON.LONG_WHITESPACE_RUN,
      groups: splitCharsByLongWhitespaceRuns(chars),
    },
    {
      splitReason: DETECTED_TEXT_SPLIT_REASON.WIDE_SPACE_GLYPH,
      groups: splitCharsByWideSpaceGlyphs(chars),
    },
  ]);
  if (!bestCandidate) {
    return [baseElement];
  }
  return bestCandidate.groups.flatMap((group) => splitNonTightCharsRecursively(group, {
    ...metadata,
    splitReason: bestCandidate.splitReason,
  }, depth + 1));
}

export function classifyDetectedTextTightness(text, {
  longSpaceRunThreshold = LONG_SPACE_RUN_THRESHOLD,
  lineChars = null,
  largeVisualGapPtThreshold = LARGE_VISUAL_GAP_PT_THRESHOLD,
  largeVisualGapFactor = LARGE_VISUAL_GAP_FACTOR,
  wideSpaceGlyphPtThreshold = WIDE_SPACE_GLYPH_PT_THRESHOLD,
  wideSpaceGlyphFactor = WIDE_SPACE_GLYPH_FACTOR,
} = {}) {
  const rawText = String(text || '');
  if (rawText.trim().length === 0) {
    return TEXT_ELEMENT_TIGHTNESS.EMPTY;
  }
  let runLength = 0;
  let maxRunLength = 0;
  for (const char of rawText) {
    if (char === ' ' || char === '\t' || char === '\u00A0') {
      runLength += 1;
      maxRunLength = Math.max(maxRunLength, runLength);
    } else {
      runLength = 0;
    }
  }
  if (maxRunLength >= longSpaceRunThreshold) {
    return TEXT_ELEMENT_TIGHTNESS.NON_TIGHT;
  }
  if (Array.isArray(lineChars) && lineChars.length > 1) {
    const metrics = computeLineVisualGapMetrics(lineChars);
    const visualGapThreshold = Math.max(
      largeVisualGapPtThreshold,
      metrics.medianNonSpaceWidth * largeVisualGapFactor,
    );
    const wideSpaceThreshold = Math.max(
      wideSpaceGlyphPtThreshold,
      metrics.medianNonSpaceWidth * wideSpaceGlyphFactor,
    );
    if (metrics.maxGap >= visualGapThreshold || metrics.maxSpaceWidth >= wideSpaceThreshold) {
      return TEXT_ELEMENT_TIGHTNESS.NON_TIGHT;
    }
  }
  return TEXT_ELEMENT_TIGHTNESS.TIGHT;
}

export function splitNonTightDetectedTextElement(element) {
  if (!element || element.tightness !== TEXT_ELEMENT_TIGHTNESS.NON_TIGHT || !Array.isArray(element.chars) || element.chars.length <= 1) {
    return {
      success: false,
      segments: [],
    };
  }
  const segments = splitNonTightCharsRecursively(element.chars, {
    sourceLineId: element.sourceLineId,
    sourceLineBBox: element.sourceLineBBox,
    sourceLineIndex: element.sourceLineIndex,
    sourceBlockIndex: element.sourceBlockIndex,
    sourceTextOrientation: element.sourceTextOrientation,
    reconstructMixedBidiLines: element.reconstructMixedBidiLines === true,
  })
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => ({
      ...segment,
      renderKind: TEXT_ELEMENT_RENDER_KIND.SPLIT_TIGHT,
    }));
  const success = segments.length > 1 && segments.every((segment) => segment.tightness === TEXT_ELEMENT_TIGHTNESS.TIGHT);
  return {
    success,
    segments: success ? segments : [],
  };
}

export function prepareDetectedTextElementsForAnnotation(elements) {
  const prepared = [];
  for (const element of elements || []) {
    if (!element) {
      continue;
    }
    if (element.tightness === TEXT_ELEMENT_TIGHTNESS.EMPTY) {
      continue;
    }
    if (element.tightness === TEXT_ELEMENT_TIGHTNESS.NON_TIGHT) {
      const split = splitNonTightDetectedTextElement(element);
      if (split.success) {
        prepared.push(...split.segments);
        continue;
      }
      prepared.push({
        ...element,
        renderKind: TEXT_ELEMENT_RENDER_KIND.NON_TIGHT,
      });
      continue;
    }
    prepared.push({
      ...element,
      renderKind: TEXT_ELEMENT_RENDER_KIND.TIGHT,
    });
  }
  return prepared;
}

export function collectStructuredTextLineElements(page, {
  options = STRUCTURED_TEXT_LINE_OPTIONS,
  reconstructMixedBidiLines = false,
} = {}) {
  const structuredText = page.toStructuredText(options);
  try {
    const seen = new Set();
    const elements = [];
    let currentLine = null;
    let sourceBlockIndex = -1;
    let sourceLineIndex = -1;

    function finalizeLine() {
      if (!currentLine || !validBBox(currentLine.bbox)) {
        currentLine = null;
        return;
      }
      const element = buildDetectedTextElementFromChars(currentLine.chars, {
        sourceLineId: currentLine.sourceLineId,
        sourceLineBBox: currentLine.bbox,
        sourceLineIndex: currentLine.sourceLineIndex,
        sourceBlockIndex: currentLine.sourceBlockIndex,
        reconstructMixedBidiLines,
      });
      const key = [...element.bbox.map((value) => Number(value.toFixed(3))), element.text].join(':');
      if (!seen.has(key)) {
        seen.add(key);
        elements.push(element);
      }
      currentLine = null;
    }
    structuredText.walk({
      beginTextBlock() {
        finalizeLine();
        sourceBlockIndex += 1;
        sourceLineIndex = -1;
      },
      beginLine(bbox) {
        finalizeLine();
        sourceLineIndex += 1;
        currentLine = {
          bbox: normalizeStructuredTextBBox(bbox),
          chars: [],
          sourceLineId: `b${sourceBlockIndex}_l${sourceLineIndex}`,
          sourceLineIndex,
          sourceBlockIndex,
        };
      },
      onChar(c, _origin, _font, _size, quad) {
        if (!currentLine) {
          return;
        }
        const bbox = bboxFromQuad(quad);
        if (!validBBox(bbox)) {
          return;
        }
        currentLine.chars.push({
          c: String(c || ''),
          bbox,
          originalIndex: currentLine.chars.length,
        });
      },
      endLine() {
        finalizeLine();
      },
      endTextBlock() {
        finalizeLine();
      },
    });
    finalizeLine();
    return elements;
  } finally {
    structuredText.destroy?.();
  }
}

export function collectStructuredTextLineBBoxes(page, {
  options = STRUCTURED_TEXT_LINE_OPTIONS,
} = {}) {
  return collectStructuredTextLineElements(page, { options }).map((element) => element.bbox);
}

export const __testOnly = {
  DETECTED_TEXT_SPLIT_REASON,
  LONG_SPACE_RUN_THRESHOLD,
  LARGE_VISUAL_GAP_PT_THRESHOLD,
  LARGE_VISUAL_GAP_FACTOR,
  WIDE_SPACE_GLYPH_PT_THRESHOLD,
  WIDE_SPACE_GLYPH_FACTOR,
  buildDetectedTextElementFromChars,
  computeLineVisualGapMetrics,
  normalizeStructuredTextBBox,
  trimEdgeWhitespaceChars,
  splitCharsByLargeVisualGaps,
  splitCharsByLongWhitespaceRuns,
  splitCharsByWideSpaceGlyphs,
  buildBidiTokensFromChars,
  reconstructMixedBidiLineTextFromChars,
};
