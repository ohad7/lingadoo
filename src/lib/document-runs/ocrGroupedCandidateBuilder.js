import {
  _assign_columns as assignColumnsFromPort,
  _bbox_intersection_area as bboxIntersectionAreaFromPort,
  _infer_direction as inferDirectionFromPort,
  _ordered_line_indexes as orderedLineIndexesFromPort,
} from '../pdf-core/digitalStagePort.js';
import { detectExtractionWarningForText } from '../pdf-core/mupdfExtraction.js';
import {
  extractTesseractBoxesByGranularity,
  normalizeTesseractProgressMessage,
  resolveTesseractLanguageSpec,
} from '../tesseractOcr.js';

const OCR_FALLBACK_STYLE_ID = '__ocr_grouped_fallback__';
const DEFAULT_LINE_SPACING = 1.2;
const OCR_BACKGROUND_SAMPLE_DISTANCE_PX = 6;
const OCR_SOURCE_COVERAGE_THRESHOLD = 0.5;
const OCR_GROUPED_PADDING_PT = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cloneStyle(style) {
  return {
    ...style,
    font_size: Number(style?.font_size) || 10,
    line_spacing: Number(style?.line_spacing) || DEFAULT_LINE_SPACING,
  };
}

function normalizeOcrConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric > 1) {
    return clamp(numeric / 100, 0, 1);
  }
  return clamp(numeric, 0, 1);
}

function estimateFontSizeFromOcrBbox(bbox) {
  const height = Math.max(1, Number(bbox?.[3] || 0) - Number(bbox?.[1] || 0));
  return Math.round(clamp(height * 0.82, 6, 48) * 1000) / 1000;
}

function normalizePageDirection(value) {
  return String(value || '').trim().toUpperCase() === 'RTL' ? 'RTL' : 'LTR';
}

export function shouldUseTextlessOcrInputForPageSummary(pageSummary) {
  const pageType = String(pageSummary?.type || '').trim().toUpperCase();
  return pageType === 'DIGITAL' || pageType === 'MIXED';
}

function sourceBlockHasCorruptedText(block) {
  return Boolean(detectExtractionWarningForText(String(block?.text || ''))?.suspicious);
}

export function collectCorruptedSourceBlockIds(sourceLayout) {
  const ids = new Set();
  for (const block of Array.isArray(sourceLayout?.blocks) ? sourceLayout.blocks : []) {
    const blockId = String(block?.block_id || '').trim();
    if (!blockId) {
      continue;
    }
    if (sourceBlockHasCorruptedText(block)) {
      ids.add(blockId);
    }
  }
  return ids;
}

export function shouldUseTextlessOcrInputForPage({ pageSummary, sourceLayout = null } = {}) {
  if (!shouldUseTextlessOcrInputForPageSummary(pageSummary)) {
    return false;
  }
  return collectCorruptedSourceBlockIds(sourceLayout).size === 0;
}

export function shouldEnableOcrBackgroundCoverForPageSummary(pageSummary) {
  const pageType = String(pageSummary?.type || '').trim().toUpperCase();
  return pageType === 'SCANNED' || pageType === 'MIXED';
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load OCR page image: ${url}`));
    image.src = url;
  });
}

function rectWidth(bbox) {
  return Math.max(0, Number(bbox?.[2] || 0) - Number(bbox?.[0] || 0));
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox?.[3] || 0) - Number(bbox?.[1] || 0));
}

function validBBox(bbox) {
  return rectWidth(bbox) > 0 && rectHeight(bbox) > 0;
}

function bboxArea(bbox) {
  return rectWidth(bbox) * rectHeight(bbox);
}

function inflatePageBBox(bbox, { padding, pageWidth, pageHeight }) {
  const resolvedPadding = Math.max(0, Number(padding) || 0);
  return [
    Math.max(0, Number(bbox?.[0] || 0) - resolvedPadding),
    Math.max(0, Number(bbox?.[1] || 0) - resolvedPadding),
    Math.min(Math.max(1, Number(pageWidth) || 1), Number(bbox?.[2] || 0) + resolvedPadding),
    Math.min(Math.max(1, Number(pageHeight) || 1), Number(bbox?.[3] || 0) + resolvedPadding),
  ];
}

function bboxToIntRegion(bbox, width, height) {
  const x0 = Math.max(0, Math.min(width, Math.floor(Number(bbox[0]))));
  const y0 = Math.max(0, Math.min(height, Math.floor(Number(bbox[1]))));
  const x1 = Math.max(0, Math.min(width, Math.ceil(Number(bbox[2]))));
  const y1 = Math.max(0, Math.min(height, Math.ceil(Number(bbox[3]))));
  return [x0, y0, x1, y1];
}

function sampleRegionFillColor(sourceCtx, bbox) {
  const [x0, y0, x1, y1] = bboxToIntRegion(bbox, sourceCtx.canvas.width, sourceCtx.canvas.height);
  if (x1 <= x0 || y1 <= y0) {
    return [1, 1, 1];
  }
  const imageData = sourceCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const pixelCount = Math.max(1, imageData.length / 4);
  return [
    imageData.reduce((sum, value, index) => (index % 4 === 0 ? sum + value : sum), 0) / (255 * pixelCount),
    imageData.reduce((sum, value, index) => (index % 4 === 1 ? sum + value : sum), 0) / (255 * pixelCount),
    imageData.reduce((sum, value, index) => (index % 4 === 2 ? sum + value : sum), 0) / (255 * pixelCount),
  ];
}

function sampleBackgroundNearBBox(sourceCtx, bbox, { pageWidth, pageHeight }) {
  const [x0, y0, x1, y1] = bbox;
  const candidates = [
    [Math.max(0, x0 - OCR_BACKGROUND_SAMPLE_DISTANCE_PX), Math.max(0, y0 - OCR_BACKGROUND_SAMPLE_DISTANCE_PX), Math.max(0, x0 - 1), Math.max(0, y0 - 1)],
    [x1 + 1, Math.max(0, y0 - OCR_BACKGROUND_SAMPLE_DISTANCE_PX), Math.min(pageWidth, x1 + OCR_BACKGROUND_SAMPLE_DISTANCE_PX), Math.max(0, y0 - 1)],
    [Math.max(0, x0 - OCR_BACKGROUND_SAMPLE_DISTANCE_PX), y1 + 1, Math.max(0, x0 - 1), Math.min(pageHeight, y1 + OCR_BACKGROUND_SAMPLE_DISTANCE_PX)],
    [x1 + 1, y1 + 1, Math.min(pageWidth, x1 + OCR_BACKGROUND_SAMPLE_DISTANCE_PX), Math.min(pageHeight, y1 + OCR_BACKGROUND_SAMPLE_DISTANCE_PX)],
  ];
  for (const candidate of candidates) {
    if (!validBBox(candidate)) {
      continue;
    }
    return sampleRegionFillColor(sourceCtx, candidate);
  }
  return [1, 1, 1];
}

function drawImageToSamplingCanvas(image) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create OCR sampling canvas.');
  }
  ctx.drawImage(image, 0, 0);
  return {
    canvas,
    ctx,
  };
}

function buildFallbackStyleId(pageId) {
  return `${OCR_FALLBACK_STYLE_ID}_${Number(pageId)}`;
}

function ensureOcrFallbackStyle(styles, { pageId, pageDirection }) {
  const fallbackStyleId = buildFallbackStyleId(pageId);
  const hasFallback = styles.some((style) => String(style?.style_id || '') === fallbackStyleId);
  if (!hasFallback) {
    styles.push({
      style_id: fallbackStyleId,
      font_family: 'unknown',
      font_size: 10,
      weight: 'normal',
      italic: false,
      color: '#000000',
      alignment: pageDirection === 'RTL' ? 'right' : 'left',
      line_spacing: DEFAULT_LINE_SPACING,
      render_mode: 0,
      stroke_width: 0,
    });
  }
  return fallbackStyleId;
}

function buildSyntheticOcrStyle({ pageId, index, bbox, text }) {
  const direction = String(inferDirectionFromPort(String(text || '')) || 'LTR').toUpperCase() === 'RTL' ? 'RTL' : 'LTR';
  return {
    style_id: `p${Number(pageId)}_ocr_style_${index + 1}`,
    font_family: 'unknown',
    font_size: estimateFontSizeFromOcrBbox(bbox),
    weight: 'normal',
    italic: false,
    color: '#000000',
    alignment: direction === 'RTL' ? 'right' : 'left',
    line_spacing: DEFAULT_LINE_SPACING,
    render_mode: 0,
    stroke_width: 0,
  };
}

function cloneSourceBlockForHybridLayout(block) {
  return {
    ...block,
    bbox: Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1],
    source_line_bbox: Array.isArray(block?.source_line_bbox)
      ? block.source_line_bbox.map((value) => Number(value))
      : null,
  };
}

function normalizeSourceLayoutElements(sourceLayout, {
  excludedBlockIds = null,
} = {}) {
  return (Array.isArray(sourceLayout?.blocks) ? sourceLayout.blocks : []).map((block) => ({
    kind: 'source',
    block_id: String(block?.block_id || ''),
    bbox: Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1],
    text: String(block?.text || '').trim(),
    direction: inferDirectionFromPort(block?.text || ''),
    style_id: String(block?.style_id || ''),
    confidence: null,
    text_tightness: String(block?.text_tightness || ''),
    sourceBlock: cloneSourceBlockForHybridLayout(block),
  })).filter((element) => (
    element.block_id
    && element.text
    && validBBox(element.bbox)
    && !(excludedBlockIds instanceof Set && excludedBlockIds.has(element.block_id))
  ));
}

function resolveCoverageWithSourceBlocks(bbox, sourceElements) {
  const targetArea = bboxArea(bbox);
  if (!(targetArea > 0)) {
    return 0;
  }
  let bestCoverage = 0;
  for (const sourceElement of sourceElements) {
    const sourceBBox = Array.isArray(sourceElement?.bbox) ? sourceElement.bbox : null;
    if (!sourceBBox || !validBBox(sourceBBox)) {
      continue;
    }
    const sourceArea = bboxArea(sourceBBox);
    if (!(sourceArea > 0)) {
      continue;
    }
    const intersectionArea = bboxIntersectionAreaFromPort(bbox, sourceBBox);
    if (!(intersectionArea > 0)) {
      continue;
    }
    bestCoverage = Math.max(bestCoverage, intersectionArea / Math.min(targetArea, sourceArea));
  }
  return bestCoverage;
}

export function convertOcrBboxToPageBbox(bbox, {
  imageWidth,
  imageHeight,
  pageWidthPt,
  pageHeightPt,
}) {
  const safeImageWidth = Math.max(1, Number(imageWidth) || 1);
  const safeImageHeight = Math.max(1, Number(imageHeight) || 1);
  const safePageWidth = Math.max(1, Number(pageWidthPt) || 1);
  const safePageHeight = Math.max(1, Number(pageHeightPt) || 1);
  const scaleX = safePageWidth / safeImageWidth;
  const scaleY = safePageHeight / safeImageHeight;
  return [
    Number(bbox?.[0] || 0) * scaleX,
    Number(bbox?.[1] || 0) * scaleY,
    Number(bbox?.[2] || 0) * scaleX,
    Number(bbox?.[3] || 0) * scaleY,
  ].map((value) => Math.round(value * 1000) / 1000);
}

export function resolveOcrBorrowedStyleId({
  bbox,
  sourceLayout,
  minimumIntersectionArea = 1,
}) {
  const sourceBlocks = Array.isArray(sourceLayout?.blocks) ? sourceLayout.blocks : [];
  let bestStyleId = null;
  let bestIntersectionArea = 0;
  for (const block of sourceBlocks) {
    const blockBbox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : null;
    if (!Array.isArray(blockBbox) || blockBbox.length !== 4) {
      continue;
    }
    const intersectionArea = bboxIntersectionAreaFromPort(bbox, blockBbox);
    if (intersectionArea < minimumIntersectionArea || intersectionArea <= bestIntersectionArea) {
      continue;
    }
    const styleId = String(block?.style_id || '').trim();
    if (!styleId) {
      continue;
    }
    bestStyleId = styleId;
    bestIntersectionArea = intersectionArea;
  }
  return bestStyleId;
}

function clonePageStyles(sourceLayout, pageId, pageDirection) {
  const styles = Array.isArray(sourceLayout?.styles)
    ? sourceLayout.styles.map((style) => cloneStyle(style))
    : [];
  const fallbackStyleId = ensureOcrFallbackStyle(styles, { pageId, pageDirection });
  return {
    styles,
    fallbackStyleId,
  };
}

export function buildOcrGroupedPageLayout({
  manifestDocumentId,
  pageSummary,
  sourceLayout = null,
  groupedBoxes,
  imageWidth,
  imageHeight,
}) {
  const pageId = Number(pageSummary?.page_id || sourceLayout?.page_id || 0);
  const pageWidthPt = Number(sourceLayout?.page_size_pt?.[0] || pageSummary?.width_pt || 1);
  const pageHeightPt = Number(sourceLayout?.page_size_pt?.[1] || pageSummary?.height_pt || 1);
  const pageDirection = normalizePageDirection(pageSummary?.direction || inferDirectionFromPort(
    (groupedBoxes || []).map((box) => String(box?.text || '')).join('\n'),
  ));
  const { styles, fallbackStyleId } = clonePageStyles(sourceLayout, pageId, pageDirection);
  const styleIds = new Set(styles.map((style) => String(style.style_id || '')));
  const corruptedSourceBlockIds = collectCorruptedSourceBlockIds(sourceLayout);
  const keepSourceBlocks = Array.isArray(sourceLayout?.blocks);
  const sourceElements = keepSourceBlocks
    ? normalizeSourceLayoutElements(sourceLayout, { excludedBlockIds: corruptedSourceBlockIds })
    : [];
  const normalizedOcrElements = (groupedBoxes || []).map((box, index) => {
    const bbox = inflatePageBBox(
      convertOcrBboxToPageBbox(box.bbox, {
        imageWidth,
        imageHeight,
        pageWidthPt,
        pageHeightPt,
      }),
      {
        padding: OCR_GROUPED_PADDING_PT,
        pageWidth: pageWidthPt,
        pageHeight: pageHeightPt,
      },
    );
    let styleId = resolveOcrBorrowedStyleId({ bbox, sourceLayout });
    if (!styleId || !styleIds.has(styleId)) {
      const syntheticStyle = buildSyntheticOcrStyle({
        pageId,
        index,
        bbox,
        text: box.text,
      });
      styles.push(syntheticStyle);
      styleId = syntheticStyle.style_id;
      styleIds.add(styleId);
    }
    return {
      bbox,
      text: String(box?.text || '').trim(),
      direction: inferDirectionFromPort(box?.text || ''),
      style_id: styleId || fallbackStyleId,
      column: 0,
      confidence: normalizeOcrConfidence(box?.confidence),
      text_tightness: 'tight',
      block_id: `p${pageId}_ocr_b${index + 1}`,
      background_fill_enabled: Boolean(box?.background_fill_enabled),
      background_fill_color: Array.isArray(box?.background_fill_color)
        ? box.background_fill_color.map((value) => Number(value))
        : undefined,
      kind: 'ocr',
    };
  }).filter((element) => element.text && element.bbox[2] > element.bbox[0] && element.bbox[3] > element.bbox[1]);
  const filteredOcrElements = sourceElements.length > 0
    ? normalizedOcrElements.filter((element) => (
      resolveCoverageWithSourceBlocks(element.bbox, sourceElements) < OCR_SOURCE_COVERAGE_THRESHOLD
    ))
    : normalizedOcrElements;
  const normalizedElements = [...sourceElements, ...filteredOcrElements];

  const columnOrder = normalizedElements.length > 0
    ? assignColumnsFromPort(normalizedElements, pageWidthPt, pageDirection)
    : [];
  const orderedIndexes = normalizedElements.length > 0
    ? orderedLineIndexesFromPort(normalizedElements, columnOrder, pageDirection)
    : [];
  const blocks = orderedIndexes.map((elementIndex, index) => {
    const element = normalizedElements[elementIndex];
    if (element.kind === 'source' && element.sourceBlock) {
      return {
        ...element.sourceBlock,
        page_id: pageId,
        reading_order: index + 1,
      };
    }
    return {
      block_id: element.block_id || `p${pageId}_ocr_b${index + 1}`,
      page_id: pageId,
      type: 'text_line',
      bbox: element.bbox,
      text: element.text,
      style_id: element.style_id || fallbackStyleId,
      reading_order: index + 1,
      source: 'ocr_grouped',
      confidence: element.confidence ?? 0.8,
      flattened_line_breaks: false,
      original_text: null,
      text_tightness: element.text_tightness,
      source_line_bbox: null,
      source_bottom_inset_ratio: 0,
      background_fill_enabled: element.background_fill_enabled,
      background_fill_color: element.background_fill_color,
    };
  });

  return {
    schema_version: String(sourceLayout?.schema_version || '1.0'),
    stage: String(sourceLayout?.stage || 'page_layout'),
    document_id: String(sourceLayout?.document_id || manifestDocumentId || ''),
    page_id: pageId,
    page_size_pt: [pageWidthPt, pageHeightPt],
    extraction_warning: null,
    blocks,
    styles,
    // OCR candidates render against a single raster page background. Keep the
    // page image stable and avoid source graphic/image editing surfaces that
    // were derived from the detected-text extractor.
    images: [],
    graphic_regions: [],
  };
}

async function loadTesseractRuntime() {
  const [
    { createWorker, OEM },
    workerModule,
    coreModule,
  ] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url'),
    import('tesseract.js-core/tesseract-core-lstm.wasm.js?url'),
  ]);
  return {
    createWorker,
    OEM,
    workerPath: workerModule.default,
    corePath: coreModule.default,
  };
}

export async function buildOcrGroupedCandidateLayouts({
  manifest,
  requestedPageIds,
  sourceLayoutsByPageId,
  pagePreviewRecordsById,
  sourceLanguageCode,
  targetLanguageCode,
  onProgress = () => {},
}) {
  const { createWorker, OEM, workerPath, corePath } = await loadTesseractRuntime();
  const languageSpec = resolveTesseractLanguageSpec(sourceLanguageCode, targetLanguageCode);
  const layouts = [];
  const confidenceSamples = [];
  const perPageBoxCounts = [];
  let lastProgress = -1;
  let lastStatus = '';
  const worker = await createWorker(languageSpec.spec, OEM.LSTM_ONLY, {
    workerPath,
    corePath,
    logger: (message) => {
      const next = normalizeTesseractProgressMessage(message);
      if (!next) {
        return;
      }
      const roundedProgress = next.progress == null ? -1 : Math.round(next.progress * 100) / 100;
      if (next.status === lastStatus && roundedProgress === lastProgress) {
        return;
      }
      lastStatus = next.status;
      lastProgress = roundedProgress;
      onProgress({
        status: next.status,
        progress: next.progress,
      });
    },
  });

  try {
    const pageSummariesById = new Map((manifest?.pages || []).map((page) => [Number(page?.page_id), page]));
    for (let index = 0; index < requestedPageIds.length; index += 1) {
      const pageId = Number(requestedPageIds[index]);
      const previewRecord = pagePreviewRecordsById.get(pageId);
      if (!previewRecord) {
        throw new Error(`Missing OCR preview record for page ${pageId}`);
      }
      const pageSummary = pageSummariesById.get(pageId) || {
        page_id: pageId,
        width_pt: previewRecord.pageWidthPt,
        height_pt: previewRecord.pageHeightPt,
        direction: 'LTR',
      };
      const image = await loadImageElement(previewRecord.url);
      const sampling = shouldEnableOcrBackgroundCoverForPageSummary(pageSummary)
        ? drawImageToSamplingCanvas(image)
        : null;
      const result = await worker.recognize(image, {}, { blocks: true });
      const groupedBoxes = (extractTesseractBoxesByGranularity(result?.data).grouped || []).map((box) => ({
        ...box,
        background_fill_enabled: Boolean(sampling),
        background_fill_color: sampling
          ? sampleBackgroundNearBBox(sampling.ctx, box.bbox, {
            pageWidth: sampling.canvas.width,
            pageHeight: sampling.canvas.height,
          })
          : null,
      }));
      perPageBoxCounts.push({
        pageId,
        boxCount: groupedBoxes.length,
      });
      for (const box of groupedBoxes) {
        const confidence = normalizeOcrConfidence(box?.confidence);
        if (confidence != null) {
          confidenceSamples.push(confidence);
        }
      }
      layouts.push(buildOcrGroupedPageLayout({
        manifestDocumentId: manifest?.document_id,
        pageSummary,
        sourceLayout: sourceLayoutsByPageId.get(pageId) || null,
        groupedBoxes,
        imageWidth: previewRecord.imageWidth,
        imageHeight: previewRecord.imageHeight,
      }));
      onProgress({
        pageId,
        pagesDone: index + 1,
        pagesTotal: requestedPageIds.length,
      });
    }
  } finally {
    await worker.terminate();
  }

  const averageConfidence = confidenceSamples.length
    ? confidenceSamples.reduce((sum, value) => sum + value, 0) / confidenceSamples.length
    : null;

  return {
    layouts,
    quality: {
      status: 'accepted',
      reasons: [],
      averageOcrConfidence: averageConfidence == null
        ? null
        : Math.round(averageConfidence * 1000) / 1000,
      pageBoxCounts: perPageBoxCounts,
    },
    languageSpec,
  };
}
