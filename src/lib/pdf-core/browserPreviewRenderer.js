import mupdf from 'mupdf';

import { renderPagePixmapWithoutText } from './browserTextlessPageRenderer.js';
import { mirrorBBox } from './mirrorRenderPlan.js';
import { openMuPdfTwinDocument } from './pymupdfTwinAdapter.js';

export class BrowserPreviewConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowserPreviewConfigurationError';
  }
}

const TABLE_BACKGROUND_CLEAR_MARGIN_PT = 0.8;

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

function hexToRgb01(color) {
  const normalized = String(color || '').trim().replace(/^#/, '');
  if (normalized.length !== 6) {
    return [0, 0, 0];
  }
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function luminance(color01) {
  const [red, green, blue] = color01;
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function clusterEdgeCenters(values, tolerance) {
  const sorted = [...values].map((value) => Number(value)).sort((left, right) => left - right);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - last[last.length - 1]) > tolerance) {
      clusters.push([value]);
    } else {
      last.push(value);
    }
  }
  return clusters.map((cluster) => cluster.reduce((sum, value) => sum + value, 0) / cluster.length);
}

function snapToReference(value, references, tolerance) {
  let nearest = value;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const reference of references) {
    const distance = Math.abs(Number(value) - Number(reference));
    if (distance <= tolerance && distance < bestDistance) {
      bestDistance = distance;
      nearest = reference;
    }
  }
  return nearest;
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
  return (overlapX > 0 || gapX <= tolerance) && (overlapY > 0 || gapY <= tolerance);
}

function resolveRenderBBox(bbox, { pageWidth, mirrorTextBboxes, mirrorEnabled = true }) {
  if (!mirrorEnabled) {
    return [...bbox];
  }
  if (!mirrorTextBboxes) {
    return [...bbox];
  }
  return mirrorBBox(bbox, pageWidth);
}

function tableCellInnerBBox(bbox, inset = 1.0) {
  const next = [
    Number(bbox[0]) + inset,
    Number(bbox[1]) + inset,
    Number(bbox[2]) - inset,
    Number(bbox[3]) - inset,
  ];
  return validBBox(next) ? next : [...bbox];
}

function sourceSpaceTableBBox(bbox, { pageWidth, mirrorTextBboxes, mirrorEnabled = true }) {
  if (!mirrorEnabled) {
    return [...bbox];
  }
  const renderSpaceBBox = mirrorTextBboxes ? mirrorBBox(bbox, pageWidth) : [...bbox];
  const sourceSpaceBBox = mirrorBBox(renderSpaceBBox, pageWidth);
  return [
    Math.min(sourceSpaceBBox[0], sourceSpaceBBox[2]),
    Math.min(sourceSpaceBBox[1], sourceSpaceBBox[3]),
    Math.max(sourceSpaceBBox[0], sourceSpaceBBox[2]),
    Math.max(sourceSpaceBBox[1], sourceSpaceBBox[3]),
  ];
}

function groupTableComponentCellIds(cellBboxesById) {
  const groups = [];
  for (const [blockId, bbox] of Object.entries(cellBboxesById)) {
    let matchedGroupIndex = null;
    for (let index = 0; index < groups.length; index += 1) {
      if (groups[index].some((peerId) => bboxConnected(bbox, cellBboxesById[peerId]))) {
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
        if (base.some((leftId) => other.some((rightId) => bboxConnected(cellBboxesById[leftId], cellBboxesById[rightId])))) {
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

function normalizeGraphicEditOperation(edit) {
  if (!edit || typeof edit !== 'object') {
    return null;
  }
  if (edit.op === 'flip_graphic' && edit.block_id) {
    const normalized = { op: 'flip_graphic', block_id: String(edit.block_id) };
    if (Array.isArray(edit.value) && edit.value.length === 4) {
      normalized.value = edit.value.map((value) => Number(value));
    }
    if (Array.isArray(edit.source_value) && edit.source_value.length === 4) {
      normalized.source_value = edit.source_value.map((value) => Number(value));
    }
    return normalized;
  }
  if (edit.op === 'move_graphic' && edit.block_id && Array.isArray(edit.value) && edit.value.length === 4) {
    const normalized = {
      op: 'move_graphic',
      block_id: String(edit.block_id),
      value: edit.value.map((value) => Number(value)),
    };
    if (Array.isArray(edit.source_value) && edit.source_value.length === 4) {
      normalized.source_value = edit.source_value.map((value) => Number(value));
    }
    return normalized;
  }
  return null;
}

function componentTrackIntervals(cells, axis, tolerance = 1.3) {
  const startIndex = axis === 'x' ? 0 : 1;
  const endIndex = axis === 'x' ? 2 : 3;
  const refs = clusterEdgeCenters(
    cells.flatMap((cell) => [
      Number(cell.render_bbox[startIndex]),
      Number(cell.render_bbox[endIndex]),
    ]),
    tolerance,
  ).sort((left, right) => left - right);
  return refs.map((start, index) => [start, refs[index + 1] ?? start]);
}

function trackSpanForInterval(start, end, tracks) {
  let startIndex = 0;
  let endIndex = Math.max(0, tracks.length - 1);
  for (let index = 0; index < tracks.length; index += 1) {
    if (Math.abs(start - tracks[index][0]) <= 1.3 || start < tracks[index][1]) {
      startIndex = index;
      break;
    }
  }
  for (let index = Math.max(startIndex, 0); index < tracks.length; index += 1) {
    if (Math.abs(end - tracks[index][1]) <= 1.3 || end <= tracks[index][1]) {
      endIndex = index;
      break;
    }
  }
  return [startIndex, endIndex];
}

function collectTableEdgeSegments(cells) {
  const segments = new Map();
  function pushSegment(key, segment) {
    const current = segments.get(key);
    if (!current) {
      segments.set(key, { ...segment });
      return;
    }
    current.width = Math.max(current.width, segment.width);
    current.color = current.color.map((value, index) => (value + segment.color[index]) / 2);
  }
  for (const cell of cells) {
    const [x0, y0, x1, y1] = cell.render_bbox;
    pushSegment(`h:${y0}:${x0}:${x1}`, {
      orientation: 'h',
      start: [x0, y0],
      end: [x1, y0],
      color: [...cell.border_color],
      width: cell.border_width,
    });
    pushSegment(`h:${y1}:${x0}:${x1}`, {
      orientation: 'h',
      start: [x0, y1],
      end: [x1, y1],
      color: [...cell.border_color],
      width: cell.border_width,
    });
    pushSegment(`v:${x0}:${y0}:${y1}`, {
      orientation: 'v',
      start: [x0, y0],
      end: [x0, y1],
      color: [...cell.border_color],
      width: cell.border_width,
    });
    pushSegment(`v:${x1}:${y0}:${y1}`, {
      orientation: 'v',
      start: [x1, y0],
      end: [x1, y1],
      color: [...cell.border_color],
      width: cell.border_width,
    });
  }
  return [...segments.values()];
}

function expandWithImplicitTableCells(mirroredCells) {
  return mirroredCells;
}

function toUint8Array(pdfData) {
  if (pdfData instanceof Uint8Array) {
    return pdfData;
  }
  if (pdfData instanceof ArrayBuffer) {
    return new Uint8Array(pdfData);
  }
  if (ArrayBuffer.isView(pdfData)) {
    return new Uint8Array(pdfData.buffer, pdfData.byteOffset, pdfData.byteLength);
  }
  throw new BrowserPreviewConfigurationError('pdfData must be an ArrayBuffer or Uint8Array');
}

function openDocument(pdfData) {
  return mupdf.Document.openDocument(toUint8Array(pdfData), 'application/pdf');
}

async function pngBytesToCanvas(pngBytes) {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
    throw new BrowserPreviewConfigurationError('browser preview rendering requires OffscreenCanvas and createImageBitmap');
  }
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const image = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new BrowserPreviewConfigurationError('failed to create 2d context for browser preview canvas');
    }
    ctx.drawImage(image, 0, 0);
    return canvas;
  } finally {
    image.close?.();
  }
}

async function renderPdfPageToCanvas(pdfData, { pageIndex, scale, ignoreText = false }) {
  const document = openDocument(pdfData);
  try {
    const pixmap = ignoreText
      ? renderPagePixmapWithoutText(document, pageIndex, { scale })
      : document.loadPage(pageIndex).toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
    try {
      return await pngBytesToCanvas(pixmap.asPNG());
    } finally {
      pixmap.destroy?.();
    }
  } finally {
    document.destroy?.();
  }
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
  const pixelCount = Math.max(1, imageData.length / 4);
  return [
    imageData.reduce((sum, value, index) => (index % 4 === 0 ? sum + value : sum), 0) / (255 * pixelCount),
    imageData.reduce((sum, value, index) => (index % 4 === 1 ? sum + value : sum), 0) / (255 * pixelCount),
    imageData.reduce((sum, value, index) => (index % 4 === 2 ? sum + value : sum), 0) / (255 * pixelCount),
  ];
}

function sampleRegionBorderColor(sourceCtx, bbox, scaleX, scaleY) {
  const [x0, y0, x1, y1] = bboxToIntRegion(ptRectToPx(bbox, scaleX, scaleY), sourceCtx.canvas.width, sourceCtx.canvas.height);
  if (x1 <= x0 || y1 <= y0) {
    return [0.2, 0.2, 0.2];
  }
  const imageData = sourceCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let totalRed = 0;
  let totalGreen = 0;
  let totalBlue = 0;
  let samples = 0;
  const width = x1 - x0;
  const height = y1 - y0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (row !== 0 && row !== height - 1 && column !== 0 && column !== width - 1) {
        continue;
      }
      const offset = ((row * width) + column) * 4;
      totalRed += imageData[offset];
      totalGreen += imageData[offset + 1];
      totalBlue += imageData[offset + 2];
      samples += 1;
    }
  }
  if (samples === 0) {
    return [0.2, 0.2, 0.2];
  }
  return [
    totalRed / (255 * samples),
    totalGreen / (255 * samples),
    totalBlue / (255 * samples),
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

function planTableRebuildComponents(layout, fitted, {
  pageWidth = Number(layout.page_size_pt[0]),
  pageHeight = Number(layout.page_size_pt[1]),
  mirrorEnabled = true,
  mirrorTextBboxes = true,
} = {}) {
  const sourceBlocks = new Map((layout.blocks || []).map((block) => [block.block_id, block]));
  const fittedSourceIds = new Set((fitted.blocks || []).map((block) => block.source_block_id));
  const tableCellSourceBboxes = {};

  for (const [blockId, block] of sourceBlocks.entries()) {
    if (block.type !== 'table_cell' || !fittedSourceIds.has(blockId)) {
      continue;
    }
    const sourceBBox = sourceSpaceTableBBox(block.bbox, { pageWidth, mirrorTextBboxes, mirrorEnabled });
    if (!validBBox(sourceBBox)) {
      continue;
    }
    tableCellSourceBboxes[blockId] = sourceBBox;
  }

  return groupTableComponentCellIds(tableCellSourceBboxes).map((cellIds, index) => {
    const componentBboxes = cellIds.map((cellId) => tableCellSourceBboxes[cellId]);
    const sourceUnionBBox = unionBBox(componentBboxes);
    const sourceUnionArea = bboxArea(sourceUnionBBox);
    const detectedSourceArea = rectanglesUnionArea(componentBboxes);
    const coverageRatio = sourceUnionArea > 0 ? (detectedSourceArea / sourceUnionArea) : 0;
    return {
      component_id: `p${layout.page_id}_tc${index + 1}`,
      page_id: layout.page_id,
      source_union_bbox: sourceUnionBBox,
      source_union_area: sourceUnionArea,
      detected_source_area: detectedSourceArea,
      coverage_ratio: coverageRatio,
      eligible_for_rebuild: true,
      clear_bbox: inflateBBox(sourceUnionBBox, {
        inset: TABLE_BACKGROUND_CLEAR_MARGIN_PT,
        pageWidth,
        pageHeight,
      }),
      cell_ids: [...cellIds].sort(),
      fallback_reason: '',
    };
  });
}

function collectMirroredTableCells(sourceCanvas, layout, fitted, {
  pageWidth = Number(layout.page_size_pt[0]),
  mirrorEnabled = true,
  mirrorTextBboxes = true,
  samplingCanvas = sourceCanvas,
} = {}) {
  const sampleScaleX = samplingCanvas.width / Math.max(1, pageWidth);
  const sampleScaleY = samplingCanvas.height / Math.max(1, Number(layout.page_size_pt[1]));
  const samplingCtx = samplingCanvas.getContext('2d');
  if (!samplingCtx) {
    throw new BrowserPreviewConfigurationError('failed to create sampling context for table cells');
  }
  const styles = new Map((layout.styles || []).map((style) => [style.style_id, style]));
  const sourceBlocks = new Map((layout.blocks || []).map((block) => [block.block_id, block]));
  const fittedBySourceId = new Map((fitted.blocks || []).map((block) => [block.source_block_id, block]));

  const sourceTableBboxesRaw = (layout.blocks || [])
    .filter((block) => block.type === 'table_cell')
    .map((block) => resolveRenderBBox(block.bbox, { pageWidth, mirrorTextBboxes, mirrorEnabled }));

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
    const sourceBBoxForSampling = sourceSpaceTableBBox(sourceBlock.bbox, { pageWidth, mirrorTextBboxes, mirrorEnabled });
    const sourceBBoxRaw = resolveRenderBBox(sourceBlock.bbox, { pageWidth, mirrorTextBboxes, mirrorEnabled });
    let sourceBBox = [
      snapToReference(sourceBBoxRaw[0], sourceXRefs, 1.3),
      snapToReference(sourceBBoxRaw[1], sourceYRefs, 1.3),
      snapToReference(sourceBBoxRaw[2], sourceXRefs, 1.3),
      snapToReference(sourceBBoxRaw[3], sourceYRefs, 1.3),
    ];
    if (!validBBox(sourceBBox)) {
      sourceBBox = sourceBBoxRaw;
    }
    const renderBBox = resolveRenderBBox(fittedBlock.bbox, { pageWidth, mirrorTextBboxes, mirrorEnabled });
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
  mirrorEnabled = true,
  mirrorTextBboxes = true,
  coverageThreshold = 0.0,
  samplingCanvas = sourceCanvas,
} = {}) {
  const pageWidth = Number(layout.page_size_pt[0]);
  const pageHeight = Number(layout.page_size_pt[1]);
  const components = planTableRebuildComponents(layout, fitted, {
    pageWidth,
    pageHeight,
    mirrorEnabled,
    mirrorTextBboxes,
  });
  if (components.length === 0) {
    return {
      coverage_threshold: coverageThreshold,
      components: [],
      models: [],
    };
  }

  const componentByCellId = new Map();
  for (const component of components) {
    for (const cellId of component.cell_ids || []) {
      componentByCellId.set(cellId, component);
    }
  }

  const mirroredCells = collectMirroredTableCells(sourceCanvas, layout, fitted, {
    pageWidth,
    mirrorEnabled,
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
            bbox: [...cell.render_bbox],
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

function clearTableRegionsFromSourceCanvas(sourceCanvas, componentPlans, {
  pageWidth,
  pageHeight,
}) {
  if (!componentPlans || componentPlans.length === 0) {
    return sourceCanvas;
  }
  const widthPx = sourceCanvas.width;
  const heightPx = sourceCanvas.height;
  const scaleX = widthPx / Math.max(1, pageWidth);
  const scaleY = heightPx / Math.max(1, pageHeight);
  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!ctx || !sourceCtx) {
    throw new BrowserPreviewConfigurationError('failed to create canvas context for preview clear pass');
  }
  ctx.drawImage(sourceCanvas, 0, 0);
  for (const component of componentPlans.filter((entry) => entry.eligible_for_rebuild && entry.clear_bbox)) {
    const fillColor = sampleBackgroundNearBBox(sourceCtx, component.source_union_bbox, {
      pageWidth,
      pageHeight,
      scaleX,
      scaleY,
    });
    fillCanvasIntRegion(ctx, ptRectToPx(component.clear_bbox, scaleX, scaleY), fillColor);
  }
  return canvas;
}

function mirrorCanvasHorizontally(canvas) {
  const mirrored = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = mirrored.getContext('2d');
  if (!ctx) {
    throw new BrowserPreviewConfigurationError('failed to create mirrored preview canvas context');
  }
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  return mirrored;
}

function extractImageBboxes(page) {
  if (!page || typeof page.getImageBlocks !== 'function') {
    return [];
  }
  return page.getImageBlocks().map((bbox) => bbox.map((value) => Number(value))).filter((bbox) => validBBox(bbox));
}

function restoreImageOrientations(canvas, {
  imageBboxes,
  pageWidth,
  pageHeight,
}) {
  if (!imageBboxes || imageBboxes.length === 0) {
    return canvas;
  }
  const output = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = output.getContext('2d');
  if (!ctx) {
    throw new BrowserPreviewConfigurationError('failed to create preview image restore context');
  }
  ctx.drawImage(canvas, 0, 0);
  for (const bbox of imageBboxes) {
    const mirroredBbox = [pageWidth - bbox[2], bbox[1], pageWidth - bbox[0], bbox[3]];
    const renderBBoxPx = bboxToPixelBounds(mirroredBbox, {
      pageWidth,
      pageHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      paddingPoints: 0,
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
    const regionCanvas = new OffscreenCanvas(width, height);
    const regionCtx = regionCanvas.getContext('2d');
    if (!regionCtx) {
      continue;
    }
    regionCtx.drawImage(output, x0, y0, width, height, 0, 0, width, height);
    ctx.save();
    ctx.translate(x1, y0);
    ctx.scale(-1, 1);
    ctx.drawImage(regionCanvas, 0, 0, width, height);
    ctx.restore();
  }
  return output;
}

function applyGraphicRegionEdits(canvas, {
  regions,
  edits,
  pageWidth,
  pageHeight,
  mirrorEnabled = true,
}) {
  const normalizedEdits = (edits || []).map(normalizeGraphicEditOperation).filter(Boolean);
  if (!regions || regions.length === 0 || normalizedEdits.length === 0) {
    return canvas;
  }
  const output = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = output.getContext('2d');
  if (!ctx) {
    throw new BrowserPreviewConfigurationError('failed to create graphic edit preview context');
  }
  ctx.drawImage(canvas, 0, 0);
  const regionById = new Map((regions || []).map((region) => [region.region_id, region]));

  for (const edit of normalizedEdits) {
    const region = regionById.get(edit.block_id);
    const sourceBbox = Array.isArray(edit.source_value) && edit.source_value.length === 4
      ? edit.source_value
      : (region?.bbox || null);
    if (!sourceBbox) {
      continue;
    }
    const oldRenderBBox = mirrorEnabled
      ? [pageWidth - sourceBbox[2], sourceBbox[1], pageWidth - sourceBbox[0], sourceBbox[3]]
      : [...sourceBbox];
    const oldBounds = bboxToPixelBounds(oldRenderBBox, {
      pageWidth,
      pageHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      paddingPoints: 0,
    });
    if (!oldBounds) {
      continue;
    }
    if (edit.op === 'flip_graphic') {
      const destinationBbox = Array.isArray(edit.value) && edit.value.length === 4
        ? edit.value
        : sourceBbox;
      const newRenderBBox = mirrorEnabled
        ? [pageWidth - destinationBbox[2], destinationBbox[1], pageWidth - destinationBbox[0], destinationBbox[3]]
        : [...destinationBbox];
      const newBounds = bboxToPixelBounds(newRenderBBox, {
        pageWidth,
        pageHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        paddingPoints: 0,
      });
      if (!newBounds) {
        continue;
      }
      const [x0, y0, x1, y1] = oldBounds;
      const width = x1 - x0;
      const height = y1 - y0;
      const regionCanvas = new OffscreenCanvas(width, height);
      const regionCtx = regionCanvas.getContext('2d');
      if (!regionCtx) {
        continue;
      }
      regionCtx.drawImage(output, x0, y0, width, height, 0, 0, width, height);
      ctx.clearRect(x0, y0, width, height);
      const destinationWidth = newBounds[2] - newBounds[0];
      const destinationHeight = newBounds[3] - newBounds[1];
      ctx.save();
      ctx.translate(newBounds[2], newBounds[1]);
      ctx.scale(-1, 1);
      ctx.drawImage(regionCanvas, 0, 0, width, height, 0, 0, destinationWidth, destinationHeight);
      ctx.restore();
      continue;
    }
    if (edit.op === 'move_graphic') {
      const newRenderBBox = mirrorEnabled
        ? [pageWidth - edit.value[2], edit.value[1], pageWidth - edit.value[0], edit.value[3]]
        : [...edit.value];
      const newBounds = bboxToPixelBounds(newRenderBBox, {
        pageWidth,
        pageHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        paddingPoints: 0,
      });
      if (!newBounds) {
        continue;
      }
      const [x0, y0, x1, y1] = oldBounds;
      const width = x1 - x0;
      const height = y1 - y0;
      const regionCanvas = new OffscreenCanvas(width, height);
      const regionCtx = regionCanvas.getContext('2d');
      if (!regionCtx) {
        continue;
      }
      regionCtx.drawImage(output, x0, y0, width, height, 0, 0, width, height);
      ctx.clearRect(x0, y0, width, height);
      ctx.drawImage(regionCanvas, newBounds[0], newBounds[1], newBounds[2] - newBounds[0], newBounds[3] - newBounds[1]);
    }
  }
  return output;
}

function resolveRequestedPages(manifest, requestedPages) {
  if (!requestedPages || requestedPages.size === 0) {
    return Array.from({ length: Number(manifest.page_count || 0) }, (_, index) => index + 1);
  }
  return [...requestedPages].map((pageId) => Number(pageId)).sort((left, right) => left - right);
}

async function canvasToPngArrayBuffer(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

export async function renderCanvasPreviewPages(
  manifest,
  {
    sourcePdfData,
    pageArtifactsById,
    requestedPages = null,
    renderDpi = 150,
    clearTableRegionsFromFitted = true,
    redrawTableBordersFromFitted = false,
    mirrorEnabled = true,
    restoreImageOrientationsEnabled = true,
    mirrorTableBboxes = false,
    graphicRegionEditsByPage = null,
  } = {},
) {
  if (redrawTableBordersFromFitted) {
    throw new BrowserPreviewConfigurationError('browser preview renderer does not support redrawTableBordersFromFitted yet');
  }
  if (!manifest || !manifest.document_id) {
    throw new BrowserPreviewConfigurationError('manifest must include document_id');
  }
  if (!pageArtifactsById || typeof pageArtifactsById.get !== 'function') {
    throw new BrowserPreviewConfigurationError('pageArtifactsById map is required');
  }

  const selectedPages = resolveRequestedPages(manifest, requestedPages);
  const document = openDocument(sourcePdfData);
  const twinDocument = openMuPdfTwinDocument(sourcePdfData);
  try {
    const renderedPages = [];
    for (const pageId of selectedPages) {
      const pageIndex = pageId - 1;
      const page = document.loadPage(pageIndex);
      const twinPage = twinDocument.loadPage(pageIndex);
      try {
        const pageBounds = page.getBounds();
        const pageWidth = Number(pageBounds[2] - pageBounds[0]);
        const pageHeight = Number(pageBounds[3] - pageBounds[1]);
        const pageArtifacts = pageArtifactsById.get(pageId);
        if (!pageArtifacts?.layout || !pageArtifacts?.fitted) {
          throw new BrowserPreviewConfigurationError(`missing page artifacts for page ${pageId}`);
        }

        let sourceWithoutTextCanvas = await renderPdfPageToCanvas(sourcePdfData, {
          pageIndex,
          scale: Number(renderDpi) / 72,
          ignoreText: true,
        });
        const tableRebuild = buildMirroredTableRebuildData(sourceWithoutTextCanvas, pageArtifacts.layout, pageArtifacts.fitted, {
          mirrorEnabled,
          mirrorTextBboxes: mirrorTableBboxes,
        });

        if (clearTableRegionsFromFitted) {
          sourceWithoutTextCanvas = clearTableRegionsFromSourceCanvas(sourceWithoutTextCanvas, tableRebuild.components, {
            pageWidth,
            pageHeight,
          });
        }

        let mirroredCanvas = sourceWithoutTextCanvas;
        if (mirrorEnabled) {
          mirroredCanvas = mirrorCanvasHorizontally(sourceWithoutTextCanvas);
          if (restoreImageOrientationsEnabled) {
            mirroredCanvas = restoreImageOrientations(mirroredCanvas, {
              imageBboxes: extractImageBboxes(twinPage),
              pageWidth,
              pageHeight,
            });
          }
        }

        if (graphicRegionEditsByPage?.[pageId]) {
          mirroredCanvas = applyGraphicRegionEdits(mirroredCanvas, {
            regions: pageArtifacts.layout.graphic_regions || [],
            edits: graphicRegionEditsByPage[pageId],
            pageWidth,
            pageHeight,
            mirrorEnabled,
          });
        }

        renderedPages.push({
          pageId,
          widthPt: pageWidth,
          heightPt: pageHeight,
          pngBytes: await canvasToPngArrayBuffer(mirroredCanvas),
          tables: tableRebuild.models,
        });
      } finally {
        twinPage.destroy?.();
        page.destroy?.();
      }
    }
    return renderedPages;
  } finally {
    twinDocument.destroy?.();
    document.destroy?.();
  }
}
