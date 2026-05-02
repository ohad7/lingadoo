import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import mupdf from 'mupdf';

import { buildMirroredPageRenderPlan, mirrorBBox } from './mirrorRenderPlan.js';
import { collectMirroredTextDrawOperations } from './mirrorTextPlan.js';

export const PORT_STATUS = {
  PORTED_TESTED: 'ported_tested',
  PORTED_UNTESTED: 'ported_untested',
  PARTIAL: 'partial',
  STUB: 'stub',
};

export class MirrorStageConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MirrorStageConfigurationError';
  }
}

const TABLE_REBUILD_COVERAGE_THRESHOLD = 0.85;
const TABLE_BACKGROUND_CLEAR_MARGIN_PT = 0.8;
const TABLE_FILL_SAMPLE_TRIM_FRACTION = 0.15;
const TABLE_FILL_SAMPLE_QUANTIZATION = 8;
const TABLE_FILL_DOMINANT_MIN_RATIO = 0.12;
const TABLE_ROW_FILL_MAX_DEVIATION = 0.18;
const TRANSLATED_TEXT_DEFAULT_MIN_FONT_SIZE = 5.0;
const TRANSLATED_TEXT_IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];
const LIBERATION_SANS_REGULAR_URL = new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url);
const LIBERATION_SANS_BOLD_URL = new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf', import.meta.url);
const LIBERATION_SANS_ITALIC_URL = new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf', import.meta.url);
const LIBERATION_SANS_BOLD_ITALIC_URL = new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf', import.meta.url);
const SHARED_PREVIEW_REGULAR_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
];
const SHARED_PREVIEW_BOLD_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
];
const SHARED_PREVIEW_ITALIC_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Italic.ttf',
  '/Library/Fonts/Arial Italic.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf',
];
const SHARED_PREVIEW_BOLD_ITALIC_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf',
  '/Library/Fonts/Arial Bold Italic.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-BoldItalic.ttf',
];

const translatedPdfFontBytesCache = new Map();
const translatedPdfFontObjectCache = new Map();

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function rectWidth(bbox) {
  return Math.max(0, Number(bbox[2]) - Number(bbox[0]));
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

function validBBox(bbox) {
  return rectWidth(bbox) > 0 && rectHeight(bbox) > 0;
}

function bboxArea(bbox) {
  return rectWidth(bbox) * rectHeight(bbox);
}

function bboxToIntRegion(bbox, width, height) {
  const x0 = Math.max(0, Math.min(width, Math.floor(Number(bbox[0]))));
  const y0 = Math.max(0, Math.min(height, Math.floor(Number(bbox[1]))));
  const x1 = Math.max(0, Math.min(width, Math.ceil(Number(bbox[2]))));
  const y1 = Math.max(0, Math.min(height, Math.ceil(Number(bbox[3]))));
  return [x0, y0, x1, y1];
}

function bboxToPixelBounds(bbox, {
  pageWidth,
  pageHeight,
  canvasWidth,
  canvasHeight,
  paddingPoints = 0.75,
}) {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }
  const xScale = canvasWidth / pageWidth;
  const yScale = canvasHeight / pageHeight;
  const x0 = Math.max(0, Math.min(canvasWidth, Math.floor((Number(bbox[0]) - paddingPoints) * xScale)));
  const y0 = Math.max(0, Math.min(canvasHeight, Math.floor((Number(bbox[1]) - paddingPoints) * yScale)));
  const x1 = Math.max(0, Math.min(canvasWidth, Math.ceil((Number(bbox[2]) + paddingPoints) * xScale)));
  const y1 = Math.max(0, Math.min(canvasHeight, Math.ceil((Number(bbox[3]) + paddingPoints) * yScale)));
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return [x0, y0, x1, y1];
}

function ptRectToPx(bbox, scaleX, scaleY) {
  return [
    Number(bbox[0]) * scaleX,
    Number(bbox[1]) * scaleY,
    Number(bbox[2]) * scaleX,
    Number(bbox[3]) * scaleY,
  ];
}

function fillCanvasIntRegion(ctx, bboxPx, color01) {
  const [x0, y0, x1, y1] = bboxToIntRegion(bboxPx, ctx.canvas.width, ctx.canvas.height);
  if (x1 <= x0 || y1 <= y0) {
    return;
  }
  const imageData = ctx.createImageData(x1 - x0, y1 - y0);
  const red = Math.max(0, Math.min(255, Math.round(color01[0] * 255)));
  const green = Math.max(0, Math.min(255, Math.round(color01[1] * 255)));
  const blue = Math.max(0, Math.min(255, Math.round(color01[2] * 255)));
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = red;
    imageData.data[index + 1] = green;
    imageData.data[index + 2] = blue;
    imageData.data[index + 3] = 255;
  }
  ctx.putImageData(imageData, x0, y0);
}

function unionBBox(bboxes) {
  return [
    Math.min(...bboxes.map((bbox) => Number(bbox[0]))),
    Math.min(...bboxes.map((bbox) => Number(bbox[1]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[2]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[3]))),
  ];
}

function rectanglesUnionArea(rectangles) {
  const valid = rectangles.filter((rect) => validBBox(rect));
  if (valid.length === 0) {
    return 0;
  }
  const xs = [...new Set(valid.flatMap((rect) => [Number(rect[0]), Number(rect[2])]))].sort((left, right) => left - right);
  if (xs.length < 2) {
    return 0;
  }
  let totalArea = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const x0 = xs[index];
    const x1 = xs[index + 1];
    if (x1 <= x0) {
      continue;
    }
    const yIntervals = valid
      .filter((rect) => Number(rect[0]) < x1 && Number(rect[2]) > x0)
      .map((rect) => [Number(rect[1]), Number(rect[3])])
      .sort((left, right) => (left[0] - right[0]) || (left[1] - right[1]));
    if (yIntervals.length === 0) {
      continue;
    }
    const merged = [];
    for (const [y0, y1] of yIntervals) {
      if (merged.length === 0 || y0 > merged[merged.length - 1][1]) {
        merged.push([y0, y1]);
      } else {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], y1);
      }
    }
    const totalHeight = merged.reduce((sum, [y0, y1]) => sum + Math.max(0, y1 - y0), 0);
    totalArea += (x1 - x0) * totalHeight;
  }
  return totalArea;
}

function inflateBBox(bbox, { inset, pageWidth, pageHeight }) {
  return [
    Math.max(0, Number(bbox[0]) - inset),
    Math.max(0, Number(bbox[1]) - inset),
    Math.min(pageWidth, Number(bbox[2]) + inset),
    Math.min(pageHeight, Number(bbox[3]) + inset),
  ];
}

function bboxConnected(left, right, tolerance = 1.5) {
  const overlapX = Math.min(Number(left[2]), Number(right[2])) - Math.max(Number(left[0]), Number(right[0]));
  const overlapY = Math.min(Number(left[3]), Number(right[3])) - Math.max(Number(left[1]), Number(right[1]));
  const gapX = Math.max(0, Math.max(Number(left[0]), Number(right[0])) - Math.min(Number(left[2]), Number(right[2])));
  const gapY = Math.max(0, Math.max(Number(left[1]), Number(right[1])) - Math.min(Number(left[3]), Number(right[3])));
  const xOk = overlapX > 0 || gapX <= tolerance;
  const yOk = overlapY > 0 || gapY <= tolerance;
  return xOk && yOk;
}

function unionBBoxForIds(ids, cellBboxesById) {
  return unionBBox(ids.map((cellId) => cellBboxesById[cellId]));
}

function verticalOverlapRatio(left, right) {
  const overlap = Math.min(Number(left[3]), Number(right[3])) - Math.max(Number(left[1]), Number(right[1]));
  if (overlap <= 0) {
    return 0;
  }
  const minHeight = Math.min(
    Number(left[3]) - Number(left[1]),
    Number(right[3]) - Number(right[1]),
  );
  if (minHeight <= 0) {
    return 0;
  }
  return overlap / minHeight;
}

function groupTableComponentCellIdsWithTolerance(cellBboxesById, { tolerance }) {
  const groups = [];
  for (const [blockId, bbox] of Object.entries(cellBboxesById)) {
    let matchedGroupIndex = null;
    for (let index = 0; index < groups.length; index += 1) {
      if (groups[index].some((peerId) => bboxConnected(bbox, cellBboxesById[peerId], tolerance))) {
        matchedGroupIndex = index;
        break;
      }
    }
    if (matchedGroupIndex === null) {
      groups.push([blockId]);
      continue;
    }
    groups[matchedGroupIndex].push(blockId);
    let merged = true;
    while (merged) {
      merged = false;
      const base = groups[matchedGroupIndex];
      for (let otherIndex = groups.length - 1; otherIndex >= 0; otherIndex -= 1) {
        if (otherIndex === matchedGroupIndex) {
          continue;
        }
        const other = groups[otherIndex];
        if (base.some((leftId) => other.some((rightId) => (
          bboxConnected(cellBboxesById[leftId], cellBboxesById[rightId], tolerance)
        )))) {
          base.push(...other);
          groups.splice(otherIndex, 1);
          if (otherIndex < matchedGroupIndex) {
            matchedGroupIndex -= 1;
          }
          merged = true;
        }
      }
      groups[matchedGroupIndex] = base;
    }
  }
  return groups;
}

function mergeAdjacentNarrowTableComponentGroups(groups, cellBboxesById) {
  if (groups.length < 2) {
    return groups;
  }
  const mergedGroups = groups.map((group) => [...group]);
  let changed = true;
  while (changed) {
    changed = false;
    mergedGroups.sort((leftIds, rightIds) => {
      const leftBBox = unionBBoxForIds(leftIds, cellBboxesById);
      const rightBBox = unionBBoxForIds(rightIds, cellBboxesById);
      return (leftBBox[1] - rightBBox[1]) || (leftBBox[0] - rightBBox[0]);
    });
    for (let index = 0; index < mergedGroups.length - 1; index += 1) {
      const leftIds = mergedGroups[index];
      const rightIds = mergedGroups[index + 1];
      const leftBBox = unionBBoxForIds(leftIds, cellBboxesById);
      const rightBBox = unionBBoxForIds(rightIds, cellBboxesById);
      const overlapRatio = verticalOverlapRatio(leftBBox, rightBBox);
      if (overlapRatio < 0.6) {
        continue;
      }
      const gapX = Math.max(
        0,
        Math.max(Number(leftBBox[0]), Number(rightBBox[0])) - Math.min(Number(leftBBox[2]), Number(rightBBox[2])),
      );
      const leftWidth = Number(leftBBox[2]) - Number(leftBBox[0]);
      const rightWidth = Number(rightBBox[2]) - Number(rightBBox[0]);
      const smallerWidth = Math.min(leftWidth, rightWidth);
      const smallerCount = Math.min(leftIds.length, rightIds.length);
      const gapLimit = Math.max(24.0, Math.min(smallerWidth * 2.5, 80.0));
      if (gapX > gapLimit) {
        continue;
      }
      if (smallerWidth > 60.0 && smallerCount > 3) {
        continue;
      }
      mergedGroups[index] = [...leftIds, ...rightIds];
      mergedGroups.splice(index + 1, 1);
      changed = true;
      break;
    }
  }
  return mergedGroups;
}

function rgb01ToCss(color) {
  return `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
}

function hexToRgb01(color) {
  const value = String(color || '').trim().replace(/^#/, '');
  if (value.length !== 6) {
    return [0, 0, 0];
  }
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function luminance(color) {
  return (color[0] * 0.2126) + (color[1] * 0.7152) + (color[2] * 0.0722);
}

function clusterEdgeCenters(values, tolerance) {
  if (values.length === 0) {
    return [];
  }
  const sortedValues = [...values].sort((a, b) => a - b);
  const clusters = [[sortedValues[0]]];
  for (const value of sortedValues.slice(1)) {
    const cluster = clusters[clusters.length - 1];
    if (Math.abs(value - cluster[cluster.length - 1]) <= tolerance) {
      cluster.push(value);
    } else {
      clusters.push([value]);
    }
  }
  return clusters
    .map((cluster) => Number((cluster.reduce((sum, value) => sum + value, 0) / cluster.length).toFixed(3)))
    .sort((a, b) => a - b);
}

function snapToReference(value, references, tolerance) {
  if (!references.length) {
    return value;
  }
  const nearest = references.reduce((best, candidate) => (
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  ), references[0]);
  if (Math.abs(nearest - value) <= tolerance) {
    return nearest;
  }
  return value;
}

function sourceSpaceTableBBox(bbox, { pageWidth, mirrorTextBboxes }) {
  const renderSpaceBBox = mirrorTextBboxes ? mirrorBBox(bbox, pageWidth) : [...bbox];
  const sourceSpaceBBox = mirrorBBox(renderSpaceBBox, pageWidth);
  return [
    Math.min(sourceSpaceBBox[0], sourceSpaceBBox[2]),
    Math.min(sourceSpaceBBox[1], sourceSpaceBBox[3]),
    Math.max(sourceSpaceBBox[0], sourceSpaceBBox[2]),
    Math.max(sourceSpaceBBox[1], sourceSpaceBBox[3]),
  ];
}

function resolveRenderBBox(bbox, { pageWidth, mirrorTextBboxes }) {
  if (!mirrorTextBboxes) {
    return [...bbox];
  }
  return mirrorBBox(bbox, pageWidth);
}

function groupTableComponentCellIds(cellBboxesById) {
  let groups = groupTableComponentCellIdsWithTolerance(cellBboxesById, { tolerance: 1.5 });
  if (groups.length >= 8 && groups.every((group) => group.length === 1)) {
    groups = groupTableComponentCellIdsWithTolerance(cellBboxesById, { tolerance: 20.0 });
  }
  return mergeAdjacentNarrowTableComponentGroups(groups, cellBboxesById);
}

function groupTableCells(cells) {
  const groups = [];
  for (const cell of cells) {
    let matchedGroupIndex = null;
    for (let index = 0; index < groups.length; index += 1) {
      if (groups[index].some((peer) => bboxConnected(cell.source_bbox, peer.source_bbox))) {
        matchedGroupIndex = index;
        break;
      }
    }
    if (matchedGroupIndex === null) {
      groups.push([cell]);
      continue;
    }
    groups[matchedGroupIndex].push(cell);
    let merged = true;
    while (merged) {
      merged = false;
      const base = groups[matchedGroupIndex];
      for (let otherIndex = groups.length - 1; otherIndex >= 0; otherIndex -= 1) {
        if (otherIndex === matchedGroupIndex) {
          continue;
        }
        const other = groups[otherIndex];
        if (base.some((left) => other.some((right) => bboxConnected(left.source_bbox, right.source_bbox)))) {
          base.push(...other);
          groups.splice(otherIndex, 1);
          if (otherIndex < matchedGroupIndex) {
            matchedGroupIndex -= 1;
          }
          merged = true;
        }
      }
      groups[matchedGroupIndex] = base;
    }
  }
  return groups;
}

function tableCellInnerBBox(bbox, inset = 1.0) {
  if (rectWidth(bbox) <= inset * 2 || rectHeight(bbox) <= inset * 2) {
    return [...bbox];
  }
  return [
    Number(bbox[0]) + inset,
    Number(bbox[1]) + inset,
    Number(bbox[2]) - inset,
    Number(bbox[3]) - inset,
  ];
}

function sampleRegionData(ctx, bboxPx) {
  const [x0, y0, x1, y1] = bboxToIntRegion(bboxPx, ctx.canvas.width, ctx.canvas.height);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return {
    x0,
    y0,
    x1,
    y1,
    imageData: ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data,
  };
}

function sampleRegionFillColor(sourceCtx, bbox, scaleX, scaleY) {
  const sampled = sampleRegionData(sourceCtx, ptRectToPx(bbox, scaleX, scaleY));
  if (!sampled) {
    return [1, 1, 1];
  }
  const { imageData } = sampled;
  const pixels = [];
  for (let index = 0; index < imageData.length; index += 4) {
    const red = imageData[index];
    const green = imageData[index + 1];
    const blue = imageData[index + 2];
    const lum = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    pixels.push([lum, red, green, blue]);
  }
  if (pixels.length === 0) {
    return [1, 1, 1];
  }
  const ordered = [...pixels].sort((left, right) => left[0] - right[0]);
  const trimCount = Math.floor(ordered.length * TABLE_FILL_SAMPLE_TRIM_FRACTION);
  let filtered = ordered;
  if (trimCount > 0 && (trimCount * 2) < ordered.length) {
    filtered = ordered.slice(trimCount, ordered.length - trimCount);
  }
  if (filtered.length === 0) {
    filtered = ordered;
  }

  const bucketCounts = new Map();
  const bucketSums = new Map();
  const quantization = Math.max(1, TABLE_FILL_SAMPLE_QUANTIZATION);
  for (const [, red, green, blue] of filtered) {
    const key = `${Math.floor(red / quantization)}:${Math.floor(green / quantization)}:${Math.floor(blue / quantization)}`;
    bucketCounts.set(key, (bucketCounts.get(key) || 0) + 1);
    if (!bucketSums.has(key)) {
      bucketSums.set(key, [0, 0, 0]);
    }
    const sums = bucketSums.get(key);
    sums[0] += red;
    sums[1] += green;
    sums[2] += blue;
  }

  if (bucketCounts.size > 0) {
    const [dominantKey, dominantCount] = [...bucketCounts.entries()].reduce((best, entry) => (
      entry[1] > best[1] ? entry : best
    ));
    const dominantRatio = dominantCount / Math.max(1, filtered.length);
    if (dominantRatio >= TABLE_FILL_DOMINANT_MIN_RATIO) {
      const sums = bucketSums.get(dominantKey);
      return [
        sums[0] / dominantCount / 255,
        sums[1] / dominantCount / 255,
        sums[2] / dominantCount / 255,
      ];
    }
  }

  const totalPixels = Math.max(1, filtered.length);
  return [
    filtered.reduce((sum, [, red]) => sum + red, 0) / totalPixels / 255,
    filtered.reduce((sum, [, , green]) => sum + green, 0) / totalPixels / 255,
    filtered.reduce((sum, [, , , blue]) => sum + blue, 0) / totalPixels / 255,
  ];
}

function sampleRegionBorderColor(sourceCtx, bbox, scaleX, scaleY) {
  const sampled = sampleRegionData(sourceCtx, ptRectToPx(bbox, scaleX, scaleY));
  if (!sampled) {
    return [0.25, 0.25, 0.25];
  }
  const { x0, y0, x1, y1, imageData } = sampled;
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 1 || height <= 1) {
    return [0.25, 0.25, 0.25];
  }
  const borderSamples = [];
  const pixelRgb = (x, y) => {
    const offset = (y * width + x) * 4;
    return [imageData[offset], imageData[offset + 1], imageData[offset + 2]];
  };
  for (let x = 0; x < width; x += 1) {
    borderSamples.push(pixelRgb(x, 0));
    borderSamples.push(pixelRgb(x, height - 1));
  }
  for (let y = 0; y < height; y += 1) {
    borderSamples.push(pixelRgb(0, y));
    borderSamples.push(pixelRgb(width - 1, y));
  }
  if (borderSamples.length === 0) {
    return [0.25, 0.25, 0.25];
  }
  borderSamples.sort((left, right) => (
    (left[0] + left[1] + left[2]) - (right[0] + right[1] + right[2])
  ));
  const sampleCount = Math.max(1, Math.floor(borderSamples.length / 40));
  const darkest = borderSamples.slice(0, sampleCount);
  return [
    darkest.reduce((sum, value) => sum + value[0], 0) / (255 * sampleCount),
    darkest.reduce((sum, value) => sum + value[1], 0) / (255 * sampleCount),
    darkest.reduce((sum, value) => sum + value[2], 0) / (255 * sampleCount),
  ];
}

function sampleBackgroundNearBBox(sourceCtx, bbox, { pageWidth, pageHeight, scaleX, scaleY }) {
  const [x0, y0, x1, y1] = bbox;
  const candidates = [
    [Math.max(0, x0 - 6), Math.max(0, y0 - 6), Math.max(0, x0 - 1), Math.max(0, y0 - 1)],
    [x1 + 1, Math.max(0, y0 - 6), Math.min(pageWidth, x1 + 6), Math.max(0, y0 - 1)],
    [Math.max(0, x0 - 6), y1 + 1, Math.max(0, x0 - 1), Math.min(pageHeight, y1 + 6)],
    [x1 + 1, y1 + 1, Math.min(pageWidth, x1 + 6), Math.min(pageHeight, y1 + 6)],
  ];
  for (const candidate of candidates) {
    if (!validBBox(candidate)) {
      continue;
    }
    return sampleRegionFillColor(sourceCtx, candidate, scaleX, scaleY);
  }
  return [1, 1, 1];
}

function medianColor(samples) {
  if (samples.length === 0) {
    return [0, 0, 0];
  }
  const channels = [
    samples.map((sample) => sample[0]).sort((a, b) => a - b),
    samples.map((sample) => sample[1]).sort((a, b) => a - b),
    samples.map((sample) => sample[2]).sort((a, b) => a - b),
  ];
  return channels.map((ordered) => {
    const mid = Math.floor(ordered.length / 2);
    if ((ordered.length % 2) === 1) {
      return ordered[mid];
    }
    return (ordered[mid - 1] + ordered[mid]) / 2;
  });
}

function componentTrackIntervals(cells, axis, tolerance = 1.3) {
  if (cells.length === 0) {
    return [];
  }
  const edgeValues = cells.flatMap((cell) => (
    axis === 'x'
      ? [Number(cell.render_bbox[0].toFixed(3)), Number(cell.render_bbox[2].toFixed(3))]
      : [Number(cell.render_bbox[1].toFixed(3)), Number(cell.render_bbox[3].toFixed(3))]
  ));
  const refs = clusterEdgeCenters(edgeValues, tolerance);
  if (refs.length < 2) {
    return [];
  }
  const intervals = [];
  for (let index = 0; index < refs.length - 1; index += 1) {
    const start = refs[index];
    const end = refs[index + 1];
    if (end <= start) {
      continue;
    }
    const intersects = cells.some((cell) => (
      axis === 'x'
        ? Number(cell.render_bbox[0]) < end - 1e-3 && Number(cell.render_bbox[2]) > start + 1e-3
        : Number(cell.render_bbox[1]) < end - 1e-3 && Number(cell.render_bbox[3]) > start + 1e-3
    ));
    if (intersects) {
      intervals.push([start, end]);
    }
  }
  return intervals;
}

function trackSpanForInterval(start, end, tracks) {
  if (tracks.length === 0) {
    return [0, 1];
  }
  const hitIndices = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => end > track[0] + 1e-3 && start < track[1] - 1e-3)
    .map(({ index }) => index);
  if (hitIndices.length === 0) {
    const center = (start + end) / 2;
    const nearest = tracks.reduce((bestIndex, track, index) => {
      const bestCenter = (tracks[bestIndex][0] + tracks[bestIndex][1]) / 2;
      const trackCenter = (track[0] + track[1]) / 2;
      return Math.abs(trackCenter - center) < Math.abs(bestCenter - center) ? index : bestIndex;
    }, 0);
    return [nearest, nearest + 1];
  }
  return [Math.min(...hitIndices), Math.max(...hitIndices) + 1];
}

function collectTableEdgeSegments(cells) {
  const edgeQuantum = 0.15;
  const edgeSegments = new Map();
  const edgeKey = (orientation, fixed, start, end) => {
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    return [
      orientation,
      Math.round(fixed / edgeQuantum),
      Math.round(lo / edgeQuantum),
      Math.round(hi / edgeQuantum),
    ].join(':');
  };

  for (const cell of cells) {
    const [x0, y0, x1, y1] = cell.render_bbox;
    const edges = [
      ['h', y0, x0, x1, [x0, y0], [x1, y0]],
      ['h', y1, x0, x1, [x0, y1], [x1, y1]],
      ['v', x0, y0, y1, [x0, y0], [x0, y1]],
      ['v', x1, y0, y1, [x1, y0], [x1, y1]],
    ];
    for (const [orientation, fixed, start, end, p0, p1] of edges) {
      const key = edgeKey(orientation, fixed, start, end);
      const existing = edgeSegments.get(key);
      if (!existing) {
        edgeSegments.set(key, {
          orientation,
          start: p0,
          end: p1,
          color: cell.border_color,
          width: cell.border_width,
        });
        continue;
      }
      const chosenColor = luminance(cell.border_color) < luminance(existing.color)
        ? cell.border_color
        : existing.color;
      edgeSegments.set(key, {
        orientation,
        start: existing.start,
        end: existing.end,
        color: chosenColor,
        width: Math.max(existing.width, cell.border_width),
      });
    }
  }
  return [...edgeSegments.values()];
}

function expandWithImplicitTableCells(mirroredCells) {
  if (mirroredCells.length === 0) {
    return [];
  }
  const expanded = new Map(mirroredCells.map((cell) => [cell.source_block_id, cell]));
  const grouped = groupTableCells(mirroredCells);

  grouped.forEach((group, groupIndex) => {
    if (group.length === 0) {
      return;
    }
    const rows = componentTrackIntervals(group, 'y');
    const columns = componentTrackIntervals(group, 'x');
    if (rows.length === 0 || columns.length === 0) {
      return;
    }
    const occupancy = rows.map(() => columns.map(() => false));
    const rowFillSamples = new Map(rows.map((_, index) => [index, []]));
    const rowFillCandidates = new Map(rows.map((_, index) => [index, []]));
    const cellRowSpans = new Map();

    for (const cell of group) {
      const [rowStart, rowEnd] = trackSpanForInterval(cell.render_bbox[1], cell.render_bbox[3], rows);
      const [columnStart, columnEnd] = trackSpanForInterval(cell.render_bbox[0], cell.render_bbox[2], columns);
      cellRowSpans.set(cell.source_block_id, [rowStart, rowEnd]);
      const cellCenterX = (Number(cell.render_bbox[0]) + Number(cell.render_bbox[2])) / 2;
      for (let rowIndex = Math.max(0, rowStart); rowIndex < Math.min(rows.length, rowEnd); rowIndex += 1) {
        if (cell.fill_enabled) {
          rowFillSamples.get(rowIndex).push(cell.fill_color);
        }
        rowFillCandidates.get(rowIndex).push([cellCenterX, cell.fill_color, cell.fill_enabled]);
        for (let columnIndex = Math.max(0, columnStart); columnIndex < Math.min(columns.length, columnEnd); columnIndex += 1) {
          occupancy[rowIndex][columnIndex] = true;
        }
      }
    }

    const rowFillProfiles = new Map();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const samples = rowFillSamples.get(rowIndex);
      if (!samples || samples.length === 0) {
        rowFillProfiles.set(rowIndex, null);
        continue;
      }
      const representative = medianColor(samples);
      const maxDeviation = Math.max(
        ...samples.map((sample) => (
          Math.abs(sample[0] - representative[0])
          + Math.abs(sample[1] - representative[1])
          + Math.abs(sample[2] - representative[2])
        )),
      );
      if (maxDeviation <= TABLE_ROW_FILL_MAX_DEVIATION) {
        rowFillProfiles.set(rowIndex, [representative, true]);
      } else {
        rowFillProfiles.set(rowIndex, null);
      }
    }

    for (const cell of group) {
      if (!cell.fill_enabled) {
        continue;
      }
      const [rowStart, rowEnd] = cellRowSpans.get(cell.source_block_id) || [0, 0];
      const rowRepresentatives = [];
      for (let rowIndex = Math.max(0, rowStart); rowIndex < Math.min(rows.length, rowEnd); rowIndex += 1) {
        const profile = rowFillProfiles.get(rowIndex);
        if (profile) {
          rowRepresentatives.push(profile[0]);
        }
      }
      if (rowRepresentatives.length === 0) {
        continue;
      }
      const harmonizedColor = medianColor(rowRepresentatives);
      const deviation = (
        Math.abs(cell.fill_color[0] - harmonizedColor[0])
        + Math.abs(cell.fill_color[1] - harmonizedColor[1])
        + Math.abs(cell.fill_color[2] - harmonizedColor[2])
      );
      if (deviation > TABLE_ROW_FILL_MAX_DEVIATION) {
        continue;
      }
      expanded.set(cell.source_block_id, {
        ...cell,
        fill_color: harmonizedColor,
        fill_enabled: true,
      });
    }

    const borderReference = [...group].sort((left, right) => {
      const leftKey = [luminance(left.border_color), left.border_width];
      const rightKey = [luminance(right.border_color), right.border_width];
      return (leftKey[0] - rightKey[0]) || (leftKey[1] - rightKey[1]);
    })[0];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        if (occupancy[rowIndex][columnIndex]) {
          continue;
        }
        const [x0, x1] = columns[columnIndex];
        const [y0, y1] = rows[rowIndex];
        if ((x1 <= x0 + 0.1) || (y1 <= y0 + 0.1)) {
          continue;
        }
        let inheritedFillColor = [0, 0, 0];
        let inheritedFillEnabled = false;
        const profile = rowFillProfiles.get(rowIndex);
        if (profile) {
          [inheritedFillColor, inheritedFillEnabled] = profile;
        } else {
          const candidates = rowFillCandidates.get(rowIndex) || [];
          if (candidates.length > 0) {
            const targetCenterX = (x0 + x1) / 2;
            const nearest = candidates.reduce((best, candidate) => (
              Math.abs(candidate[0] - targetCenterX) < Math.abs(best[0] - targetCenterX) ? candidate : best
            ));
            inheritedFillColor = nearest[1];
            inheritedFillEnabled = Boolean(nearest[2]);
          }
        }
        const syntheticId = `__implicit_tc${groupIndex + 1}_r${rowIndex}_c${columnIndex}`;
        expanded.set(syntheticId, {
          source_block_id: syntheticId,
          source_bbox: [x0, y0, x1, y1],
          render_bbox: [x0, y0, x1, y1],
          fill_color: inheritedFillColor,
          fill_enabled: inheritedFillEnabled,
          border_color: borderReference.border_color,
          border_width: borderReference.border_width,
        });
      }
    }
  });

  return [...expanded.values()];
}

function drawAxisAlignedBorderSegment(ctx, border, { scaleX, scaleY }) {
  const avgScale = (scaleX + scaleY) / 2;
  const thicknessPx = Math.max(1, border.width * avgScale);
  const startX = border.start[0] * scaleX;
  const startY = border.start[1] * scaleY;
  const endX = border.end[0] * scaleX;
  const endY = border.end[1] * scaleY;
  ctx.fillStyle = rgb01ToCss(border.color);

  if (border.orientation === 'horizontal') {
    const x0 = Math.min(startX, endX);
    const x1 = Math.max(startX, endX);
    const y0 = startY - (thicknessPx / 2);
    fillCanvasIntRegion(ctx, [x0, y0, x1, y0 + thicknessPx], border.color);
    return;
  }
  if (border.orientation === 'vertical') {
    const y0 = Math.min(startY, endY);
    const y1 = Math.max(startY, endY);
    const x0 = startX - (thicknessPx / 2);
    fillCanvasIntRegion(ctx, [x0, y0, x0 + thicknessPx, y1], border.color);
    return;
  }
}

function toUint8Array(pdfData) {
  if (pdfData instanceof Uint8Array) {
    return pdfData;
  }
  if (pdfData instanceof ArrayBuffer) {
    return new Uint8Array(pdfData);
  }
  if (Buffer.isBuffer(pdfData)) {
    return new Uint8Array(pdfData);
  }
  throw new MirrorStageConfigurationError('pdfData must be an ArrayBuffer, Buffer, or Uint8Array');
}

function openDocument(pdfData) {
  return mupdf.Document.openDocument(toUint8Array(pdfData), 'application/pdf');
}

async function pixmapToCanvas(pixmap) {
  const pngBuffer = Buffer.from(pixmap.asPNG());
  const image = await loadImage(pngBuffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return canvas;
}

function collectTextRedactionRects(page) {
  const structuredText = page.toStructuredText('preserve-whitespace,collect-styles');
  try {
    const parsed = JSON.parse(structuredText.asJSON());
    const rects = [];
    for (const block of parsed.blocks || []) {
      if (block.type !== 'text') {
        continue;
      }
      for (const line of block.lines || []) {
        const bbox = line?.bbox;
        if (!bbox) {
          continue;
        }
        const rect = [
          Number(bbox.x || 0),
          Number(bbox.y || 0),
          Number((bbox.x || 0) + (bbox.w || 0)),
          Number((bbox.y || 0) + (bbox.h || 0)),
        ];
        if (!validBBox(rect)) {
          continue;
        }
        rects.push(rect);
      }
    }
    return rects;
  } finally {
    structuredText.destroy?.();
  }
}

function renderPagePixmapWithoutText(document, pageIndex, { scale }) {
  const tempDocument = new mupdf.PDFDocument();
  tempDocument.graftPage(0, document, pageIndex);
  const tempPage = tempDocument.loadPage(0);
  try {
    for (const rect of collectTextRedactionRects(tempPage)) {
      const annotation = tempPage.createAnnotation('Redact');
      annotation.setRect(rect);
    }
    tempPage.applyRedactions(
      false,
      mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );
    return tempPage.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
  } finally {
    tempPage.destroy?.();
    tempDocument.destroy?.();
  }
}

async function renderPdfPageToCanvas(pdfData, { pageIndex, scale, ignoreText = false }) {
  const document = openDocument(pdfData);
  try {
    const pixmap = ignoreText
      ? renderPagePixmapWithoutText(document, pageIndex, { scale })
      : document.loadPage(pageIndex).toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
    try {
      return await pixmapToCanvas(pixmap);
    } finally {
      pixmap.destroy?.();
    }
  } finally {
    document.destroy?.();
  }
}

function drawImageRegion(targetCtx, {
  sourceCanvas,
  sourceBBoxPx,
  renderBBoxPx,
}) {
  targetCtx.drawImage(
    sourceCanvas,
    sourceBBoxPx[0],
    sourceBBoxPx[1],
    rectWidth(sourceBBoxPx),
    rectHeight(sourceBBoxPx),
    renderBBoxPx[0],
    renderBBoxPx[1],
    rectWidth(renderBBoxPx),
    rectHeight(renderBBoxPx),
  );
}

async function writeCanvasPng(canvas, outputPath) {
  const buffer = canvas.toBuffer('image/png');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
}

function renderCanvasesToPdf(renderedPages, {
  title = 'mirrored-layout-canvas',
} = {}) {
  const buffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buffer, 'pdf', '');
  try {
    for (const page of renderedPages) {
      const image = new mupdf.Image(page.canvas.toBuffer('image/png'));
      const device = writer.beginPage([0, 0, page.widthPt, page.heightPt]);
      try {
        device.fillImage(image, [page.widthPt, 0, 0, page.heightPt, 0, 0], 1);
      } finally {
        device.close?.();
        image.destroy?.();
        writer.endPage();
      }
    }
    writer.close();
    return Buffer.from(buffer.asUint8Array());
  } finally {
    writer.destroy?.();
  }
}

async function loadTranslatedPdfFontBytes(url) {
  const cacheKey = String(url);
  if (translatedPdfFontBytesCache.has(cacheKey)) {
    return translatedPdfFontBytesCache.get(cacheKey);
  }
  const bytes = await readFile(url);
  translatedPdfFontBytesCache.set(cacheKey, bytes);
  return bytes;
}

async function loadFirstAvailableTranslatedPdfFontBytes(candidates, fallbackUrl) {
  for (const candidate of candidates) {
    try {
      const bytes = await loadTranslatedPdfFontBytes(candidate);
      return {
        fontFile: candidate,
        bytes,
      };
    } catch {
      // Try the next candidate.
    }
  }
  return {
    fontFile: fallbackUrl,
    bytes: await loadTranslatedPdfFontBytes(fallbackUrl),
  };
}

async function resolveTranslatedPdfFontResources() {
  const [
    regularFont,
    boldFont,
    italicFont,
    boldItalicFont,
  ] = await Promise.all([
    loadFirstAvailableTranslatedPdfFontBytes(
      SHARED_PREVIEW_REGULAR_FONT_CANDIDATES,
      LIBERATION_SANS_REGULAR_URL,
    ),
    loadFirstAvailableTranslatedPdfFontBytes(
      SHARED_PREVIEW_BOLD_FONT_CANDIDATES,
      LIBERATION_SANS_BOLD_URL,
    ),
    loadFirstAvailableTranslatedPdfFontBytes(
      SHARED_PREVIEW_ITALIC_FONT_CANDIDATES,
      LIBERATION_SANS_ITALIC_URL,
    ),
    loadFirstAvailableTranslatedPdfFontBytes(
      SHARED_PREVIEW_BOLD_ITALIC_FONT_CANDIDATES,
      LIBERATION_SANS_BOLD_ITALIC_URL,
    ),
  ]);
  return {
    regularFamily: 'PDEbrewTranslatedRegular',
    boldFamily: 'PDEbrewTranslatedBold',
    regularFontFile: regularFont.fontFile,
    boldFontFile: boldFont.fontFile,
    regularData: regularFont.bytes,
    boldData: boldFont.bytes,
    italicData: italicFont.bytes,
    boldItalicData: boldItalicFont.bytes,
  };
}

function resolvePdfOverlayFontSpec({ weight = 'normal', italic = false } = {}) {
  const normalizedWeight = String(weight) === 'bold' ? 'bold' : 'normal';
  if (normalizedWeight === 'bold' && italic) {
    return {
      cacheKey: 'liberation-bold-italic',
      fontName: 'PDEbrewPDFBoldItalic',
      builtinName: 'Helvetica-BoldOblique',
      dataKey: 'boldItalicData',
    };
  }
  if (normalizedWeight === 'bold') {
    return {
      cacheKey: 'liberation-bold',
      fontName: 'PDEbrewPDFBold',
      builtinName: 'Helvetica-Bold',
      dataKey: 'boldData',
    };
  }
  if (italic) {
    return {
      cacheKey: 'liberation-italic',
      fontName: 'PDEbrewPDFItalic',
      builtinName: 'Helvetica-Oblique',
      dataKey: 'italicData',
    };
  }
  return {
    cacheKey: 'liberation-regular',
    fontName: 'PDEbrewPDFRegular',
    builtinName: 'Helvetica',
    dataKey: 'regularData',
  };
}

function loadTranslatedPdfFont(fontResources, { weight = 'normal', italic = false } = {}) {
  const spec = resolvePdfOverlayFontSpec({ weight, italic });
  if (translatedPdfFontObjectCache.has(spec.cacheKey)) {
    return translatedPdfFontObjectCache.get(spec.cacheKey);
  }
  let font = null;
  try {
    const fontData = fontResources?.[spec.dataKey] || null;
    font = fontData
      ? new mupdf.Font(spec.fontName, fontData)
      : new mupdf.Font(spec.builtinName);
  } catch {
    font = new mupdf.Font(spec.builtinName);
  }
  translatedPdfFontObjectCache.set(spec.cacheKey, font);
  return font;
}

function rgb01FromColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  if (typeof value === 'string') {
    return hexToRgb01(value);
  }
  return [0, 0, 0];
}

function drawTableModelsToPdfDevice(device, tableModels) {
  if (!tableModels || tableModels.length === 0) {
    return;
  }
  for (const model of tableModels) {
    for (const cell of model.cells || []) {
      if (!cell.fill_enabled) {
        continue;
      }
      const pathObject = new mupdf.Path();
      try {
        pathObject.rect(...cell.render_bbox);
        device.fillPath(
          pathObject,
          false,
          TRANSLATED_TEXT_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          rgb01FromColor(cell.fill_color),
          1,
        );
      } finally {
        pathObject.destroy?.();
      }
    }
  }
  for (const model of tableModels) {
    for (const border of model.borders || []) {
      const pathObject = new mupdf.Path();
      const strokeState = new mupdf.StrokeState({
        lineCap: 'Butt',
        lineJoin: 'Miter',
        lineWidth: Number(border.width) || 0.6,
        miterLimit: 10,
      });
      try {
        pathObject.moveTo(Number(border.start[0]), Number(border.start[1]));
        pathObject.lineTo(Number(border.end[0]), Number(border.end[1]));
        device.strokePath(
          pathObject,
          strokeState,
          TRANSLATED_TEXT_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          rgb01FromColor(border.color),
          1,
        );
      } finally {
        strokeState.destroy?.();
        pathObject.destroy?.();
      }
    }
  }
}

function buildTextOverlayCanvas(withTextCanvas, withoutTextCanvas, {
  pixelBounds,
}) {
  const [x0, y0, x1, y1] = pixelBounds;
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const withCtx = withTextCanvas.getContext('2d');
  const withoutCtx = withoutTextCanvas.getContext('2d');
  const withData = withCtx.getImageData(x0, y0, width, height).data;
  const withoutData = withoutCtx.getImageData(x0, y0, width, height).data;
  const overlayCanvas = createCanvas(width, height);
  const overlayCtx = overlayCanvas.getContext('2d');
  const imageData = overlayCtx.createImageData(width, height);
  let hasVisiblePixels = false;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const offset = (row * width + col) * 4;
      const red = withData[offset];
      const green = withData[offset + 1];
      const blue = withData[offset + 2];
      const baseRed = withoutData[offset];
      const baseGreen = withoutData[offset + 1];
      const baseBlue = withoutData[offset + 2];
      const delta = Math.abs(red - baseRed) + Math.abs(green - baseGreen) + Math.abs(blue - baseBlue);
      if (delta < 16) {
        imageData.data[offset] = 0;
        imageData.data[offset + 1] = 0;
        imageData.data[offset + 2] = 0;
        imageData.data[offset + 3] = 0;
        continue;
      }
      imageData.data[offset] = red;
      imageData.data[offset + 1] = green;
      imageData.data[offset + 2] = blue;
      imageData.data[offset + 3] = 255;
      hasVisiblePixels = true;
      minX = Math.min(minX, col);
      minY = Math.min(minY, row);
      maxX = Math.max(maxX, col + 1);
      maxY = Math.max(maxY, row + 1);
    }
  }

  if (!hasVisiblePixels) {
    return null;
  }
  overlayCtx.putImageData(imageData, 0, 0);
  return {
    canvas: overlayCanvas,
    contentBounds: [minX, minY, maxX, maxY],
  };
}

function drawMirroredSourceTextPixelsToPdfDevice(device, {
  sourceSpans,
  sourceWithTextCanvas,
  sourceWithoutTextCanvas,
  pageWidth,
  pageHeight,
}) {
  for (const span of sourceSpans || []) {
    const mirroredBBox = mirrorBBox(span.source_bbox || span.bbox, pageWidth);
    const pixelBounds = bboxToPixelBounds(span.source_bbox || span.bbox, {
      pageWidth,
      pageHeight,
      canvasWidth: sourceWithTextCanvas.width,
      canvasHeight: sourceWithTextCanvas.height,
      paddingPoints: 0.75,
    });
    if (!pixelBounds) {
      continue;
    }
    const overlay = buildTextOverlayCanvas(sourceWithTextCanvas, sourceWithoutTextCanvas, { pixelBounds });
    if (!overlay) {
      continue;
    }
    const regionWidth = pixelBounds[2] - pixelBounds[0];
    const regionHeight = pixelBounds[3] - pixelBounds[1];
    const xScale = sourceWithTextCanvas.width / pageWidth;
    const yScale = sourceWithTextCanvas.height / pageHeight;
    if (xScale <= 0 || yScale <= 0 || regionWidth <= 0 || regionHeight <= 0) {
      continue;
    }
    const [contentX0, contentY0, contentX1, contentY1] = overlay.contentBounds;
    const leftMarginPt = contentX0 / xScale;
    const rightMarginPt = (regionWidth - contentX1) / xScale;
    const topMarginPt = contentY0 / yScale;
    const bottomMarginPt = (regionHeight - contentY1) / yScale;
    const destination = [
      mirroredBBox[0] + rightMarginPt,
      mirroredBBox[1] + topMarginPt,
      mirroredBBox[2] - leftMarginPt,
      mirroredBBox[3] - bottomMarginPt,
    ];
    const image = new mupdf.Image(overlay.canvas.toBuffer('image/png'));
    try {
      device.fillImage(
        image,
        [
          destination[2] - destination[0],
          0,
          0,
          destination[3] - destination[1],
          destination[0],
          destination[1],
        ],
        1,
      );
    } finally {
      image.destroy?.();
    }
  }
}

function resolveRequestedPages(manifest, requestedPages) {
  if (!requestedPages || requestedPages.size === 0) {
    return Array.from({ length: Number(manifest.page_count || 0) }, (_, index) => index + 1);
  }
  const selected = [...requestedPages].map((pageId) => Number(pageId)).sort((a, b) => a - b);
  for (const pageId of selected) {
    if (!Number.isInteger(pageId) || pageId <= 0 || pageId > Number(manifest.page_count || 0)) {
      throw new MirrorStageConfigurationError(`invalid requested page: ${pageId}`);
    }
  }
  return selected;
}

function planTableRebuildComponents(layout, fitted, {
  pageWidth = Number(layout.page_size_pt[0]),
  pageHeight = Number(layout.page_size_pt[1]),
  mirrorTextBboxes = true,
  coverageThreshold = TABLE_REBUILD_COVERAGE_THRESHOLD,
  clearMarginPt = TABLE_BACKGROUND_CLEAR_MARGIN_PT,
} = {}) {
  const sourceBlocks = new Map((layout.blocks || []).map((block) => [block.block_id, block]));
  const fittedSourceIds = new Set((fitted.blocks || []).map((block) => block.source_block_id));
  const tableCellSourceBboxes = {};

  for (const [blockId, block] of sourceBlocks.entries()) {
    if (block.type !== 'table_cell' || !fittedSourceIds.has(blockId)) {
      continue;
    }
    const sourceBBox = sourceSpaceTableBBox(block.bbox, { pageWidth, mirrorTextBboxes });
    if (!validBBox(sourceBBox)) {
      continue;
    }
    tableCellSourceBboxes[blockId] = sourceBBox;
  }
  if (Object.keys(tableCellSourceBboxes).length === 0) {
    return {
      components: [],
      componentByCellId: new Map(),
    };
  }

  const groupedIds = groupTableComponentCellIds(tableCellSourceBboxes);
  const components = [];
  const componentByCellId = new Map();

  const sortedGroups = [...groupedIds].sort((leftIds, rightIds) => {
    const leftTop = Math.min(...leftIds.map((cellId) => tableCellSourceBboxes[cellId][1]));
    const rightTop = Math.min(...rightIds.map((cellId) => tableCellSourceBboxes[cellId][1]));
    if (leftTop !== rightTop) {
      return leftTop - rightTop;
    }
    const leftLeft = Math.min(...leftIds.map((cellId) => tableCellSourceBboxes[cellId][0]));
    const rightLeft = Math.min(...rightIds.map((cellId) => tableCellSourceBboxes[cellId][0]));
    return leftLeft - rightLeft;
  });

  sortedGroups.forEach((cellIds, index) => {
    const componentBboxes = cellIds.map((cellId) => tableCellSourceBboxes[cellId]);
    const sourceUnionBBox = unionBBox(componentBboxes);
    const sourceUnionArea = bboxArea(sourceUnionBBox);
    const detectedSourceArea = rectanglesUnionArea(componentBboxes);
    const coverageRatio = sourceUnionArea > 0 ? (detectedSourceArea / sourceUnionArea) : 0;
    let eligibleForRebuild = coverageRatio >= coverageThreshold;
    let clearBBox = null;
    let fallbackReason = '';
    if (eligibleForRebuild) {
      const inflated = inflateBBox(sourceUnionBBox, {
        inset: clearMarginPt,
        pageWidth,
        pageHeight,
      });
      if (!validBBox(inflated)) {
        eligibleForRebuild = false;
        fallbackReason = 'invalid_clear_bbox';
      } else {
        clearBBox = inflated;
      }
    }
    if (!eligibleForRebuild && !fallbackReason) {
      fallbackReason = 'coverage_below_threshold';
    }
    const component = {
      component_id: `p${layout.page_id}_tc${index + 1}`,
      page_id: layout.page_id,
      source_union_bbox: sourceUnionBBox,
      source_union_area: sourceUnionArea,
      detected_source_area: detectedSourceArea,
      coverage_ratio: coverageRatio,
      eligible_for_rebuild: eligibleForRebuild,
      clear_bbox: clearBBox,
      cell_ids: [...cellIds].sort(),
      fallback_reason: fallbackReason,
    };
    components.push(component);
    for (const cellId of component.cell_ids) {
      componentByCellId.set(cellId, component);
    }
  });

  return {
    components,
    componentByCellId,
  };
}

function collectMirroredTableCells(sourceCanvas, layout, fitted, {
  pageWidth = Number(layout.page_size_pt[0]),
  mirrorTextBboxes = true,
  samplingCanvas = sourceCanvas,
} = {}) {
  const sampleScaleX = samplingCanvas.width / Math.max(1, pageWidth);
  const sampleScaleY = samplingCanvas.height / Math.max(1, Number(layout.page_size_pt[1]));
  const samplingCtx = samplingCanvas.getContext('2d');
  const styles = new Map((layout.styles || []).map((style) => [style.style_id, style]));
  const sourceBlocks = new Map((layout.blocks || []).map((block) => [block.block_id, block]));
  const fittedBySourceId = new Map((fitted.blocks || []).map((block) => [block.source_block_id, block]));

  const sourceTableBboxesRaw = (layout.blocks || [])
    .filter((block) => block.type === 'table_cell')
    .map((block) => resolveRenderBBox(block.bbox, { pageWidth, mirrorTextBboxes }));

  const sourceXRefs = clusterEdgeCenters(
    sourceTableBboxesRaw.flatMap((bbox) => [Number(bbox[0].toFixed(3)), Number(bbox[2].toFixed(3))]),
    1.3,
  );
  const sourceYRefs = clusterEdgeCenters(
    sourceTableBboxesRaw.flatMap((bbox) => [Number(bbox[1].toFixed(3)), Number(bbox[3].toFixed(3))]),
    1.3,
  );

  const rawCells = [];
  for (const [sourceBlockId, sourceBlock] of sourceBlocks.entries()) {
    if (sourceBlock.type !== 'table_cell') {
      continue;
    }
    const style = styles.get(sourceBlock.style_id);
    const fittedBlock = fittedBySourceId.get(sourceBlockId);
    if (!style || !fittedBlock) {
      continue;
    }
    const sourceBBoxForSampling = sourceSpaceTableBBox(sourceBlock.bbox, { pageWidth, mirrorTextBboxes });
    const sourceBBoxRaw = resolveRenderBBox(sourceBlock.bbox, { pageWidth, mirrorTextBboxes });
    let sourceBBox = [
      snapToReference(sourceBBoxRaw[0], sourceXRefs, 1.3),
      snapToReference(sourceBBoxRaw[1], sourceYRefs, 1.3),
      snapToReference(sourceBBoxRaw[2], sourceXRefs, 1.3),
      snapToReference(sourceBBoxRaw[3], sourceYRefs, 1.3),
    ];
    if (!validBBox(sourceBBox)) {
      sourceBBox = sourceBBoxRaw;
    }
    const renderBBox = resolveRenderBBox(fittedBlock.bbox, { pageWidth, mirrorTextBboxes });
    const fillColor = sampleRegionFillColor(
      samplingCtx,
      tableCellInnerBBox(sourceBBoxForSampling, 1.0),
      sampleScaleX,
      sampleScaleY,
    );
    let borderColor = sampleRegionBorderColor(
      samplingCtx,
      sourceBBoxForSampling,
      sampleScaleX,
      sampleScaleY,
    );
    if (((borderColor[0] + borderColor[1] + borderColor[2]) / 3) > 0.85) {
      borderColor = hexToRgb01(style.color);
      if (luminance(borderColor) > 0.85) {
        borderColor = [0.25, 0.25, 0.25];
      }
    }
    rawCells.push({
      source_block_id: sourceBlockId,
      source_bbox: sourceBBox,
      render_bbox: renderBBox,
      fill_color: fillColor,
      fill_enabled: true,
      border_color: borderColor,
      border_width: 0.6,
    });
  }

  const renderXCenters = clusterEdgeCenters(
    rawCells.flatMap((cell) => [Number(cell.render_bbox[0]), Number(cell.render_bbox[2])]),
    1.3,
  );
  const renderYCenters = clusterEdgeCenters(
    rawCells.flatMap((cell) => [Number(cell.render_bbox[1]), Number(cell.render_bbox[3])]),
    1.3,
  );

  return rawCells.map((cell) => {
    const normalizedRenderBBox = [
      snapToReference(cell.render_bbox[0], renderXCenters, 1.3),
      snapToReference(cell.render_bbox[1], renderYCenters, 1.3),
      snapToReference(cell.render_bbox[2], renderXCenters, 1.3),
      snapToReference(cell.render_bbox[3], renderYCenters, 1.3),
    ];
    let snappedRenderBBox = [
      snapToReference(normalizedRenderBBox[0], sourceXRefs, 0.75),
      snapToReference(normalizedRenderBBox[1], sourceYRefs, 0.75),
      snapToReference(normalizedRenderBBox[2], sourceXRefs, 0.75),
      snapToReference(normalizedRenderBBox[3], sourceYRefs, 0.75),
    ];
    if (!validBBox(snappedRenderBBox)) {
      snappedRenderBBox = [...cell.render_bbox];
    }
    return {
      ...cell,
      render_bbox: snappedRenderBBox,
    };
  });
}

function buildMirroredTableRebuildData(sourceCanvas, layout, fitted, {
  mirrorTextBboxes = true,
  coverageThreshold = TABLE_REBUILD_COVERAGE_THRESHOLD,
  samplingCanvas = sourceCanvas,
} = {}) {
  const pageWidth = Number(layout.page_size_pt[0]);
  const pageHeight = Number(layout.page_size_pt[1]);
  const { components, componentByCellId } = planTableRebuildComponents(layout, fitted, {
    pageWidth,
    pageHeight,
    mirrorTextBboxes,
    coverageThreshold,
  });
  if (components.length === 0) {
    return {
      coverage_threshold: coverageThreshold,
      components: [],
      models: [],
    };
  }

  const mirroredCells = collectMirroredTableCells(sourceCanvas, layout, fitted, {
    pageWidth,
    mirrorTextBboxes,
    samplingCanvas,
  });
  const cellsByComponent = new Map();
  for (const cell of mirroredCells) {
    const component = componentByCellId.get(cell.source_block_id);
    if (!component || !component.eligible_for_rebuild) {
      continue;
    }
    if (!cellsByComponent.has(component.component_id)) {
      cellsByComponent.set(component.component_id, []);
    }
    cellsByComponent.get(component.component_id).push(cell);
  }

  const planById = new Map(components.map((component) => [component.component_id, component]));
  const models = [...cellsByComponent.entries()]
    .sort((left, right) => {
      const leftCells = left[1];
      const rightCells = right[1];
      const topDelta = Math.min(...leftCells.map((cell) => cell.render_bbox[1])) - Math.min(...rightCells.map((cell) => cell.render_bbox[1]));
      if (topDelta !== 0) {
        return topDelta;
      }
      const leftDelta = Math.min(...leftCells.map((cell) => cell.render_bbox[0])) - Math.min(...rightCells.map((cell) => cell.render_bbox[0]));
      if (leftDelta !== 0) {
        return leftDelta;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([componentId, componentCells]) => {
      const expandedCells = expandWithImplicitTableCells(componentCells);
      const component = planById.get(componentId);
      const rows = componentTrackIntervals(expandedCells, 'y');
      const columns = componentTrackIntervals(expandedCells, 'x');
      const cells = [...expandedCells]
        .sort((left, right) => (
          (left.render_bbox[1] - right.render_bbox[1])
          || (left.render_bbox[0] - right.render_bbox[0])
          || left.source_block_id.localeCompare(right.source_block_id)
        ))
        .map((cell) => {
          const [rowStart, rowEnd] = trackSpanForInterval(cell.render_bbox[1], cell.render_bbox[3], rows);
          const [columnStart, columnEnd] = trackSpanForInterval(cell.render_bbox[0], cell.render_bbox[2], columns);
          return {
            source_block_id: cell.source_block_id,
            component_id: componentId,
            source_bbox: [...cell.source_bbox],
            render_bbox: [...cell.render_bbox],
            fill_color: [...cell.fill_color],
            fill_enabled: Boolean(cell.fill_enabled),
            border_color: [...cell.border_color],
            border_width: cell.border_width,
            row_start: rowStart,
            row_end: rowEnd,
            column_start: columnStart,
            column_end: columnEnd,
          };
        });
      const borders = collectTableEdgeSegments(expandedCells).map((border) => ({
        orientation: border.orientation === 'h' ? 'horizontal' : 'vertical',
        start: [...border.start],
        end: [...border.end],
        color: [...border.color],
        width: border.width,
      }));
      return {
        component_id: componentId,
        page_id: layout.page_id,
        coverage_ratio: component.coverage_ratio,
        eligible_for_rebuild: component.eligible_for_rebuild,
        source_union_bbox: [...component.source_union_bbox],
        render_union_bbox: unionBBox(cells.map((cell) => cell.render_bbox)),
        rows,
        columns,
        cells,
        borders,
      };
    });

  return {
    coverage_threshold: coverageThreshold,
    components,
    models,
  };
}

export function _build_mirrored_table_rebuild_data(sourceCanvas, layout, fitted, options = {}) {
  return buildMirroredTableRebuildData(sourceCanvas, layout, fitted, options);
}

export function _build_mirrored_table_models(sourceCanvas, layout, fitted, options = {}) {
  return buildMirroredTableRebuildData(sourceCanvas, layout, fitted, options).models;
}

function clearTableRegionsFromSourceCanvas(sourceCanvas, tableRebuild, {
  pageWidth,
  pageHeight,
} = {}) {
  if (!tableRebuild || !tableRebuild.components || tableRebuild.components.length === 0) {
    return sourceCanvas;
  }
  const eligibleComponents = tableRebuild.components.filter((component) => component.eligible_for_rebuild && component.clear_bbox);
  if (eligibleComponents.length === 0) {
    return sourceCanvas;
  }
  const widthPx = sourceCanvas.width;
  const heightPx = sourceCanvas.height;
  const resolvedPageWidth = pageWidth || widthPx;
  const resolvedPageHeight = pageHeight || heightPx;
  const scaleX = widthPx / Math.max(1, resolvedPageWidth);
  const scaleY = heightPx / Math.max(1, resolvedPageHeight);
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const sourceCtx = sourceCanvas.getContext('2d');

  for (const component of eligibleComponents) {
    const fillColor = sampleBackgroundNearBBox(sourceCtx, component.source_union_bbox, {
      pageWidth: resolvedPageWidth,
      pageHeight: resolvedPageHeight,
      scaleX,
      scaleY,
    });
    const clearBBoxPx = ptRectToPx(component.clear_bbox, scaleX, scaleY);
    fillCanvasIntRegion(ctx, clearBBoxPx, fillColor);
  }
  return canvas;
}

function drawMirroredTableModelsToCanvas(ctx, tableRebuild, { scaleX, scaleY }) {
  if (!tableRebuild || !tableRebuild.models || tableRebuild.models.length === 0) {
    return;
  }
  for (const component of tableRebuild.models) {
    for (const cell of component.cells || []) {
      if (!cell.fill_enabled) {
        continue;
      }
      const renderBBoxPx = ptRectToPx(cell.render_bbox, scaleX, scaleY);
      if (!validBBox(renderBBoxPx)) {
        continue;
      }
      ctx.fillStyle = rgb01ToCss(cell.fill_color);
      ctx.fillRect(
        renderBBoxPx[0],
        renderBBoxPx[1],
        rectWidth(renderBBoxPx),
        rectHeight(renderBBoxPx),
      );
    }
  }
  for (const component of tableRebuild.models) {
    for (const border of component.borders || []) {
      drawAxisAlignedBorderSegment(ctx, border, { scaleX, scaleY });
    }
  }
}

function normalizeGraphicEditOperation(edit) {
  if (!edit || typeof edit !== 'object') {
    return null;
  }
  if (edit.op === 'flip_graphic' && edit.block_id) {
    return { op: 'flip_graphic', block_id: String(edit.block_id) };
  }
  if (edit.op === 'move_graphic' && edit.block_id && Array.isArray(edit.value) && edit.value.length === 4) {
    return {
      op: 'move_graphic',
      block_id: String(edit.block_id),
      value: edit.value.map((value) => Number(value)),
    };
  }
  return null;
}

export const MIRROR_STAGE_PORT_STATUS = {
  _extract_image_bboxes: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Preview-path dependency. Verified against Python preview renders on real PDFs.',
  },
  _mirror_pixmap_horizontally: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Canvas mirror operation used by preview path and verified against Python outputs.',
  },
  _restore_image_orientations: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'In-place mirrored image un-flip matching Python preview behavior.',
  },
  _apply_graphic_region_edits: {
    status: PORT_STATUS.PARTIAL,
    tested: false,
    notes: 'Supports basic flip/move graphic-region edits for preview path.',
  },
  _render_page_without_text: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Canvas background renderer using MuPDF redaction pass, verified on real PDFs.',
  },
  _plan_table_rebuild_components: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Conservative preview table rebuild planning verified against Python preview path.',
  },
  _clear_table_regions_from_source_pixmap: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Conservative preview table clear implementation verified against Python preview path.',
  },
  _collect_mirrored_table_cells: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Collected from deleted JS conservative mirror implementation.',
  },
  _redraw_mirrored_table_cells: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Collected from deleted JS conservative mirror implementation.',
  },
  _resolve_layout_for_page: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Artifact resolver for preview renderer exercised by real preview parity runs.',
  },
  _resolve_fitted_for_page: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Artifact resolver for preview renderer exercised by real preview parity runs.',
  },
  render_mirrored_layout_document: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Top-level conservative preview renderer verified against Python on real PDFs.',
  },
  _plan_mirrored_translated_text_draws: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Translated text draw-plan path reused from retained JS mirror text planner.',
  },
  _draw_mirrored_table_models: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Vector table redraw on PDF device for translated output.',
  },
  _build_mirrored_table_models: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Translated PDF table-model builder currently reused from preview rebuild data path.',
  },
  _draw_mirrored_source_text_pixels: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Preserve-source pixel overlay path for translated output.',
  },
  _draw_mirrored_translated_text: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Vector translated text drawing into PDF device.',
  },
  render_mirrored_layout_with_translated_text_document: {
    status: PORT_STATUS.PORTED_UNTESTED,
    tested: false,
    notes: 'Top-level translated PDF renderer built on preview core plus vector overlays.',
  },
};

export function _extract_image_bboxes(page) {
  const bboxes = [];
  if (page && typeof page.get_images === 'function' && typeof page.get_image_rects === 'function') {
    for (const image of page.get_images(true)) {
      const xref = image[0];
      for (const rect of page.get_image_rects(xref) || []) {
        const bbox = [
          Number(rect.x0 ?? rect[0] ?? 0),
          Number(rect.y0 ?? rect[1] ?? 0),
          Number(rect.x1 ?? rect[2] ?? 0),
          Number(rect.y1 ?? rect[3] ?? 0),
        ];
        if (validBBox(bbox)) {
          bboxes.push(bbox);
        }
      }
    }
    return bboxes;
  }
  if (page && typeof page.getImageBlocks === 'function') {
    return page.getImageBlocks().map((bbox) => bbox.map((value) => Number(value))).filter((bbox) => validBBox(bbox));
  }
  return bboxes;
}

export function _mirror_pixmap_horizontally(canvas) {
  const mirrored = createCanvas(canvas.width, canvas.height);
  const ctx = mirrored.getContext('2d');
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  return mirrored;
}

export function _restore_image_orientations(canvas, {
  sourceCanvas,
  imageBboxes,
  pageWidth,
  pageHeight,
}) {
  if (!imageBboxes || imageBboxes.length === 0) {
    return canvas;
  }
  const output = createCanvas(canvas.width, canvas.height);
  const ctx = output.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  void sourceCanvas;
  for (const bbox of imageBboxes) {
    const mirroredBbox = [pageWidth - bbox[2], bbox[1], pageWidth - bbox[0], bbox[3]];
    const renderBBoxPx = bboxToPixelBounds(mirroredBbox, {
      pageWidth,
      pageHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      paddingPoints: 0.0,
    });
    if (!renderBBoxPx) {
      continue;
    }
    const [x0, y0, x1, y1] = renderBBoxPx;
    const width = x1 - x0;
    const height = y1 - y0;
    if (width < 2 || height < 1) {
      continue;
    }
    const regionCanvas = createCanvas(width, height);
    const regionCtx = regionCanvas.getContext('2d');
    regionCtx.drawImage(output, x0, y0, width, height, 0, 0, width, height);
    ctx.save();
    ctx.translate(x1, y0);
    ctx.scale(-1, 1);
    ctx.drawImage(regionCanvas, 0, 0, width, height);
    ctx.restore();
  }
  return output;
}

export function _apply_graphic_region_edits(canvas, {
  regions,
  edits,
  pageWidth,
  pageHeight,
}) {
  const normalizedEdits = (edits || []).map(normalizeGraphicEditOperation).filter(Boolean);
  if (!regions || regions.length === 0 || normalizedEdits.length === 0) {
    return canvas;
  }
  const output = createCanvas(canvas.width, canvas.height);
  const ctx = output.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const scaleX = canvas.width / Math.max(1, pageWidth);
  const scaleY = canvas.height / Math.max(1, pageHeight);
  const regionById = new Map((regions || []).map((region) => [region.region_id, region]));

  for (const edit of normalizedEdits) {
    const region = regionById.get(edit.block_id);
    if (!region) {
      continue;
    }
    const oldMirrored = [pageWidth - region.bbox[2], region.bbox[1], pageWidth - region.bbox[0], region.bbox[3]];
    const oldBounds = bboxToPixelBounds(oldMirrored, {
      pageWidth,
      pageHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      paddingPoints: 0.0,
    });
    if (!oldBounds) {
      continue;
    }
    if (edit.op === 'flip_graphic') {
      const [x0, y0, x1, y1] = oldBounds;
      const width = x1 - x0;
      const height = y1 - y0;
      if (width <= 0 || height <= 0) {
        continue;
      }
      const regionCanvas = createCanvas(width, height);
      const regionCtx = regionCanvas.getContext('2d');
      regionCtx.drawImage(output, x0, y0, width, height, 0, 0, width, height);
      ctx.save();
      ctx.translate(x1, y0);
      ctx.scale(-1, 1);
      ctx.drawImage(regionCanvas, 0, 0, width, height);
      ctx.restore();
      continue;
    }
    if (edit.op === 'move_graphic') {
      const newMirrored = [pageWidth - edit.value[2], edit.value[1], pageWidth - edit.value[0], edit.value[3]];
      const newBounds = bboxToPixelBounds(newMirrored, {
        pageWidth,
        pageHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        paddingPoints: 0.0,
      });
      if (!newBounds) {
        continue;
      }
      const [x0, y0, x1, y1] = oldBounds;
      const width = x1 - x0;
      const height = y1 - y0;
      const regionCanvas = createCanvas(width, height);
      const regionCtx = regionCanvas.getContext('2d');
      regionCtx.drawImage(output, x0, y0, width, height, 0, 0, width, height);
      const fillColor = sampleBackgroundNearBBox(ctx, oldMirrored, {
        pageWidth,
        pageHeight,
        scaleX,
        scaleY,
      });
      fillCanvasIntRegion(ctx, [x0, y0, x1, y1], fillColor);
      ctx.drawImage(regionCanvas, newBounds[0], newBounds[1], newBounds[2] - newBounds[0], newBounds[3] - newBounds[1]);
    }
  }
  return output;
}

export async function _render_page_without_text(sourcePdfData, {
  pageIndex,
  renderDpi,
}) {
  const scale = Number(renderDpi) / 72;
  return renderPdfPageToCanvas(sourcePdfData, { pageIndex, scale, ignoreText: true });
}

export function _plan_table_rebuild_components({
  pageId,
  layout,
  fitted,
  pageWidth,
  pageHeight,
  mirrorTextBboxes,
  coverageThreshold = TABLE_REBUILD_COVERAGE_THRESHOLD,
}) {
  const { components, componentByCellId } = planTableRebuildComponents(layout, fitted, {
    pageWidth,
    pageHeight,
    mirrorTextBboxes,
    coverageThreshold,
  });
  for (const component of components) {
    component.page_id = pageId;
  }
  return [components, componentByCellId];
}

export function _clear_table_regions_from_source_pixmap(sourceCanvas, {
  componentPlans,
  pageWidth,
  pageHeight,
}) {
  return clearTableRegionsFromSourceCanvas(sourceCanvas, { components: componentPlans }, { pageWidth, pageHeight });
}

export function _collect_mirrored_table_cells({
  sourceCanvas,
  layout,
  fitted,
  mirrorTextBboxes,
}) {
  const cells = collectMirroredTableCells(sourceCanvas, layout, fitted, { mirrorTextBboxes });
  return Object.fromEntries(cells.map((cell) => [cell.source_block_id, cell]));
}

export function _redraw_mirrored_table_cells(canvas, {
  mirroredCells,
  pageWidth,
  pageHeight,
}) {
  const output = createCanvas(canvas.width, canvas.height);
  const ctx = output.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const tableRebuild = {
    models: [
      {
        cells: expandWithImplicitTableCells(Object.values(mirroredCells || {})),
        borders: collectTableEdgeSegments(expandWithImplicitTableCells(Object.values(mirroredCells || {}))).map((border) => ({
          orientation: border.orientation === 'h' ? 'horizontal' : 'vertical',
          start: [...border.start],
          end: [...border.end],
          color: [...border.color],
          width: border.width,
        })),
      },
    ],
  };
  drawMirroredTableModelsToCanvas(ctx, tableRebuild, {
    scaleX: canvas.width / Math.max(1, pageWidth),
    scaleY: canvas.height / Math.max(1, pageHeight),
  });
  return output;
}

export async function _resolve_layout_for_page({
  artifactsRoot,
  documentId,
  pageId,
  artifactPrefix = 'page_layout',
}) {
  const layoutPath = path.join(artifactsRoot, documentId, `${artifactPrefix}_${pageId}.json`);
  return JSON.parse(await readFile(layoutPath, 'utf8'));
}

export async function _resolve_fitted_for_page({
  artifactsRoot,
  documentId,
  pageId,
  artifactPrefix = 'fitted_blocks',
}) {
  const fittedPath = path.join(artifactsRoot, documentId, `${artifactPrefix}_${pageId}.json`);
  return JSON.parse(await readFile(fittedPath, 'utf8'));
}

async function renderMirroredLayoutPreviewPages(
  manifest,
  {
    pageArtifactsById = null,
    sourcePdfData,
    requestedPages = null,
    renderDpi = 150,
    writeDebugImages = false,
    redrawTableBordersFromFitted = false,
    clearTableRegionsFromFitted = false,
    mirrorTableBboxes = true,
    tableRebuildCoverageThreshold = TABLE_REBUILD_COVERAGE_THRESHOLD,
    graphicRegionEditsByPage = null,
    artifactsRoot = '',
  } = {},
) {
  if (!manifest || !manifest.document_id) {
    throw new MirrorStageConfigurationError('manifest must include document_id');
  }
  if (!sourcePdfData) {
    throw new MirrorStageConfigurationError('sourcePdfData is required');
  }
  const selectedPages = resolveRequestedPages(manifest, requestedPages);
  const document = openDocument(sourcePdfData);
  const twinDocument = null;
  const renderedPages = [];
  const debugImages = [];

  try {
    for (const pageId of selectedPages) {
      const pageIndex = pageId - 1;
      const page = document.loadPage(pageIndex);
      try {
        const pageBounds = page.getBounds();
        const pageWidth = Number(pageBounds[2] - pageBounds[0]);
        const pageHeight = Number(pageBounds[3] - pageBounds[1]);

        let layout = null;
        let fitted = null;
        let componentPlans = [];
        let componentPlanByCellId = new Map();
        if (redrawTableBordersFromFitted || clearTableRegionsFromFitted) {
          const pageArtifacts = pageArtifactsById?.get(pageId);
          layout = pageArtifacts?.layout || null;
          fitted = pageArtifacts?.fitted || null;
          if (!layout || !fitted) {
            throw new MirrorStageConfigurationError(`missing in-memory page artifacts for page ${pageId}`);
          }
          [componentPlans, componentPlanByCellId] = _plan_table_rebuild_components({
            pageId,
            layout,
            fitted,
            pageWidth,
            pageHeight,
            mirrorTextBboxes: mirrorTableBboxes,
            coverageThreshold: tableRebuildCoverageThreshold,
          });
        }

        const sourceCanvas = await renderPdfPageToCanvas(sourcePdfData, {
          pageIndex,
          scale: Number(renderDpi) / 72,
          ignoreText: false,
        });
        const sourceSamplingCanvas = redrawTableBordersFromFitted
          ? await renderPdfPageToCanvas(sourcePdfData, {
            pageIndex,
            scale: 1,
            ignoreText: false,
          })
          : sourceCanvas;
        let sourceWithoutTextCanvas = await _render_page_without_text(sourcePdfData, {
          pageIndex,
          renderDpi,
        });
        if (clearTableRegionsFromFitted && componentPlans.length > 0) {
          sourceWithoutTextCanvas = _clear_table_regions_from_source_pixmap(sourceWithoutTextCanvas, {
            componentPlans,
            pageWidth,
            pageHeight,
          });
        }

        let mirroredCanvas = _mirror_pixmap_horizontally(sourceWithoutTextCanvas);
        const pageAdapter = {
          get_images: (...args) => {
            const adapterDoc = openDocument(sourcePdfData);
            try {
              const pageAdapterInner = adapterDoc.loadPage(pageIndex);
              try {
                return pageAdapterInner.get_images(...args);
              } finally {
                pageAdapterInner.destroy?.();
              }
            } finally {
              adapterDoc.destroy?.();
            }
          },
        };
        void pageAdapter;

        const imageBboxes = [];
        try {
          const adapterDoc = await import('./pymupdfTwinAdapter.js');
          const twin = adapterDoc.openMuPdfTwinDocument(sourcePdfData);
          try {
            const twinPage = twin.loadPage(pageIndex);
            try {
              imageBboxes.push(..._extract_image_bboxes(twinPage));
              if (imageBboxes.length > 0) {
                mirroredCanvas = _restore_image_orientations(mirroredCanvas, {
                  sourceCanvas: sourceWithoutTextCanvas,
                  imageBboxes,
                  pageWidth,
                  pageHeight,
                });
              }
              if (graphicRegionEditsByPage && graphicRegionEditsByPage[pageId]) {
                const regionLayout = layout || pageArtifactsById?.get(pageId)?.layout;
                if (!regionLayout) {
                  throw new MirrorStageConfigurationError(`missing in-memory layout for graphic-region edits on page ${pageId}`);
                }
                mirroredCanvas = _apply_graphic_region_edits(mirroredCanvas, {
                  regions: regionLayout.graphic_regions || [],
                  edits: graphicRegionEditsByPage[pageId],
                  pageWidth,
                  pageHeight,
                });
              }
            } finally {
              twinPage.destroy?.();
            }
          } finally {
            twin.destroy?.();
          }
        } catch {
          // Leave preview generation resilient; image restoration is best-effort.
        }

        if (redrawTableBordersFromFitted) {
          try {
            if (!layout || !fitted) {
              throw new MirrorStageConfigurationError('table redraw requested without layout/fitted artifacts');
            }
            let mirroredCells = _collect_mirrored_table_cells({
              sourceCanvas: sourceSamplingCanvas,
              layout,
              fitted,
              mirrorTextBboxes: mirrorTableBboxes,
            });
            if (componentPlanByCellId.size > 0) {
              mirroredCells = Object.fromEntries(
                Object.entries(mirroredCells).filter(([blockId]) => (
                  componentPlanByCellId.get(blockId)?.eligible_for_rebuild
                )),
              );
            }
            mirroredCanvas = _redraw_mirrored_table_cells(mirroredCanvas, {
              mirroredCells,
              pageWidth,
              pageHeight,
            });
          } catch {
            // Keep preview generation resilient.
          }
        }

        renderedPages.push({
          canvas: mirroredCanvas,
          widthPt: pageWidth,
          heightPt: pageHeight,
          pageId,
        });

        if (writeDebugImages) {
          if (!artifactsRoot) {
            throw new MirrorStageConfigurationError('artifactsRoot is required when writeDebugImages is enabled');
          }
          const debugPath = path.join(artifactsRoot, manifest.document_id, `mirror_debug_${pageId}.png`);
          await writeCanvasPng(mirroredCanvas, debugPath);
          debugImages.push(debugPath);
        }
      } finally {
        page.destroy?.();
      }
    }
  } finally {
    document.destroy?.();
    twinDocument?.destroy?.();
  }

  return {
    mirrored_pages: selectedPages,
    rendered_pages: renderedPages,
    debug_images: debugImages,
  };
}

async function loadPreviewPageArtifacts({
  artifactsRoot,
  documentId,
  selectedPages,
  layoutArtifactPrefix,
  fittedArtifactPrefix,
}) {
  const pageArtifactsById = new Map();
  for (const pageId of selectedPages) {
    const [layout, fitted] = await Promise.all([
      _resolve_layout_for_page({
        artifactsRoot,
        documentId,
        pageId,
        artifactPrefix: layoutArtifactPrefix,
      }),
      _resolve_fitted_for_page({
        artifactsRoot,
        documentId,
        pageId,
        artifactPrefix: fittedArtifactPrefix,
      }),
    ]);
    pageArtifactsById.set(pageId, { layout, fitted });
  }
  return pageArtifactsById;
}

export async function render_mirrored_layout_preview_pages(
  manifest,
  {
    sourcePdfData,
    pageArtifactsById,
    requestedPages = null,
    renderDpi = 150,
    redrawTableBordersFromFitted = false,
    clearTableRegionsFromFitted = false,
    mirrorTableBboxes = true,
    tableRebuildCoverageThreshold = TABLE_REBUILD_COVERAGE_THRESHOLD,
    graphicRegionEditsByPage = null,
  } = {},
) {
  return renderMirroredLayoutPreviewPages(manifest, {
    sourcePdfData,
    pageArtifactsById,
    requestedPages,
    renderDpi,
    redrawTableBordersFromFitted,
    clearTableRegionsFromFitted,
    mirrorTableBboxes,
    tableRebuildCoverageThreshold,
    graphicRegionEditsByPage,
  });
}

export async function _plan_mirrored_translated_text_draws({
  layout,
  fitted,
  pageWidth,
  widthPx,
  heightPx,
  minFontSize = TRANSLATED_TEXT_DEFAULT_MIN_FONT_SIZE,
  preserveLtrSource = 'auto',
  forceSourceAlignment = false,
  mirrorTextBboxes = true,
  allowOverflowCompaction = true,
  allowOverflowClipping = true,
  clippingSourceBlockIds = null,
  uncappedSourceLineBlockIds = null,
  fauxBoldPolicy = 'semantic',
  fontResources = null,
} = {}) {
  const plan = buildMirroredPageRenderPlan(layout, fitted, {
    mirrorTextBboxes,
    preserveLtrSource,
    allowOverflowCompaction,
    allowOverflowClipping,
    clippingSourceBlockIds,
    uncappedSourceLineBlockIds,
    fauxBoldPolicy,
  });
  const fonts = fontResources || await resolveTranslatedPdfFontResources();
  const operations = collectMirroredTextDrawOperations(plan, fonts, {
    widthPx,
    heightPx,
    minFontSize,
  });
  return {
    page_width: pageWidth,
    plan,
    operations,
  };
}

function drawMirroredTranslatedTextToPdfDevice(device, operations, fontResources) {
  for (const operation of operations || []) {
    const font = loadTranslatedPdfFont(fontResources, {
      weight: operation.weight || 'normal',
      italic: Boolean(operation.italic),
    });
    for (const linePosition of operation.line_positions || []) {
      const textObject = new mupdf.Text();
      try {
        textObject.showString(
          font,
          [
            Number(operation.font_size) || TRANSLATED_TEXT_DEFAULT_MIN_FONT_SIZE,
            0,
            0,
            -(Number(operation.font_size) || TRANSLATED_TEXT_DEFAULT_MIN_FONT_SIZE),
            Number(linePosition.x_pt ?? linePosition.x ?? 0),
            Number(linePosition.baseline_pt ?? linePosition.baseline ?? 0),
          ],
          String(linePosition.text || ''),
          0,
        );
        const color = rgb01FromColor(operation.color);
        device.fillText(
          textObject,
          TRANSLATED_TEXT_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          color,
          1,
        );
        if (operation.faux_bold) {
          const strokeState = new mupdf.StrokeState({
            lineCap: 'Butt',
            lineJoin: 'Miter',
            lineWidth: Number(operation.stroke_width) || 0.02,
            miterLimit: 10,
          });
          try {
            device.strokeText(
              textObject,
              strokeState,
              TRANSLATED_TEXT_IDENTITY_MATRIX,
              mupdf.ColorSpace.DeviceRGB,
              color,
              1,
            );
          } finally {
            strokeState.destroy?.();
          }
        }
      } finally {
        textObject.destroy?.();
      }
    }
  }
}

export async function render_mirrored_layout_document(
  manifest,
  {
    artifactsRoot,
    outputPdf,
    requestedPages = null,
    renderDpi = 150,
    writeDebugImages = false,
    redrawTableBordersFromFitted = false,
    clearTableRegionsFromFitted = false,
    layoutArtifactPrefix = 'page_layout',
    fittedArtifactPrefix = 'fitted_blocks',
    mirrorTableBboxes = true,
    tableRebuildCoverageThreshold = TABLE_REBUILD_COVERAGE_THRESHOLD,
    graphicRegionEditsByPage = null,
  } = {},
) {
  if (!manifest || !manifest.source_pdf || !manifest.document_id) {
    throw new MirrorStageConfigurationError('manifest must include source_pdf and document_id');
  }
  if (!artifactsRoot || !outputPdf) {
    throw new MirrorStageConfigurationError('artifactsRoot and outputPdf are required');
  }
  const selectedPages = resolveRequestedPages(manifest, requestedPages);
  const sourcePdfData = await readFile(path.resolve(manifest.source_pdf));
  const pageArtifactsById = (redrawTableBordersFromFitted || clearTableRegionsFromFitted)
    ? await loadPreviewPageArtifacts({
      artifactsRoot,
      documentId: manifest.document_id,
      selectedPages,
      layoutArtifactPrefix,
      fittedArtifactPrefix,
    })
    : new Map();
  const {
    rendered_pages: renderedPages,
    mirrored_pages: mirroredPages,
    debug_images: debugImages,
  } = await renderMirroredLayoutPreviewPages(manifest, {
    sourcePdfData,
    pageArtifactsById,
    requestedPages: new Set(selectedPages),
    renderDpi,
    writeDebugImages,
    redrawTableBordersFromFitted,
    clearTableRegionsFromFitted,
    mirrorTableBboxes,
    tableRebuildCoverageThreshold,
    graphicRegionEditsByPage,
    artifactsRoot,
  });
  const pdfBuffer = renderCanvasesToPdf(renderedPages, { title: 'mirrored-layout-canvas' });
  await mkdir(path.dirname(outputPdf), { recursive: true });
  await writeFile(outputPdf, pdfBuffer);
  return {
    output_pdf: outputPdf,
    mirrored_pages: mirroredPages,
    debug_images: debugImages,
  };
}

export async function render_mirrored_layout_with_translated_text_document(
  manifest,
  {
    artifactsRoot,
    outputPdf,
    requestedPages = null,
    renderDpi = 150,
    writeDebugImages = false,
    minFontSize = TRANSLATED_TEXT_DEFAULT_MIN_FONT_SIZE,
    preserveLtrSource = 'auto',
    fittedArtifactPrefix = 'fitted_blocks',
    layoutArtifactPrefix = 'page_layout',
    debugPrefix = 'mirror_translated_debug',
    forceSourceAlignment = false,
    mirrorTextBboxes = true,
    allowOverflowCompaction = true,
    allowOverflowClipping = true,
    clippingSourceBlockIdsByPage = null,
    uncappedSourceLineBlockIdsByPage = null,
    tableRebuildCoverageThreshold = TABLE_REBUILD_COVERAGE_THRESHOLD,
    graphicRegionEditsByPage = null,
    fauxBoldPolicy = 'semantic',
  } = {},
) {
  if (!manifest || !manifest.source_pdf || !manifest.document_id) {
    throw new MirrorStageConfigurationError('manifest must include source_pdf and document_id');
  }
  if (!artifactsRoot || !outputPdf) {
    throw new MirrorStageConfigurationError('artifactsRoot and outputPdf are required');
  }
  const selectedPages = resolveRequestedPages(manifest, requestedPages);
  const sourcePdfData = await readFile(path.resolve(manifest.source_pdf));
  const pageArtifactsById = await loadPreviewPageArtifacts({
    artifactsRoot,
    documentId: manifest.document_id,
    selectedPages,
    layoutArtifactPrefix,
    fittedArtifactPrefix,
  });
  const previewResult = await renderMirroredLayoutPreviewPages(manifest, {
    sourcePdfData,
    pageArtifactsById,
    requestedPages: new Set(selectedPages),
    renderDpi,
    writeDebugImages: false,
    redrawTableBordersFromFitted: false,
    clearTableRegionsFromFitted: true,
    mirrorTableBboxes: mirrorTextBboxes,
    tableRebuildCoverageThreshold,
    graphicRegionEditsByPage,
  });
  const fontResources = await resolveTranslatedPdfFontResources();
  const outputBuffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(outputBuffer, 'pdf', '');
  const debugImages = [];

  try {
    for (const renderedPage of previewResult.rendered_pages) {
      const pageId = Number(renderedPage.pageId);
      const pageArtifacts = pageArtifactsById.get(pageId);
      if (!pageArtifacts) {
        throw new MirrorStageConfigurationError(`missing page artifacts for page ${pageId}`);
      }
      const { layout, fitted } = pageArtifacts;
      const sourceCanvas = await renderPdfPageToCanvas(sourcePdfData, {
        pageIndex: pageId - 1,
        scale: Number(renderDpi) / 72,
        ignoreText: false,
      });
      const sourceSamplingCanvas = await renderPdfPageToCanvas(sourcePdfData, {
        pageIndex: pageId - 1,
        scale: 1,
        ignoreText: false,
      });
      const sourceWithoutTextCanvas = await _render_page_without_text(sourcePdfData, {
        pageIndex: pageId - 1,
        renderDpi,
      });
      const tableRebuild = buildMirroredTableRebuildData(sourceCanvas, layout, fitted, {
        mirrorTextBboxes,
        coverageThreshold: tableRebuildCoverageThreshold,
        samplingCanvas: sourceSamplingCanvas,
      });
      const translatedPlan = await _plan_mirrored_translated_text_draws({
        layout,
        fitted,
        pageWidth: renderedPage.widthPt,
        widthPx: renderedPage.canvas.width,
        heightPx: renderedPage.canvas.height,
        minFontSize,
        preserveLtrSource,
        forceSourceAlignment,
        mirrorTextBboxes,
        allowOverflowCompaction,
        allowOverflowClipping,
        clippingSourceBlockIds: clippingSourceBlockIdsByPage?.[pageId] || null,
        uncappedSourceLineBlockIds: uncappedSourceLineBlockIdsByPage?.[pageId] || null,
        fauxBoldPolicy,
        fontResources,
      });

      const pageDevice = writer.beginPage([0, 0, renderedPage.widthPt, renderedPage.heightPt]);
      try {
        const backgroundImage = new mupdf.Image(renderedPage.canvas.toBuffer('image/png'));
        try {
          pageDevice.fillImage(
            backgroundImage,
            [renderedPage.widthPt, 0, 0, renderedPage.heightPt, 0, 0],
            1,
          );
        } finally {
          backgroundImage.destroy?.();
        }
        drawTableModelsToPdfDevice(pageDevice, tableRebuild.models || []);
        drawMirroredTranslatedTextToPdfDevice(pageDevice, translatedPlan.operations, fontResources);
        drawMirroredSourceTextPixelsToPdfDevice(pageDevice, {
          sourceSpans: translatedPlan.plan.preservedSourceSpans || [],
          sourceWithTextCanvas: sourceCanvas,
          sourceWithoutTextCanvas,
          pageWidth: renderedPage.widthPt,
          pageHeight: renderedPage.heightPt,
        });
      } finally {
        pageDevice.close?.();
        writer.endPage();
      }
    }

    writer.close();
    const pdfBuffer = Buffer.from(outputBuffer.asUint8Array());
    await mkdir(path.dirname(outputPdf), { recursive: true });
    await writeFile(outputPdf, pdfBuffer);

    if (writeDebugImages) {
      const document = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
      try {
        for (let index = 0; index < selectedPages.length; index += 1) {
          const pageId = selectedPages[index];
          const page = document.loadPage(index);
          try {
            const scale = Number(renderDpi) / 72;
            const pixmap = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
            try {
              const debugPath = path.join(artifactsRoot, manifest.document_id, `${debugPrefix}_${pageId}.png`);
              await mkdir(path.dirname(debugPath), { recursive: true });
              await writeFile(debugPath, Buffer.from(pixmap.asPNG()));
              debugImages.push(debugPath);
            } finally {
              pixmap.destroy?.();
            }
          } finally {
            page.destroy?.();
          }
        }
      } finally {
        document.destroy?.();
      }
    }
  } finally {
    writer.destroy?.();
  }

  return {
    output_pdf: outputPdf,
    mirrored_pages: [...selectedPages],
    debug_images: debugImages,
  };
}
