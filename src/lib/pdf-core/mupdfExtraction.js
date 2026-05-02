import {
  _assign_columns as assignColumnsFromPort,
  _bbox_intersection_area as bboxIntersectionAreaFromPort,
  _detect_vector_graphic_regions as detectVectorGraphicRegionsFromPort,
  _extract_image_blocks as extractImageBlocksFromPort,
  _extract_digital_page_layout_impl as extractDigitalPageLayoutImplFromPort,
  _extract_lines_and_styles as extractLinesAndStylesFromPort,
  _infer_alignment as inferAlignmentFromPort,
  _infer_direction as inferDirectionFromPort,
  _ordered_line_indexes as orderedLineIndexesFromPort,
  _extract_page_words as extractPageWordsFromPort,
  _normalize_rtl_label_colon_order as normalizeRtlLabelColonOrderFromPort,
  _prune_spanning_table_cells as pruneSpanningTableCellsFromPort,
  _trim_boundary_table_rows as trimBoundaryTableRowsFromPort,
  build_digital_layouts as buildDigitalLayoutsFromPort,
} from './digitalStagePort.js';
import {
  collectStructuredTextLineElements,
  prepareDetectedTextElementsForAnnotation,
  TEXT_ELEMENT_RENDER_KIND,
  validBBox,
} from './browserTextDetection.js';
import { mergeDetectedTextElementsHorizontally } from './detectedTextHorizontalMergeStage.js';
import { openMuPdfTwinDocument } from './pymupdfTwinAdapter.js';

export const SCHEMA_VERSION = '1.0';
export const STAGE_MANIFEST = 'manifest';
export const STAGE_PAGE_LAYOUT = 'page_layout';
const DETECTED_TEXT_EDITOR_RENDER_KINDS = new Set([
  TEXT_ELEMENT_RENDER_KIND.TIGHT,
  TEXT_ELEMENT_RENDER_KIND.SPLIT_TIGHT,
]);

const RTL_LABEL_WITH_LEADING_COLON_RE = /^\s*:\s*([\u0590-\u08FF][\u0590-\u08FF\s"'()./\-]+?)\s*$/u;
const RTL_LABEL_VALUE_START_RE = /[A-Za-z0-9@(+]/u;
const EXTRACTION_WARNING_REPLACEMENT_RE = /\uFFFD/g;
const EXTRACTION_WARNING_SUSPICIOUS_CHAR_RE = /[\uFFFD€�‚ƒ„…†‡‰‹‘’“”•–—™]/g;
const EXTRACTION_WARNING_LETTER_RE = /[A-Za-z\u0590-\u05FF]/g;
const BACKGROUND_TEXT_IMAGE_MIN_AREA_RATIO = 0.8;
const BACKGROUND_TEXT_IMAGE_MIN_BLOCK_COUNT = 15;
const BACKGROUND_TEXT_IMAGE_MIN_TEXT_LENGTH = 120;
const LOGO_MAX_AREA_RATIO = 0.08;
const LOGO_MIN_AREA_RATIO = 0.0005;
const LOGO_TOP_MAX_RATIO = 0.22;
const LOGO_EDGE_MAX_RATIO = 0.18;
const LOGO_MAX_TEXT_OVERLAP_RATIO = 0.12;
const LOGO_MAX_DIMENSION_RATIO = 0.18;
const LOGO_MIN_GRAPHIC_DRAWING_COUNT = 4;

function toUint8Array(pdfData) {
  if (pdfData instanceof Uint8Array) {
    return pdfData;
  }
  if (pdfData instanceof ArrayBuffer) {
    return new Uint8Array(pdfData);
  }
  throw new Error('pdfData must be a Uint8Array or ArrayBuffer');
}

async function sha256Hex(pdfData) {
  const bytes = toUint8Array(pdfData);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function buildDocumentId(sourceSha256, explicitDocumentId) {
  return explicitDocumentId || `doc_${sourceSha256.slice(0, 12)}`;
}

function classifyPage(hasText, hasImages) {
  if (hasText && hasImages) {
    return 'MIXED';
  }
  if (hasText) {
    return 'DIGITAL';
  }
  return 'SCANNED';
}

function normalizeFontName(name) {
  return String(name || 'unknown').replace(/^[A-Z]{6}\+/, '') || 'unknown';
}

function normalizeRtlLabelPublic(text) {
  const normalizeLine = (line) => {
    const normalized = String(line || '').trim();
    if (!normalized) {
      return normalized;
    }
    const match = RTL_LABEL_WITH_LEADING_COLON_RE.exec(normalized);
    if (match) {
      const label = match[1].trim().replace(/\s+/g, ' ');
      return `${label}:`;
    }
    if (!normalized.startsWith(':')) {
      if (normalized.endsWith(':') && /[\u0590-\u08FF]/u.test(normalized)) {
        const tokens = normalized.slice(0, -1).trim().split(/\s+/).filter(Boolean);
        if (tokens.length >= 3) {
          const key = tokens.slice(0, -1).join(' ').trim();
          const value = tokens.at(-1)?.trim();
          if (key && value && /[\u0590-\u08FF]/u.test(key)) {
            return `${key}: ${value}`;
          }
        }
      }
      return normalized;
    }
    const payload = normalized.slice(1).trim();
    if (!payload || !/[\u0590-\u08FF]/u.test(payload)) {
      return normalized;
    }
    const valueMatch = RTL_LABEL_VALUE_START_RE.exec(payload);
    if (!valueMatch) {
      return normalized;
    }
    const label = payload.slice(0, valueMatch.index).trim().replace(/\s+/g, ' ');
    const value = payload.slice(valueMatch.index).trim();
    if (!label || !value || !/[\u0590-\u08FF]/u.test(label)) {
      return normalized;
    }
    return `${label}: ${value}`;
  };

  const lines = String(text || '').split(/\r?\n/);
  if (lines.length <= 1) {
    return normalizeLine(text);
  }
  return lines.map(normalizeLine).join('\n');
}

function bboxArea(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return 0;
  }
  return Math.max(0, Number(bbox[2]) - Number(bbox[0])) * Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

function combineExtractionWarnings(...warnings) {
  const activeWarnings = warnings.filter((warning) => warning && warning.suspicious);
  if (activeWarnings.length === 0) {
    return null;
  }
  const reasons = [...new Set(activeWarnings.flatMap((warning) => (
    Array.isArray(warning?.reasons) ? warning.reasons.map((reason) => String(reason)) : []
  )))];
  const score = activeWarnings.reduce((best, warning) => (
    Math.max(best, Number.isFinite(Number(warning?.score)) ? Number(warning.score) : 0)
  ), 0);
  return {
    suspicious: true,
    reasons,
    score: score > 0 ? Math.round(score * 1000) / 1000 : undefined,
  };
}

function normalizeNumericBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return null;
  }
  const normalized = bbox.map((value) => Number(value));
  if (!normalized.every((value) => Number.isFinite(value))) {
    return null;
  }
  if (normalized[2] <= normalized[0] || normalized[3] <= normalized[1]) {
    return null;
  }
  return normalized;
}

function bboxIntersectionArea(left, right) {
  const normalizedLeft = normalizeNumericBBox(left);
  const normalizedRight = normalizeNumericBBox(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  const x0 = Math.max(normalizedLeft[0], normalizedRight[0]);
  const y0 = Math.max(normalizedLeft[1], normalizedRight[1]);
  const x1 = Math.min(normalizedLeft[2], normalizedRight[2]);
  const y1 = Math.min(normalizedLeft[3], normalizedRight[3]);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

function dedupeLogoRegions(candidates) {
  const deduped = [];
  for (const candidate of candidates || []) {
    const bbox = normalizeNumericBBox(candidate?.bbox);
    if (!bbox) {
      continue;
    }
    const area = bboxArea(bbox);
    if (area <= 0) {
      continue;
    }
    const duplicate = deduped.some((existing) => {
      const overlap = bboxIntersectionArea(existing.bbox, bbox);
      const existingArea = bboxArea(existing.bbox);
      const smallerArea = Math.max(1, Math.min(existingArea, area));
      return overlap / smallerArea >= 0.85;
    });
    if (!duplicate) {
      deduped.push({
        ...candidate,
        bbox,
      });
    }
  }
  return deduped;
}

function detectLogoRegions({
  pageId,
  pageSize,
  imageBlocks,
  graphicRegions,
  textBboxes,
}) {
  const pageWidth = Number(pageSize?.[0] || 0);
  const pageHeight = Number(pageSize?.[1] || 0);
  const pageArea = Math.max(0, pageWidth) * Math.max(0, pageHeight);
  if (pageWidth <= 0 || pageHeight <= 0 || pageArea <= 0) {
    return [];
  }

  const rawCandidates = [
    ...(Array.isArray(imageBlocks) ? imageBlocks : []).map((image) => ({
      source_kind: 'image',
      source_id: String(image?.image_id || ''),
      bbox: image?.bbox,
      drawing_count: 0,
    })),
    ...(Array.isArray(graphicRegions) ? graphicRegions : []).map((region) => ({
      source_kind: 'graphic_region',
      source_id: String(region?.region_id || ''),
      bbox: region?.bbox,
      drawing_count: Number(region?.drawing_count || 0),
    })),
  ];

  const candidates = rawCandidates.filter((candidate) => {
    const bbox = normalizeNumericBBox(candidate?.bbox);
    if (!bbox) {
      return false;
    }
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];
    const area = bboxArea(bbox);
    const areaRatio = area / pageArea;
    const nearTop = bbox[1] <= pageHeight * LOGO_TOP_MAX_RATIO;
    const nearSide = bbox[0] <= pageWidth * LOGO_EDGE_MAX_RATIO || bbox[2] >= pageWidth * (1 - LOGO_EDGE_MAX_RATIO);
    const widthRatio = width / pageWidth;
    const heightRatio = height / pageHeight;
    if (!nearTop || !nearSide) {
      return false;
    }
    if (areaRatio < LOGO_MIN_AREA_RATIO || areaRatio > LOGO_MAX_AREA_RATIO) {
      return false;
    }
    if (widthRatio > LOGO_MAX_DIMENSION_RATIO || heightRatio > LOGO_MAX_DIMENSION_RATIO) {
      return false;
    }
    if (candidate.source_kind === 'graphic_region' && Number(candidate.drawing_count || 0) < LOGO_MIN_GRAPHIC_DRAWING_COUNT) {
      return false;
    }
    const textOverlap = (Array.isArray(textBboxes) ? textBboxes : []).reduce(
      (sum, textBbox) => sum + bboxIntersectionArea(bbox, textBbox),
      0,
    );
    if ((textOverlap / Math.max(1, area)) > LOGO_MAX_TEXT_OVERLAP_RATIO) {
      return false;
    }
    return true;
  });

  return dedupeLogoRegions(candidates).map((candidate, index) => ({
    logo_id: `logo_${pageId}_${index + 1}`,
    bbox: candidate.bbox,
    source_kind: candidate.source_kind,
    source_id: candidate.source_id || undefined,
  }));
}

export function detectExtractionWarningForText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return null;
  }

  const replacementMatches = normalized.match(EXTRACTION_WARNING_REPLACEMENT_RE) || [];
  const suspiciousCharMatches = normalized.match(EXTRACTION_WARNING_SUSPICIOUS_CHAR_RE) || [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const suspiciousTokenCount = tokens.filter((token) => {
    const suspiciousChars = token.match(EXTRACTION_WARNING_SUSPICIOUS_CHAR_RE) || [];
    const letters = token.match(EXTRACTION_WARNING_LETTER_RE) || [];
    return suspiciousChars.length >= 2 && letters.length === 0;
  }).length;

  const reasons = [];
  if (replacementMatches.length > 0) {
    reasons.push('replacement_chars');
  }
  if (reasons.length === 0 && suspiciousTokenCount >= 3 && suspiciousTokenCount / Math.max(1, tokens.length) >= 0.18) {
    reasons.push('mojibake_tokens');
  }
  if (reasons.length === 0) {
    return null;
  }

  const score = Math.min(
    1,
    (replacementMatches.length * 0.4)
      + ((suspiciousTokenCount / Math.max(1, tokens.length)) * 0.6)
      + Math.min(0.2, suspiciousCharMatches.length * 0.01),
  );
  return {
    suspicious: true,
    reasons,
    score: Math.round(score * 1000) / 1000,
  };
}

export function detectBackgroundTextImageWarning({
  pageSize,
  imageBlocks,
  blockCount = 0,
  textLength = 0,
}) {
  const pageWidth = Number(pageSize?.[0] || 0);
  const pageHeight = Number(pageSize?.[1] || 0);
  const pageArea = Math.max(0, pageWidth) * Math.max(0, pageHeight);
  if (pageArea <= 0) {
    return null;
  }
  const maxImageArea = (Array.isArray(imageBlocks) ? imageBlocks : []).reduce((best, image) => (
    Math.max(best, bboxArea(image?.bbox))
  ), 0);
  const areaRatio = maxImageArea / pageArea;
  if (
    areaRatio < BACKGROUND_TEXT_IMAGE_MIN_AREA_RATIO
    || Number(blockCount) < BACKGROUND_TEXT_IMAGE_MIN_BLOCK_COUNT
    || Number(textLength) < BACKGROUND_TEXT_IMAGE_MIN_TEXT_LENGTH
  ) {
    return null;
  }
  const score = Math.min(
    1,
    (areaRatio * 0.7)
      + (Math.min(1, Number(blockCount) / 80) * 0.2)
      + (Math.min(1, Number(textLength) / 400) * 0.1),
  );
  return {
    suspicious: true,
    reasons: ['background_text_image'],
    score: Math.round(score * 1000) / 1000,
  };
}

function countPageFonts(page) {
  const dict = page.getText('dict') || {};
  const fontNames = new Set();
  for (const block of dict.blocks || []) {
    if (Number(block?.type || 0) !== 0) {
      continue;
    }
    for (const line of block.lines || []) {
      for (const span of line.spans || []) {
        fontNames.add(normalizeFontName(span?.font));
      }
    }
  }
  return fontNames.size;
}

function extractPageSummary(page, pageId) {
  const [lines] = extractLinesAndStylesFromPort(page);
  const pageWords = extractPageWordsFromPort(page);
  const pageText = lines.map((line) => line.text).join(' ');
  const imageResources = typeof page.getImageResources === 'function'
    ? page.getImageResources()
    : (typeof page.get_images === 'function' ? page.get_images(true) : []);

  return {
    page_id: pageId,
    type: classifyPage(lines.length > 0, imageResources.length > 0),
    width_pt: Number(page?.rect?.width || 0),
    height_pt: Number(page?.rect?.height || 0),
    rotation: 0,
    text_span_count: pageWords.length,
    image_count: imageResources.length,
    font_count: countPageFonts(page),
    direction: inferDirectionFromPort(pageText),
  };
}

function normalizeTestCandidate(candidate) {
  return {
    ...candidate,
    style_id: candidate?.style_id ?? candidate?.styleId ?? '',
  };
}

function denormalizeTestCandidate(candidate) {
  return {
    ...candidate,
    styleId: candidate?.style_id ?? candidate?.styleId ?? '',
  };
}

function normalizeTestRow(row) {
  return {
    ...row,
    non_empty_cells: row?.non_empty_cells ?? row?.nonEmptyCells ?? 0,
    cell_count: row?.cell_count ?? row?.cellCount ?? (Array.isArray(row?.cells) ? row.cells.length : 0),
  };
}

function detectTightStructuredTextElements(page, {
  reconstructMixedBidiLines = false,
} = {}) {
  return mergeDetectedTextElementsHorizontally(
    prepareDetectedTextElementsForAnnotation(
      collectStructuredTextLineElements(page, {
        reconstructMixedBidiLines,
      }),
    ).filter((element) => (
      validBBox(element?.bbox)
      && String(element?.text || '').trim().length > 0
      && DETECTED_TEXT_EDITOR_RENDER_KINDS.has(String(element?.renderKind || ''))
    )),
  ).filter((element) => (
    validBBox(element?.bbox)
    && String(element?.text || '').trim().length > 0
    && DETECTED_TEXT_EDITOR_RENDER_KINDS.has(String(element?.renderKind || ''))
  ));
}

function ensureFallbackDetectedTextStyle(styles, { direction }) {
  if (styles.length > 0) {
    return String(styles[0].style_id || 's1');
  }
  const styleId = 's1';
  styles.push({
    style_id: styleId,
    font_family: 'unknown',
    font_size: 10,
    weight: 'normal',
    italic: false,
    color: '#000000',
    alignment: direction === 'RTL' ? 'right' : 'left',
    line_spacing: 1.2,
    render_mode: 0,
    stroke_width: 0,
  });
  return styleId;
}

function resolveDetectedTextStyleId(element, {
  styledSpans,
  extractedLines,
  fallbackStyleId,
}) {
  const areaByStyleId = new Map();

  function addOverlap(candidate) {
    const styleId = String(candidate?.style_id || '');
    if (!styleId) {
      return;
    }
    const area = bboxIntersectionAreaFromPort(element.bbox, candidate.bbox);
    if (area <= 0) {
      return;
    }
    areaByStyleId.set(styleId, (areaByStyleId.get(styleId) || 0) + area);
  }

  for (const span of styledSpans || []) {
    addOverlap(span);
  }
  for (const line of extractedLines || []) {
    addOverlap(line);
  }
  if (areaByStyleId.size === 0) {
    return fallbackStyleId;
  }

  let bestStyleId = fallbackStyleId;
  let bestArea = -1;
  for (const [styleId, area] of areaByStyleId.entries()) {
    if (area > bestArea) {
      bestStyleId = styleId;
      bestArea = area;
    }
  }
  return bestStyleId;
}

function buildDetectedTextPageLayout(page, documentId, pageId, {
  detectLogos = false,
  reconstructMixedBidiLines = false,
} = {}) {
  const tightElements = detectTightStructuredTextElements(page, {
    reconstructMixedBidiLines,
  });
  const [extractedLines, extractedStyles, styledSpans] = extractLinesAndStylesFromPort(page);
  const styles = extractedStyles.map((style) => ({ ...style }));
  const pageSize = [Number(page?.rect?.width || 0), Number(page?.rect?.height || 0)];
  const fullText = tightElements.map((element) => element.text).join('\n');
  const textExtractionWarning = detectExtractionWarningForText(fullText);
  let pageDirection = inferDirectionFromPort(fullText);
  if (pageDirection === 'UNKNOWN') {
    pageDirection = 'LTR';
  }
  const fallbackStyleId = ensureFallbackDetectedTextStyle(styles, { direction: pageDirection });

  const orderedElements = tightElements.map((element) => ({
    bbox: element.bbox.map((value) => Number(value)),
    text: String(element.text || ''),
    direction: inferDirectionFromPort(element.text),
    style_id: resolveDetectedTextStyleId(element, {
      styledSpans,
      extractedLines,
      fallbackStyleId,
    }),
    column: 0,
    render_kind: String(element.renderKind || TEXT_ELEMENT_RENDER_KIND.TIGHT),
    text_tightness: String(element.renderKind || TEXT_ELEMENT_RENDER_KIND.TIGHT),
    source_text_orientation: String(element.sourceTextOrientation || 'horizontal'),
    source_line_bbox: Array.isArray(element.sourceLineBBox)
      ? element.sourceLineBBox.map((value) => Number(value))
      : null,
    source_bottom_inset_ratio: Number.isFinite(Number(element.sourceBottomInsetRatio))
      ? Number(element.sourceBottomInsetRatio)
      : 0,
    mixed_bidi_reconstructed: Boolean(element.mixedBidiReconstructed),
  }));
  const columnOrder = assignColumnsFromPort(orderedElements, pageSize[0], pageDirection);
  const orderedIndexes = orderedLineIndexesFromPort(orderedElements, columnOrder, pageDirection);
  const imageBlocks = extractImageBlocksFromPort(page, { page_id: pageId });
  const backgroundImageWarning = detectBackgroundTextImageWarning({
    pageSize,
    imageBlocks,
    blockCount: orderedElements.length,
    textLength: fullText.length,
  });
  const extractionWarning = combineExtractionWarnings(textExtractionWarning, backgroundImageWarning);
  const graphicRegions = detectVectorGraphicRegionsFromPort(page, pageId, {
    text_bboxes: orderedElements.map((element) => element.bbox),
  });
  const logoRegions = detectLogos ? detectLogoRegions({
    pageId,
    pageSize,
    imageBlocks,
    graphicRegions,
    textBboxes: orderedElements.map((element) => element.bbox),
  }) : [];

  const blocks = orderedIndexes.map((elementIndex, index) => {
    const element = orderedElements[elementIndex];
    return {
      block_id: `p${pageId}_b${index + 1}`,
      page_id: Number(pageId),
      type: 'text_line',
      bbox: element.bbox,
      text: element.text,
      style_id: element.style_id,
      reading_order: index + 1,
      source: 'detected_text',
      confidence: element.render_kind === TEXT_ELEMENT_RENDER_KIND.TIGHT ? 1.0 : 0.98,
      flattened_line_breaks: false,
      original_text: null,
      text_tightness: element.text_tightness,
      source_text_orientation: element.source_text_orientation,
      source_line_bbox: element.source_line_bbox,
      source_bottom_inset_ratio: element.source_bottom_inset_ratio,
      mixed_bidi_reconstructed: Boolean(element.mixed_bidi_reconstructed),
    };
  });

  return {
    schema_version: SCHEMA_VERSION,
    stage: STAGE_PAGE_LAYOUT,
    document_id: documentId,
    page_id: Number(pageId),
    page_size_pt: pageSize,
    extraction_warning: extractionWarning,
    blocks,
    styles,
    images: imageBlocks,
    graphic_regions: graphicRegions,
    logo_regions: logoRegions,
  };
}

function denormalizeTestRow(row) {
  return {
    ...row,
    nonEmptyCells: row?.non_empty_cells ?? row?.nonEmptyCells ?? 0,
    cellCount: row?.cell_count ?? row?.cellCount ?? (Array.isArray(row?.cells) ? row.cells.length : 0),
  };
}

export async function buildManifestFromPdfData(pdfData, options = {}) {
  const bytes = toUint8Array(pdfData);
  const sourceSha256 = await sha256Hex(bytes);
  const sourcePdf = options.sourcePdf || 'in-memory.pdf';
  const documentId = buildDocumentId(sourceSha256, options.documentId);
  const document = openMuPdfTwinDocument(bytes);

  try {
    const pages = [];
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const page = document.loadPage(pageIndex);
      try {
        pages.push(extractPageSummary(page, pageIndex + 1));
      } finally {
        page.destroy();
      }
    }

    return {
      schema_version: SCHEMA_VERSION,
      stage: STAGE_MANIFEST,
      document_id: documentId,
      source_pdf: sourcePdf,
      source_sha256: sourceSha256,
      page_count: pages.length,
      pages,
    };
  } finally {
    document.destroy();
  }
}

export async function buildDigitalLayoutsFromPdfData(pdfData, options = {}) {
  const bytes = toUint8Array(pdfData);
  const manifest = options.manifest || await buildManifestFromPdfData(bytes, options);
  return buildDigitalLayoutsFromPort(
    manifest,
    options.requestedPages || null,
    options.includeMixed !== false,
    null,
    {
      openDocument(sourcePdf) {
        if (sourcePdf !== manifest.source_pdf) {
          throw new Error('buildDigitalLayoutsFromPdfData received an unexpected source_pdf when delegating to digitalStagePort');
        }
        return openMuPdfTwinDocument(bytes);
      },
    },
  );
}

export async function buildDetectedTextLayoutsFromPdfData(pdfData, options = {}) {
  const bytes = toUint8Array(pdfData);
  const manifest = options.manifest || await buildManifestFromPdfData(bytes, options);
  const requestedPages = options.requestedPages ? new Set(options.requestedPages) : null;
  const includeMixed = options.includeMixed !== false;
  const allowedTypes = new Set(includeMixed ? ['DIGITAL', 'MIXED'] : ['DIGITAL']);

  const document = openMuPdfTwinDocument(bytes);
  try {
    const pages = [];
    for (const pageSummary of manifest.pages) {
      if (!allowedTypes.has(pageSummary.type)) {
        continue;
      }
      if (requestedPages && !requestedPages.has(pageSummary.page_id)) {
        continue;
      }
      const page = document.loadPage(pageSummary.page_id - 1);
      try {
        pages.push(buildDetectedTextPageLayout(
          page,
          manifest.document_id,
          pageSummary.page_id,
          {
            detectLogos: options.detectLogos === true,
            reconstructMixedBidiLines: options.reconstructMixedBidiLines === true,
          },
        ));
      } finally {
        page.destroy();
      }
    }
    return pages;
  } finally {
    document.destroy();
  }
}

export async function buildDigitalLayoutsWithDebugFromPdfData(pdfData, options = {}) {
  const bytes = toUint8Array(pdfData);
  const manifest = options.manifest || await buildManifestFromPdfData(bytes, options);
  const requestedPages = options.requestedPages ? new Set(options.requestedPages) : null;
  const includeMixed = options.includeMixed !== false;
  const allowedTypes = new Set(includeMixed ? ['DIGITAL', 'MIXED'] : ['DIGITAL']);

  const document = openMuPdfTwinDocument(bytes);
  try {
    const pages = [];
    for (const pageSummary of manifest.pages) {
      if (!allowedTypes.has(pageSummary.type)) {
        continue;
      }
      if (requestedPages && !requestedPages.has(pageSummary.page_id)) {
        continue;
      }
      const page = document.loadPage(pageSummary.page_id - 1);
      try {
        const [layout, debug] = extractDigitalPageLayoutImplFromPort(
          page,
          manifest.document_id,
          pageSummary.page_id,
        );
        pages.push({ layout, debug });
      } finally {
        page.destroy();
      }
    }
    return pages;
  } finally {
    document.destroy();
  }
}

export function inferTextDirection(text) {
  return inferDirectionFromPort(text);
}

export function inferTextAlignment(bbox, pageWidth, direction) {
  return inferAlignmentFromPort(bbox, pageWidth, direction);
}

export function normalizeRtlLabel(text) {
  return normalizeRtlLabelPublic(text);
}

export const __testOnly = {
  pruneSpanningTableCells(candidates) {
    return pruneSpanningTableCellsFromPort((candidates || []).map(normalizeTestCandidate)).map(denormalizeTestCandidate);
  },
  trimBoundaryTableRows(rows) {
    return trimBoundaryTableRowsFromPort((rows || []).map(normalizeTestRow)).map(denormalizeTestRow);
  },
};
