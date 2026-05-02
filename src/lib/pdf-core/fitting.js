import { SCHEMA_VERSION } from './mupdfExtraction.js';
import {
  measureLinePt,
  splitExplicitLines,
  wrapTextToWidth,
} from '../textLayoutMetrics.js';
import {
  resolveTextOrientationForBlock,
  sourceClipDefaultsForLayout,
} from '../localEditorDrawPlan.js';
import { resolveLogicalTextFrame, resolveTextPaddingPt } from '../textOrientation.js';

export const STAGE_FITTED_BLOCKS = 'fitted_blocks';

const FIT_TEXT_PADDING_PT = 1.0;
const COLLISION_MIN_INTERSECTION_AREA_PT2 = 0.5;
const COLLISION_MIN_AXIS_OVERLAP_PT = 0.75;
const COLLISION_MIN_SMALLER_BOX_COVERAGE = 0.01;
const TABLE_COLLISION_SEAM_MAX_THICKNESS_PT = 1.5;
export const GLOBAL_MIN_FONT_SIZE = 4.0;
export const TEXT_BLOCK_NUDGE_STEPS = [0.2, 0.4, 0.6, 0.8];
export const DEFAULT_EXPANSION_STEPS = [0.05, 0.1, 0.15, 0.2];
const FITTED_FONT_PRECISION = 4;
const BUCKET_RATIO_MIN = 0.7;
const BUCKET_RATIO_MAX = 1.35;
const BUCKET_RATIO_SMALL_FONT_THRESHOLD = 3;
const BUCKET_RATIO_SMALL_FONT_MAX = 100;
const BUCKET_RATIO_MIN_LETTERS = 6;
const BUCKET_RATIO_MIN_OCCUPANCY = 0.45;
const BUCKET_RATIO_MAX_OCCUPANCY = 0.98;

export class FittingConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FittingConfigurationError';
  }
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function rectWidth(bbox) {
  return Math.max(0, bbox[2] - bbox[0]);
}

function rectHeight(bbox) {
  return Math.max(0, bbox[3] - bbox[1]);
}

function bboxArea(bbox) {
  return rectWidth(bbox) * rectHeight(bbox);
}

function axisOverlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function axisGap(a0, a1, b0, b1) {
  if (a1 < b0) {
    return b0 - a1;
  }
  if (b1 < a0) {
    return a0 - b1;
  }
  return 0;
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

function wrapText(text, maxWidth, fontSize, wrapMode, fontWeight) {
  if (wrapMode === 'none') {
    return splitExplicitLines(text);
  }
  return wrapTextToWidth(text, maxWidth, fontSize, fontWeight);
}

function normalizedLineSpacingForFit(ratio, wrapMode) {
  if (wrapMode === 'word') {
    return Math.max(1.0, ratio);
  }
  return ratio;
}

function clipResolvedForFit({
  sourceClipDefault = false,
  clipMode = 'auto',
  bboxEdited = false,
}) {
  if (clipMode === 'auto' && bboxEdited) {
    return false;
  }
  return clipMode === 'on' || (clipMode === 'auto' && sourceClipDefault);
}

function layoutText(text, {
  bbox,
  fontSize,
  lineSpacing,
  wrapMode,
  fontWeight = 'normal',
  sourceClipDefault = false,
  sourceLineCount = 0,
  clipMode = 'auto',
  bboxEdited = false,
  textOrientation = 'horizontal',
}) {
  const frame = resolveLogicalTextFrame(bbox, {
    orientation: textOrientation,
    paddingPt: resolveTextPaddingPt(textOrientation),
  });
  const maxWidth = frame.contentWidth;
  const maxHeight = frame.contentHeight;
  const effectiveWrapMode = textOrientation === 'vertical_ttb' ? 'none' : wrapMode;
  const lines = wrapText(text, maxWidth, fontSize, effectiveWrapMode, fontWeight);
  const maxLineWidth = Math.max(...lines.map((line) => measureLinePt(line, fontSize, fontWeight)));
  const lineHeight = fontSize * lineSpacing;
  const totalHeight = fontSize + (Math.max(0, lines.length - 1) * lineHeight);
  let maxLines = Math.max(1, Math.floor((maxHeight - fontSize) / lineHeight) + 1);
  const clipResolved = clipResolvedForFit({ sourceClipDefault, clipMode, bboxEdited });
  if (clipResolved && Number.isFinite(sourceLineCount) && sourceLineCount > 0) {
    maxLines = Math.min(maxLines, Math.floor(sourceLineCount));
  }
  const fits = (
    maxLineWidth <= maxWidth + 1e-3
    && totalHeight <= maxHeight + 1e-3
    && lines.length <= maxLines
  );
  return {
    lines,
    maxLineWidth,
    totalHeight,
    fontSize,
    fits,
  };
}

function findBestFit(text, {
  bbox,
  baseFontSize,
  lineSpacing,
  minFontSize,
  wrapMode = 'none',
  fontWeight = 'normal',
  sourceClipDefault = false,
  sourceLineCount = 0,
  clipMode = 'auto',
  bboxEdited = false,
  textOrientation = 'horizontal',
}) {
  const top = Math.max(baseFontSize, minFontSize);
  const atTop = layoutText(text, {
    bbox,
    fontSize: top,
    lineSpacing,
    wrapMode,
    fontWeight,
    sourceClipDefault,
    sourceLineCount,
    clipMode,
    bboxEdited,
    textOrientation,
  });  
  if (atTop.fits) {
    return atTop;
  }

  const atMin = layoutText(text, {
    bbox,
    fontSize: minFontSize,
    lineSpacing,
    wrapMode,
    fontWeight,
    sourceClipDefault,
    sourceLineCount,
    clipMode,
    bboxEdited,
    textOrientation,
  });
  if (!atMin.fits) {
    return atMin;
  }

  let lo = minFontSize;
  let hi = top;
  let best = atMin;
  for (let index = 0; index < 16; index += 1) {
    const mid = (lo + hi) / 2;
    const attempt = layoutText(text, {
      bbox,
      fontSize: mid,
      lineSpacing,
      wrapMode,
      fontWeight,
      sourceClipDefault,
      sourceLineCount,
      clipMode,
      bboxEdited,
      textOrientation,
    });
    if (attempt.fits) {
      best = attempt;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function localLineSpacingForBlock(block) {
  const lineHeight = Number(block?.line_height);
  const fontSize = Number(block?.font_size);
  const wrapMode = wrapModeForEditableBlock(block);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return normalizedLineSpacingForFit(1.2, wrapMode);
  }
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return normalizedLineSpacingForFit(1.2, wrapMode);
  }
  const ratio = lineHeight / fontSize;
  if (!Number.isFinite(ratio) || ratio < 0.8 || ratio > 2.5) {
    return normalizedLineSpacingForFit(1.2, wrapMode);
  }
  return normalizedLineSpacingForFit(ratio, wrapMode);
}

function sourceLineCountForBlock(block) {
  return Math.max(1, String(block?.text || '').split(/\r?\n/u).length);
}

function normalizeFontFamily(fontFamily) {
  return String(fontFamily || 'unknown')
    .replace(/^[A-Z]{6}\+/u, '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase() || 'unknown';
}

function typeGroupForSourceBlock(sourceBlock) {
  return String(sourceBlock?.type || '') === 'title' ? 'title' : 'body';
}

function exactBucketKey(style, sourceBlock) {
  return JSON.stringify([
    normalizeFontFamily(style?.font_family),
    String(style?.weight || 'normal'),
    Boolean(style?.italic),
    typeGroupForSourceBlock(sourceBlock),
  ]);
}

function familyBucketKey(style, sourceBlock) {
  return JSON.stringify([
    normalizeFontFamily(style?.font_family),
    typeGroupForSourceBlock(sourceBlock),
  ]);
}

function textLetterCount(text) {
  return (String(text || '').match(/\p{L}/gu) || []).length;
}

function textDigitCount(text) {
  return (String(text || '').match(/\p{N}/gu) || []).length;
}

function fitSearchCeiling(text, {
  bbox,
  lineSpacing,
  wrapMode = 'none',
  fontWeight = 'normal',
  minFontSize,
  textOrientation = 'horizontal',
}) {
  const frame = resolveLogicalTextFrame(bbox, {
    orientation: textOrientation,
    paddingPt: resolveTextPaddingPt(textOrientation),
  });
  const maxWidth = frame.contentWidth;
  const maxHeight = frame.contentHeight;
  const explicitLines = splitExplicitLines(text);
  const explicitLineCount = Math.max(1, explicitLines.length);
  const heightCeiling = maxHeight / Math.max(0.1, lineSpacing * explicitLineCount);
  const widestLineAtUnitSize = Math.max(
    1e-3,
    ...explicitLines.map((line) => measureLinePt(line, 1, fontWeight)),
  );

  if (textOrientation === 'vertical_ttb') {
    const advanceCeiling = maxWidth / widestLineAtUnitSize;
    return Math.max(minFontSize, Math.min(heightCeiling, advanceCeiling));
  }
  if (wrapMode !== 'none') {
    return Math.max(minFontSize, heightCeiling);
  }
  const widthCeiling = maxWidth / widestLineAtUnitSize;
  return Math.max(minFontSize, Math.min(heightCeiling, widthCeiling));
}

function weightedMedianRatio(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  const ordered = [...entries]
    .filter((entry) => Number.isFinite(entry?.ratio) && Number.isFinite(entry?.weight) && entry.weight > 0)
    .sort((left, right) => left.ratio - right.ratio);
  if (ordered.length === 0) {
    return null;
  }
  const totalWeight = ordered.reduce((sum, entry) => sum + entry.weight, 0);
  let seen = 0;
  for (const entry of ordered) {
    seen += entry.weight;
    if (seen >= totalWeight / 2) {
      return entry.ratio;
    }
  }
  return ordered[ordered.length - 1].ratio;
}

function computeBucketFontRatioAssignments({
  sourceBlocks,
  styleById,
  translationByBlock,
  sourceClipDefaultsById,
  minFontSize,
  wrapMode,
  wrapModeOverridesByBlockId,
}) {
  const exactSamples = new Map();
  const familySamples = new Map();
  const documentTypeSamples = new Map();
  const documentSamples = [];

  for (const sourceBlock of sourceBlocks) {
    if (String(sourceBlock?.type || '') === 'table_cell') {
      continue;
    }
    const style = styleById.get(sourceBlock.style_id);
    if (!style) {
      continue;
    }
    const sourceFontSize = Number(style.font_size);
    if (!Number.isFinite(sourceFontSize) || sourceFontSize <= 0) {
      continue;
    }
    const translatedText = String(
      translationByBlock.get(sourceBlock.block_id)?.translated_text
      || sourceBlock.text
      || '',
    );
    const letterCount = textLetterCount(translatedText);
    if (letterCount < BUCKET_RATIO_MIN_LETTERS) {
      continue;
    }
    const digitCount = textDigitCount(translatedText);
    if (digitCount > letterCount * 1.2) {
      continue;
    }

    const bbox = Array.isArray(sourceBlock.bbox) ? sourceBlock.bbox.map((value) => Number(value)) : [0, 0, 1, 1];
    const blockWrapMode = wrapModeOverridesByBlockId?.[sourceBlock.block_id] || wrapMode;
    const textOrientation = resolveTextOrientationForBlock(sourceBlock);
    const sourceLineCount = sourceLineCountForBlock(sourceBlock);
    const sourceClipDefault = Boolean(sourceClipDefaultsById[String(sourceBlock.block_id || '')]);
    const ceiling = fitSearchCeiling(translatedText, {
      bbox,
      lineSpacing: Number(style.line_spacing) || 1.2,
      wrapMode: blockWrapMode,
      fontWeight: String(style.weight || 'normal'),
      minFontSize,
      textOrientation,
    });
    const attempt = findBestFit(translatedText, {
      bbox,
      baseFontSize: ceiling,
      lineSpacing: Number(style.line_spacing) || 1.2,
      minFontSize,
      wrapMode: blockWrapMode,
      fontWeight: String(style.weight || 'normal'),
      sourceClipDefault,
      sourceLineCount,
      clipMode: 'auto',
      bboxEdited: false,
      textOrientation,
    });
    if (!attempt.fits) {
      continue;
    }

    const frame = resolveLogicalTextFrame(bbox, {
      orientation: textOrientation,
      paddingPt: resolveTextPaddingPt(textOrientation),
    });
    const maxWidth = frame.contentWidth;
    const occupancy = attempt.maxLineWidth / maxWidth;
    if (!Number.isFinite(occupancy) || occupancy < BUCKET_RATIO_MIN_OCCUPANCY || occupancy > BUCKET_RATIO_MAX_OCCUPANCY) {
      continue;
    }

    const ratioMax = sourceFontSize < BUCKET_RATIO_SMALL_FONT_THRESHOLD
      ? BUCKET_RATIO_SMALL_FONT_MAX
      : BUCKET_RATIO_MAX;
    const ratio = Math.max(
      BUCKET_RATIO_MIN,
      Math.min(ratioMax, attempt.fontSize / sourceFontSize),
    );
    const weight = Math.max(1, Math.sqrt(letterCount) * occupancy);
    const sample = { ratio, weight };
    const exactKey = exactBucketKey(style, sourceBlock);
    const familyKey = familyBucketKey(style, sourceBlock);
    const typeGroup = typeGroupForSourceBlock(sourceBlock);

    if (!exactSamples.has(exactKey)) {
      exactSamples.set(exactKey, []);
    }
    exactSamples.get(exactKey).push(sample);

    if (!familySamples.has(familyKey)) {
      familySamples.set(familyKey, []);
    }
    familySamples.get(familyKey).push(sample);

    if (!documentTypeSamples.has(typeGroup)) {
      documentTypeSamples.set(typeGroup, []);
    }
    documentTypeSamples.get(typeGroup).push(sample);
    documentSamples.push(sample);
  }

  const exactRatios = new Map(
    [...exactSamples.entries()].map(([key, samples]) => [key, weightedMedianRatio(samples)]),
  );
  const familyRatios = new Map(
    [...familySamples.entries()].map(([key, samples]) => [key, weightedMedianRatio(samples)]),
  );
  const documentTypeRatios = new Map(
    [...documentTypeSamples.entries()].map(([key, samples]) => [key, weightedMedianRatio(samples)]),
  );
  const documentRatio = weightedMedianRatio(documentSamples);

  const ratioByBlockId = new Map();
  for (const sourceBlock of sourceBlocks) {
    const style = styleById.get(sourceBlock.style_id);
    if (!style) {
      ratioByBlockId.set(sourceBlock.block_id, 1.0);
      continue;
    }
    const exact = exactRatios.get(exactBucketKey(style, sourceBlock));
    const family = familyRatios.get(familyBucketKey(style, sourceBlock));
    const documentType = documentTypeRatios.get(typeGroupForSourceBlock(sourceBlock));
    ratioByBlockId.set(
      sourceBlock.block_id,
      exact ?? family ?? documentType ?? documentRatio ?? 1.0,
    );
  }
  return ratioByBlockId;
}

function wrapModeForEditableBlock(block) {
  if (resolveTextOrientationForBlock(block) === 'vertical_ttb') {
    return 'none';
  }
  if (String(block?.wrap_mode || '') === 'word') {
    return 'word';
  }
  if (
    String(block?.block_type || block?.type || '') === 'table_cell'
    || String(block?.block_type || block?.type || '') === 'text_line'
    || Boolean(block?.flattened_line_breaks)
  ) {
    return 'word';
  }
  return 'none';
}

export function fitEditableBlockToBBox(block, {
  minFontSize = GLOBAL_MIN_FONT_SIZE,
  maxFontSize = null,
  allowGrowth = false,
} = {}) {
  const bbox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1];
  const lineSpacing = localLineSpacingForBlock(block);
  const sourceFontSize = Math.max(0, Number(block?.source_font_size) || 0);
  const requestedMaxFontSize = Number(maxFontSize);
  const cappedBaseFontSize = Math.max(1, Number(block?.font_size) || 10, sourceFontSize);
  const textOrientation = resolveTextOrientationForBlock(block);
  const growthCeiling = fitSearchCeiling(String(block?.text || ''), {
    bbox,
    lineSpacing,
    wrapMode: wrapModeForEditableBlock(block),
    fontWeight: String(block?.font_weight || 'normal'),
    minFontSize,
    textOrientation,
  });
  const searchBaseFontSize = allowGrowth
    ? Math.max(cappedBaseFontSize, growthCeiling)
    : cappedBaseFontSize;
  const baseFontSize = Number.isFinite(requestedMaxFontSize) && requestedMaxFontSize > 0
    ? Math.min(searchBaseFontSize, requestedMaxFontSize)
    : searchBaseFontSize;
  const attempt = findBestFit(String(block?.text || ''), {
    bbox,
    baseFontSize,
    lineSpacing,
    minFontSize,
    wrapMode: wrapModeForEditableBlock(block),
    fontWeight: String(block?.font_weight || 'normal'),
    sourceClipDefault: Boolean(block?.source_clip_default),
    sourceLineCount: Math.max(1, Number(block?.source_line_count) || 0),
    clipMode: String(block?.clip_mode || 'auto'),
    bboxEdited: Boolean(block?.bbox_edited),
    textOrientation,
  });
  return {
    fontSize: round(attempt.fontSize, FITTED_FONT_PRECISION),
    lineHeight: round(attempt.fontSize * lineSpacing, FITTED_FONT_PRECISION),
    lines: attempt.lines,
    overflow: !attempt.fits,
    lineSpacing,
  };
}

export function markCollisions(blocks, {
  tableSourceBlockIds = new Set(),
} = {}) {
  for (const block of blocks) {
    block.collision = false;
    block.collides_with = [];
  }

  for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
      const left = blocks[leftIndex];
      const right = blocks[rightIndex];
      if (
        tableSourceBlockIds.has(left.source_block_id)
        && tableSourceBlockIds.has(right.source_block_id)
        && isTableSeamOverlap(left.bbox, right.bbox)
      ) {
        continue;
      }
      if (!isMeaningfulBBoxCollision(left.bbox, right.bbox)) {
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

function tableCellsAreNeighbors(left, right, {
  gapTolerancePt = 3.0,
  overlapTolerancePt = 0.5,
} = {}) {
  const { area } = intersectionMetrics(left.bbox, right.bbox);
  if (area > 0) {
    return true;
  }

  const horizontalGap = axisGap(left.bbox[0], left.bbox[2], right.bbox[0], right.bbox[2]);
  const verticalGap = axisGap(left.bbox[1], left.bbox[3], right.bbox[1], right.bbox[3]);
  const horizontalOverlap = axisOverlap(left.bbox[0], left.bbox[2], right.bbox[0], right.bbox[2]);
  const verticalOverlap = axisOverlap(left.bbox[1], left.bbox[3], right.bbox[1], right.bbox[3]);
  const sharesRow = verticalOverlap > overlapTolerancePt && horizontalGap <= gapTolerancePt;
  const sharesColumn = horizontalOverlap > overlapTolerancePt && verticalGap <= gapTolerancePt;
  return sharesRow || sharesColumn;
}

function groupTableComponents(tableCells) {
  if (tableCells.length === 0) {
    return [];
  }
  const components = [];
  const visited = new Set();
  const byId = new Map(tableCells.map((block) => [block.block_id, block]));

  for (const block of tableCells) {
    if (visited.has(block.block_id)) {
      continue;
    }
    const queue = [block.block_id];
    visited.add(block.block_id);
    const componentIds = [];
    while (queue.length > 0) {
      const currentId = queue.pop();
      componentIds.push(currentId);
      const current = byId.get(currentId);
      for (const candidate of tableCells) {
        if (visited.has(candidate.block_id)) {
          continue;
        }
        if (!tableCellsAreNeighbors(current, candidate)) {
          continue;
        }
        visited.add(candidate.block_id);
        queue.push(candidate.block_id);
      }
    }
    components.push(
      componentIds
        .map((identifier) => byId.get(identifier))
        .sort((left, right) => left.reading_order - right.reading_order),
    );
  }
  return components;
}

function clusterTableRows(tableCells) {
  if (tableCells.length === 0) {
    return [];
  }
  const heights = tableCells.map((block) => Math.max(1, rectHeight(block.bbox)));
  const sortedHeights = [...heights].sort((left, right) => left - right);
  const medianHeight = sortedHeights.length % 2 === 1
    ? sortedHeights[(sortedHeights.length - 1) / 2]
    : (sortedHeights[(sortedHeights.length / 2) - 1] + sortedHeights[sortedHeights.length / 2]) / 2;
  const yTolerance = Math.max(1, medianHeight * 0.25);

  const rows = [];
  const orderedCells = [...tableCells].sort((left, right) => {
    if (left.bbox[1] !== right.bbox[1]) {
      return left.bbox[1] - right.bbox[1];
    }
    return left.bbox[0] - right.bbox[0];
  });

  for (const cell of orderedCells) {
    const cellCenter = (cell.bbox[1] + cell.bbox[3]) / 2;
    let assignedRow = null;
    for (const row of rows) {
      const rowHeight = Math.max(1, row.y1 - row.y0);
      const centerClose = Math.abs(cellCenter - row.centerY) <= Math.max(yTolerance, rowHeight * 0.45);
      const overlap = axisOverlap(cell.bbox[1], cell.bbox[3], row.y0, row.y1);
      const overlapRatio = overlap / Math.min(Math.max(1, rectHeight(cell.bbox)), rowHeight);
      if (centerClose || overlapRatio >= 0.4) {
        assignedRow = row;
        break;
      }
    }

    if (!assignedRow) {
      rows.push({
        cells: [cell],
        y0: cell.bbox[1],
        y1: cell.bbox[3],
        get sourceHeight() {
          return Math.max(1, this.y1 - this.y0);
        },
        get centerY() {
          return (this.y0 + this.y1) / 2;
        },
      });
      continue;
    }
    assignedRow.cells.push(cell);
    assignedRow.y0 = Math.min(assignedRow.y0, cell.bbox[1]);
    assignedRow.y1 = Math.max(assignedRow.y1, cell.bbox[3]);
  }

  rows.sort((left, right) => left.y0 - right.y0);
  return rows;
}

function measureTableRowRequirements({
  rows,
  styleById,
  translatedTextByBlock,
  fontSize,
}) {
  const rowHeights = [];
  const attemptsByBlockId = new Map();
  let fitsAll = true;

  for (const row of rows) {
    let rowRequiredHeight = 1;
    for (const cell of row.cells) {
      const style = styleById.get(cell.style_id);
      if (!style) {
        continue;
      }
      const translatedText = translatedTextByBlock.get(cell.block_id) || cell.text;
      const attempt = layoutText(translatedText, {
        bbox: cell.bbox,
        fontSize,
        lineSpacing: style.line_spacing,
        wrapMode: 'word',
        fontWeight: style.weight,
      });
      attemptsByBlockId.set(cell.block_id, attempt);
      const requiredHeight = (attempt.lines.length * fontSize * style.line_spacing) + (FIT_TEXT_PADDING_PT * 2);
      rowRequiredHeight = Math.max(rowRequiredHeight, requiredHeight);
      if (attempt.maxLineWidth > Math.max(1, rectWidth(cell.bbox) - (FIT_TEXT_PADDING_PT * 2)) + 1e-3) {
        fitsAll = false;
      }
    }
    rowHeights.push(rowRequiredHeight);
  }

  return { rowHeights, attemptsByBlockId, fitsAll };
}

function applyUniformTableFit({
  sourceBlocks,
  styleById,
  translationByBlock,
  sourceClipDefaultsById,
  fittedBlocks,
  minFontSize,
}) {
  const tableCells = sourceBlocks.filter((block) => block.type === 'table_cell');
  if (tableCells.length === 0) {
    return;
  }

  const fittedBySourceId = new Map(fittedBlocks.map((block) => [block.source_block_id, block]));
  const translatedTextByBlock = new Map(
    tableCells.map((cell) => [
      cell.block_id,
      translationByBlock.get(cell.block_id)?.translated_text || cell.text,
    ]),
  );

  for (const component of groupTableComponents(tableCells)) {
    const rows = clusterTableRows(component);
    if (rows.length === 0) {
      continue;
    }

    const availableStyles = component
      .map((cell) => styleById.get(cell.style_id))
      .filter(Boolean);
    if (availableStyles.length === 0) {
      continue;
    }

    const tableTop = Math.min(...rows.map((row) => row.y0));
    const tableBottom = Math.max(...rows.map((row) => row.y1));
    const tableHeight = Math.max(1, tableBottom - tableTop);
    const sourceRowHeights = rows.map((row) => row.sourceHeight);
    const sourceRowTotal = sourceRowHeights.reduce((sum, height) => sum + height, 0) || rows.length;

    const upperFontSize = Math.max(...availableStyles.map((style) => style.font_size));
    const lowerFontSize = minFontSize;
    const low = measureTableRowRequirements({
      rows,
      styleById,
      translatedTextByBlock,
      fontSize: lowerFontSize,
    });
    const lowFits = low.fitsAll && low.rowHeights.reduce((sum, height) => sum + height, 0) <= tableHeight + 1e-3;

    let chosenFontSize = lowerFontSize;
    if (lowFits) {
      const high = measureTableRowRequirements({
        rows,
        styleById,
        translatedTextByBlock,
        fontSize: upperFontSize,
      });
      const highFits = high.fitsAll && high.rowHeights.reduce((sum, height) => sum + height, 0) <= tableHeight + 1e-3;
      if (highFits) {
        chosenFontSize = upperFontSize;
      } else {
        let lo = lowerFontSize;
        let hi = upperFontSize;
        let best = lowerFontSize;
        for (let index = 0; index < 18; index += 1) {
          const mid = (lo + hi) / 2;
          const attempt = measureTableRowRequirements({
            rows,
            styleById,
            translatedTextByBlock,
            fontSize: mid,
          });
          const midFits = attempt.fitsAll && attempt.rowHeights.reduce((sum, height) => sum + height, 0) <= tableHeight + 1e-3;
          if (midFits) {
            best = mid;
            lo = mid;
          } else {
            hi = mid;
          }
        }
        chosenFontSize = best;
      }
    }

    const requirements = measureTableRowRequirements({
      rows,
      styleById,
      translatedTextByBlock,
      fontSize: chosenFontSize,
    });
    const fitsHeight = requirements.rowHeights.reduce((sum, height) => sum + height, 0) <= tableHeight + 1e-3;

    let rowHeights;
    if (requirements.fitsAll && fitsHeight) {
      rowHeights = [...requirements.rowHeights];
      const slack = tableHeight - rowHeights.reduce((sum, height) => sum + height, 0);
      if (slack > 1e-6) {
        for (let index = 0; index < rowHeights.length; index += 1) {
          rowHeights[index] += slack * (sourceRowHeights[index] / sourceRowTotal);
        }
      }
    } else {
      rowHeights = sourceRowHeights.map((height) => tableHeight * (height / sourceRowTotal));
    }
    if (rowHeights.length > 0) {
      rowHeights[rowHeights.length - 1] = tableHeight - rowHeights.slice(0, -1).reduce((sum, height) => sum + height, 0);
    }

    let cursor = tableTop;
    const rowBBoxes = [];
    for (let index = 0; index < rowHeights.length; index += 1) {
      const rowTop = cursor;
      const rowBottom = index === rowHeights.length - 1 ? tableBottom : rowTop + Math.max(1, rowHeights[index]);
      rowBBoxes.push([rowTop, rowBottom]);
      cursor = rowBottom;
    }

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const [rowTop, rowBottom] = rowBBoxes[index];
      for (const cell of row.cells) {
        const style = styleById.get(cell.style_id);
        const mutable = fittedBySourceId.get(cell.block_id);
        if (!style || !mutable) {
          continue;
        }
        const translatedText = translatedTextByBlock.get(cell.block_id) || cell.text;
        const newBBox = [cell.bbox[0], rowTop, cell.bbox[2], rowBottom];
        const sourceLineCount = sourceLineCountForBlock(cell);
        const sourceClipDefault = Boolean(sourceClipDefaultsById[String(cell.block_id || '')]);
        const attempt = findBestFit(translatedText, {
          bbox: newBBox,
          baseFontSize: chosenFontSize,
          lineSpacing: style.line_spacing,
          minFontSize: chosenFontSize,
          wrapMode: 'word',
          fontWeight: style.weight,
          sourceClipDefault,
          sourceLineCount,
          clipMode: 'auto',
          bboxEdited: false,
        });
        mutable.bbox = newBBox;
        mutable.translated_text = translatedText;
        mutable.lines = attempt.lines;
        mutable.font_size = round(attempt.fontSize, FITTED_FONT_PRECISION);
        mutable.line_height = round(attempt.fontSize * style.line_spacing, FITTED_FONT_PRECISION);
        mutable.overflow = !attempt.fits;
      }
    }
  }
}

function enforceLocalFontHierarchy({
  sourceBlocks,
  styleById,
  sourceClipDefaultsById,
  fittedBlocks,
  minFontSize,
  wrapMode,
  wrapModeOverridesByBlockId = null,
}) {
  const fittedBySourceId = new Map(fittedBlocks.map((block) => [block.source_block_id, block]));
  for (let index = 0; index < sourceBlocks.length - 1; index += 1) {
    const currentSource = sourceBlocks[index];
    const nextSource = sourceBlocks[index + 1];
    if (currentSource.type === 'table_cell' || nextSource.type === 'table_cell') {
      continue;
    }

    const currentStyle = styleById.get(currentSource.style_id);
    const nextStyle = styleById.get(nextSource.style_id);
    if (!currentStyle || !nextStyle || currentStyle.font_size <= nextStyle.font_size) {
      continue;
    }

    const currentFitted = fittedBySourceId.get(currentSource.block_id);
    const nextFitted = fittedBySourceId.get(nextSource.block_id);
    if (!currentFitted || !nextFitted || nextFitted.font_size <= currentFitted.font_size) {
      continue;
    }

    const cappedFontSize = Math.max(minFontSize, currentFitted.font_size);
    const nextWrapMode = wrapModeOverridesByBlockId?.[nextSource.block_id] || wrapMode;
    const sourceLineCount = sourceLineCountForBlock(nextSource);
    const sourceClipDefault = Boolean(sourceClipDefaultsById[String(nextSource.block_id || '')]);
    const constrainedAttempt = findBestFit(nextFitted.translated_text, {
      bbox: nextFitted.bbox,
      baseFontSize: cappedFontSize,
      lineSpacing: nextStyle.line_spacing,
      minFontSize,
      wrapMode: nextWrapMode,
      fontWeight: String(nextFitted.font_weight || nextStyle.weight || 'normal'),
      sourceClipDefault,
      sourceLineCount,
      clipMode: 'auto',
      bboxEdited: false,
    });
    nextFitted.lines = constrainedAttempt.lines;
    nextFitted.font_size = round(constrainedAttempt.fontSize, FITTED_FONT_PRECISION);
    nextFitted.line_height = round(constrainedAttempt.fontSize * nextStyle.line_spacing, FITTED_FONT_PRECISION);
    nextFitted.overflow = !constrainedAttempt.fits;
  }
}

function validateWrapMode(wrapMode) {
  if (wrapMode !== 'none' && wrapMode !== 'word') {
    throw new FittingConfigurationError("wrap_mode must be 'none' or 'word'");
  }
}

export function fitPageLayout(layout, translations, {
  minFontSize = GLOBAL_MIN_FONT_SIZE,
  useBucketFontRatio = false,
  wrapMode = 'none',
  wrapModeOverridesByBlockId = null,
} = {}) {
  validateWrapMode(wrapMode);
  if (layout.document_id !== translations.document_id) {
    throw new FittingConfigurationError('layout and translations document_id mismatch');
  }
  if (layout.page_id !== translations.page_id) {
    throw new FittingConfigurationError('layout and translations page_id mismatch');
  }

  const styleById = new Map((layout.styles || []).map((style) => [style.style_id, style]));
  const sourceClipDefaultsById = sourceClipDefaultsForLayout(layout);
  const translationByBlock = new Map((translations.blocks || []).map((block) => [block.block_id, block]));
  const sourceBlocks = [...(layout.blocks || [])].sort((left, right) => left.reading_order - right.reading_order);
  const fittedBlocks = [];
  const bucketRatiosByBlockId = useBucketFontRatio
    ? computeBucketFontRatioAssignments({
      sourceBlocks,
      styleById,
      translationByBlock,
      sourceClipDefaultsById,
      minFontSize,
      wrapMode,
      wrapModeOverridesByBlockId,
    })
    : null;

  for (let index = 0; index < sourceBlocks.length; index += 1) {
    const sourceBlock = sourceBlocks[index];
    const style = styleById.get(sourceBlock.style_id);
    if (!style) {
      throw new FittingConfigurationError(`source block references missing style: ${sourceBlock.style_id}`);
    }

    const translated = translationByBlock.get(sourceBlock.block_id);
    const translatedText = translated?.translated_text || sourceBlock.text;
    const baseBBox = [...sourceBlock.bbox].map((value) => Number(value));
    const blockWrapMode = wrapModeOverridesByBlockId?.[sourceBlock.block_id] || wrapMode;
    const sourceLineCount = sourceLineCountForBlock(sourceBlock);
    const sourceClipDefault = Boolean(sourceClipDefaultsById[String(sourceBlock.block_id || '')]);
    validateWrapMode(blockWrapMode);

    if (Number(style.font_size) < 1.0) {
      console.warn('[fitting] suspicious base font size before fit', {
        documentId: layout.document_id,
        pageId: layout.page_id,
        blockId: sourceBlock.block_id,
        styleId: sourceBlock.style_id,
        blockType: sourceBlock.type,
        text: String(translatedText || '').slice(0, 200),
        bbox: baseBBox,
        baseFontSize: Number(style.font_size),
        lineSpacing: Number(style.line_spacing),
        minFontSize,
        wrapMode: blockWrapMode,
      });
    }

    const bucketRatio = bucketRatiosByBlockId?.get(sourceBlock.block_id) ?? 1.0;
    const nominalFontSize = Math.max(minFontSize, Number(style.font_size) * bucketRatio);
    const attempt = useBucketFontRatio === true
      ? layoutText(translatedText, {
        bbox: baseBBox,
        fontSize: nominalFontSize,
        lineSpacing: style.line_spacing,
        wrapMode: blockWrapMode,
        fontWeight: style.weight,
        sourceClipDefault,
        sourceLineCount,
        clipMode: 'auto',
        bboxEdited: false,
      })
      : findBestFit(translatedText, {
        bbox: baseBBox,
        baseFontSize: style.font_size,
        lineSpacing: style.line_spacing,
        minFontSize,
        wrapMode: blockWrapMode,
        fontWeight: style.weight,
        sourceClipDefault,
        sourceLineCount,
        clipMode: 'auto',
        bboxEdited: false,
      });

    fittedBlocks.push({
      block_id: `p${layout.page_id}_f${index + 1}`,
      source_block_id: sourceBlock.block_id,
      page_id: layout.page_id,
      style_id: sourceBlock.style_id,
      bbox: baseBBox,
      pre_fit_bbox: [...baseBBox],
      translated_text: translatedText,
      lines: attempt.lines,
      font_size: round(attempt.fontSize, FITTED_FONT_PRECISION),
      line_height: round(attempt.fontSize * style.line_spacing, FITTED_FONT_PRECISION),
      overflow: !attempt.fits,
      fit_strategy: useBucketFontRatio === true ? 'bucket_ratio' : undefined,
      bucket_ratio: useBucketFontRatio === true ? round(bucketRatio, 4) : undefined,
      nominal_font_size: useBucketFontRatio === true ? round(nominalFontSize, FITTED_FONT_PRECISION) : undefined,
      text_tightness: String(sourceBlock?.text_tightness || ''),
      collision: false,
      collides_with: [],
    });
  }

  if (useBucketFontRatio !== true) {
    applyUniformTableFit({
      sourceBlocks,
      styleById,
      translationByBlock,
      sourceClipDefaultsById,
      fittedBlocks,
      minFontSize,
    });
  }

  if (useBucketFontRatio !== true) {
    enforceLocalFontHierarchy({
      sourceBlocks,
      styleById,
      sourceClipDefaultsById,
      fittedBlocks,
      minFontSize,
      wrapMode,
      wrapModeOverridesByBlockId,
    });
  }

  const tableSourceBlockIds = new Set(
    sourceBlocks
      .filter((block) => block.type === 'table_cell')
      .map((block) => block.block_id),
  );
  markCollisions(fittedBlocks, { tableSourceBlockIds });

  return {
    schema_version: SCHEMA_VERSION,
    stage: STAGE_FITTED_BLOCKS,
    document_id: layout.document_id,
    page_id: layout.page_id,
    page_size_pt: layout.page_size_pt,
    blocks: fittedBlocks,
  };
}

export function fitPageLayouts(layouts, translationsByPage, options = {}) {
  return layouts.map((layout) => {
    const translations = translationsByPage.get
      ? translationsByPage.get(layout.page_id)
      : translationsByPage[layout.page_id];
    if (!translations) {
      throw new FittingConfigurationError(`missing translations for page ${layout.page_id}`);
    }
    return fitPageLayout(layout, translations, options);
  });
}
