import * as pdfjsLib from 'pdfjs-dist';
import mupdf from 'mupdf';
import { BrowserPipelineClient } from '../pdf-core/browserPipelineClient.js';
import { renderPagePixmapWithoutText } from '../pdf-core/browserTextlessPageRenderer.js';
import { buildDetectedTextMirroredArtifacts } from '../pdf-core/detectedTextMirrorStage.js';
import { detectRasterLogoCandidatesFromImageUrl } from '../rasterLogoCandidates.ts';
import { detectHorizontalBarriersFromImageUrl, detectVerticalBarriersFromImageUrl } from '../pageBarrierDetection.ts';
import { mergeContinuationPairsInLayout } from '../continuationLayoutMerge.js';
import {
  buildDefaultGraphicRegionEditsByPage,
  buildProtectedGraphicRegions,
} from '../visualRegionProtection.js';
import {
  buildStoredBrowserTranslationRun,
  resolveMockTranslationRun,
} from '../browserTranslationMocks.js';
import {
  buildDetectedTextSkippedPagesNotice,
  buildDetectedTextUnsupportedMessage,
  partitionDetectedTextRequestedPages,
} from '../detectedTextSupport.js';
import {
  buildDocumentCandidateConfigsForOverride,
} from './candidateRunCatalog.js';
import {
  buildPlannedCandidateConfigs,
  evaluateDocumentQuality,
} from './documentQualityPlanner.js';
import {
  buildOcrGroupedCandidateLayouts,
  shouldUseTextlessOcrInputForPage,
} from './ocrGroupedCandidateBuilder.js';

export const DOCUMENT_RUN_PHASES = [
  'receive_upload',
  'build_manifest',
  'extract_layouts',
  'download_language_pack',
  'translate_pages',
  'fit_pages',
  'render_outputs',
  'create_working_session',
];

export const OCR_INPUT_RENDER_SCALE = 240 / 72;

export function shouldDetectPageBarriers({
  debugInspectionsEnabled = false,
  useBarrierDetectionEnabled = false,
  mergeContinuationBlocksEnabled = false,
} = {}) {
  return debugInspectionsEnabled || useBarrierDetectionEnabled || mergeContinuationBlocksEnabled;
}

export function shouldRenderTextlessPagePreviews({
  debugInspectionsEnabled = false,
  protectVisualRegionsEnabled = true,
  useBarrierDetectionEnabled = false,
  mergeContinuationBlocksEnabled = false,
} = {}) {
  return protectVisualRegionsEnabled || shouldDetectPageBarriers({
    debugInspectionsEnabled,
    useBarrierDetectionEnabled,
    mergeContinuationBlocksEnabled,
  });
}

async function renderOriginalPagePreviewRecords(fileBytes, pageIds, scale) {
  const pdf = await pdfjsLib.getDocument({ data: fileBytes.slice().buffer }).promise;
  try {
    const recordsByPageId = new Map();
    for (const pageId of pageIds) {
      const page = await pdf.getPage(pageId);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Unable to get canvas context for original page preview.');
      }
      await page.render({ canvasContext: ctx, viewport }).promise;
      recordsByPageId.set(pageId, {
        url: canvas.toDataURL('image/png'),
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        pageWidthPt: viewport.width / scale,
        pageHeightPt: viewport.height / scale,
      });
    }
    return recordsByPageId;
  } finally {
    await pdf.destroy();
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('Expected PDF bytes as Uint8Array or ArrayBuffer.');
}

function openDocument(pdfData) {
  return mupdf.Document.openDocument(toUint8Array(pdfData), 'application/pdf');
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load rendered page preview: ${url}`));
    image.src = url;
  });
}

async function pngBytesToDataUrlRecord(pngBytes, { pageWidthPt, pageHeightPt }) {
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, image.width);
    canvas.height = Math.max(1, image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get canvas context for textless page preview.');
    }
    ctx.drawImage(image, 0, 0);
    return {
      url: canvas.toDataURL('image/png'),
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      pageWidthPt,
      pageHeightPt,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderTextlessPagePreviewRecords(fileBytes, pageIds, scale) {
  const document = openDocument(fileBytes);
  try {
    const recordsByPageId = new Map();
    for (const pageId of pageIds) {
      const pageIndex = Number(pageId) - 1;
      const page = document.loadPage(pageIndex);
      try {
        const pageBounds = page.getBounds();
        const pageWidthPt = Number(pageBounds[2] - pageBounds[0]);
        const pageHeightPt = Number(pageBounds[3] - pageBounds[1]);
        const pixmap = renderPagePixmapWithoutText(document, pageIndex, { scale });
        try {
          recordsByPageId.set(Number(pageId), await pngBytesToDataUrlRecord(pixmap.asPNG(), {
            pageWidthPt,
            pageHeightPt,
          }));
        } finally {
          pixmap.destroy?.();
        }
      } finally {
        page.destroy?.();
      }
    }
    return recordsByPageId;
  } finally {
    document.destroy?.();
  }
}

function subsetPagePreviewUrls(pagePreviewRecordsById, pageIds) {
  return new Map(
    (pageIds || [])
      .map((pageId) => {
        const record = pagePreviewRecordsById.get(Number(pageId));
        return record ? [Number(pageId), String(record.url || '')] : null;
      })
      .filter(Boolean),
  );
}

async function detectRasterLogoCandidatesByPage({
  pageIds,
  pagePreviewRecordsById,
  sourceLayoutsByPageId,
}) {
  const candidatesByPageId = new Map();
  for (const rawPageId of pageIds || []) {
    const pageId = Number(rawPageId);
    const previewRecord = pagePreviewRecordsById.get(pageId);
    if (!previewRecord?.url) {
      continue;
    }
    const sourceLayout = sourceLayoutsByPageId.get(pageId) || null;
    const imageBboxes = Array.isArray(sourceLayout?.images)
      ? sourceLayout.images
        .map((image) => Array.isArray(image?.bbox) ? image.bbox.map((value) => Number(value)) : null)
        .filter(Boolean)
      : [];
    const candidates = await detectRasterLogoCandidatesFromImageUrl({
      imageUrl: String(previewRecord.url),
      pageWidthPt: Number(previewRecord.pageWidthPt || sourceLayout?.page_size_pt?.[0] || 1),
      pageHeightPt: Number(previewRecord.pageHeightPt || sourceLayout?.page_size_pt?.[1] || 1),
      excludeBboxesPt: imageBboxes,
    });
    candidatesByPageId.set(pageId, candidates);
  }
  return candidatesByPageId;
}

async function detectPageBarriersByPage({
  pageIds,
  pagePreviewRecordsById,
  sourceLayoutsByPageId,
}) {
  const barriersByPageId = new Map();
  for (const rawPageId of pageIds || []) {
    const pageId = Number(rawPageId);
    const previewRecord = pagePreviewRecordsById.get(pageId);
    if (!previewRecord?.url) {
      continue;
    }
    const sourceLayout = sourceLayoutsByPageId.get(pageId) || null;
    const imageBboxes = Array.isArray(sourceLayout?.images)
      ? sourceLayout.images
        .map((image) => Array.isArray(image?.bbox) ? image.bbox.map((value) => Number(value)) : null)
        .filter(Boolean)
      : [];
    try {
      const detectionArgs = {
        imageUrl: String(previewRecord.url),
        pageWidthPt: Number(previewRecord.pageWidthPt || sourceLayout?.page_size_pt?.[0] || 1),
        pageHeightPt: Number(previewRecord.pageHeightPt || sourceLayout?.page_size_pt?.[1] || 1),
        excludeBboxesPt: imageBboxes,
      };
      const [horizontalBarriers, verticalBarriers] = await Promise.all([
        detectHorizontalBarriersFromImageUrl(detectionArgs),
        detectVerticalBarriersFromImageUrl(detectionArgs),
      ]);
      barriersByPageId.set(pageId, { horizontalBarriers, verticalBarriers });
    } catch (error) {
      console.warn('[page-barrier-detection] failed', { pageId, error });
    }
  }
  return barriersByPageId;
}

function mergePagePreviewRecordMaps(primaryByPageId, overrideByPageId) {
  const merged = new Map(primaryByPageId);
  for (const [pageId, record] of overrideByPageId.entries()) {
    merged.set(Number(pageId), record);
  }
  return merged;
}

function storeLastBrowserTranslationRun({
  sourcePdfName,
  sourceCode,
  targetCode,
  translationEngine,
  translations,
}) {
  if (typeof window === 'undefined') {
    return;
  }
  const globalWindow = window;
  globalWindow.__LINGADOO_LAST_BROWSER_TRANSLATION_RUN__ = buildStoredBrowserTranslationRun({
    sourcePdfName,
    sourceCode,
    targetCode,
    translationEngine,
    translations,
  });
}

async function translateLayoutsForCandidate({
  client,
  candidateConfig,
  fileName,
  layouts,
  sourceLanguageCode,
  targetLanguageCode,
  browserTranslatorTimeoutMs,
  mockTranslationRun,
  manifestDocumentId,
  onPhase,
}) {
  const translatedPages = [];
  let translationEngine = 'browser-local';
  const allowMockTranslation = String(candidateConfig?.extractionProfile || '') === 'detected-text';
  const resolvedMockRun = allowMockTranslation
    ? resolveMockTranslationRun({
      mockRun: mockTranslationRun,
      fileName,
      sourceCode: sourceLanguageCode,
      targetCode: targetLanguageCode,
      layouts,
      fallbackDocumentId: String(manifestDocumentId || ''),
    })
    : null;
  if (resolvedMockRun) {
    translationEngine = resolvedMockRun.translationEngine;
    translatedPages.push(...resolvedMockRun.translations);
    onPhase('translate_pages', { pagesDone: layouts.length, pagesTotal: layouts.length });
    return {
      translationEngine,
      translatedPages,
    };
  }

  const prepared = await client.prepareTranslator({
    sourceCode: sourceLanguageCode,
    targetCode: targetLanguageCode,
    browserTranslatorTimeoutMs,
  });

  try {
    if (prepared.downloadNeeded) {
      onPhase('download_language_pack');
      await prepared.provider.ensureReady();
    }
    onPhase('translate_pages', { pagesDone: 0, pagesTotal: layouts.length });
    for (let index = 0; index < layouts.length; index += 1) {
      const translationResult = await client.translateLayouts({
        layouts: [layouts[index]],
        sourceCode: sourceLanguageCode,
        targetCode: targetLanguageCode,
        browserTranslatorTimeoutMs,
        provider: prepared.provider,
      });
      translationEngine = translationResult.translationEngine;
      translatedPages.push(...(translationResult.translations || []));
      onPhase('translate_pages', { pagesDone: index + 1, pagesTotal: layouts.length });
    }
  } finally {
    if (prepared.provider && typeof prepared.provider.destroy === 'function') {
      await prepared.provider.destroy();
    }
  }

  return {
    translationEngine,
    translatedPages,
  };
}

function buildCandidateLocalSessionArgs({
  candidateConfig,
  manifest,
  pageArtifacts,
  renderedPages,
  originalPagePreviewUrlsById,
  textlessPagePreviewUrlsById,
  textlessPageBarriersById,
  translationEngine,
  sourceLanguageCode,
  targetLanguageCode,
  openingNotice,
  autoNudgeEnabled,
  useBarrierDetectionEnabled,
  strictAutoNudgeBBoxCollisionEnabled,
}) {
  const pageArtifactsById = new Map(
    pageArtifacts.map((artifacts) => [Number(artifacts.pageId), {
      sourceLayout: artifacts.sourceLayout,
      layout: artifacts.layout,
      fitted: artifacts.fitted,
    }]),
  );
  return {
    manifest,
    pageArtifactsById,
    renderedPages,
    originalPagePreviewUrlsById,
    textlessPagePreviewUrlsById,
    textlessPageBarriersById,
    translationEngine,
    sourceLanguageCode,
    targetLanguageCode,
    mirrorEnabled: candidateConfig.mirrorMode !== 'forced-off',
    restoreImageOrientationsEnabled: candidateConfig.restoreImageOrientations !== false,
    autoNudgeEnabled: Boolean(autoNudgeEnabled),
    useBarrierDetectionEnabled: Boolean(useBarrierDetectionEnabled),
    strictAutoNudgeBBoxCollisionEnabled: strictAutoNudgeBBoxCollisionEnabled !== false,
    repairVerticalOverflowEnabled: Boolean(candidateConfig.repairVerticalOverflow),
    preserveVerticalSourceAnchorEnabled: Boolean(candidateConfig.preserveVerticalSourceAnchor),
    useTightTextBBoxEnabled: Boolean(candidateConfig.useTightTextBbox),
    openingNotice,
    previewMode: 'detected-text-editor',
  };
}

function applyProtectedVisualRegionsToPageArtifacts({
  pageArtifacts,
  sourceLayoutsByPageId,
  rasterLogoCandidatesByPageId,
}) {
  const nextPageArtifacts = pageArtifacts.map((artifacts) => {
    const pageId = Number(artifacts.pageId);
    const sourceLayout = sourceLayoutsByPageId.get(pageId) || artifacts.sourceLayout || artifacts.layout || null;
    const protectedGraphicRegions = buildProtectedGraphicRegions({
      pageId,
      sourceGraphicRegions: sourceLayout?.graphic_regions || [],
      fallbackGraphicRegions: artifacts.layout?.graphic_regions || [],
      rasterLogoCandidates: rasterLogoCandidatesByPageId.get(pageId) || [],
    });
    return {
      ...artifacts,
      layout: {
        ...artifacts.layout,
        graphic_regions: protectedGraphicRegions,
      },
    };
  });
  return {
    pageArtifacts: nextPageArtifacts,
    graphicRegionEditsByPage: buildDefaultGraphicRegionEditsByPage(nextPageArtifacts),
  };
}

function buildCandidatePageArtifacts({
  layouts,
  translationsByPageId,
  candidateConfig,
  onPhase,
}) {
  onPhase('fit_pages', { pagesDone: 0, pagesTotal: layouts.length });
  return layouts.map((layout, index) => {
    const artifacts = buildDetectedTextMirroredArtifacts(layout, {
      useBucketFontRatioEnabled: String(candidateConfig.fitProfile) === 'bucket-ratio',
      translations: translationsByPageId.get(Number(layout.page_id)) || null,
      mirrorEnabled: String(candidateConfig.mirrorMode) !== 'forced-off',
    });
    onPhase('fit_pages', { pagesDone: index + 1, pagesTotal: layouts.length });
    return {
      pageId: Number(layout.page_id),
      sourceLayout: artifacts.sourceLayout,
      layout: artifacts.editorLayout,
      fitted: artifacts.fitted,
    };
  });
}

async function buildCandidateLayouts({
  candidateConfig,
  requestedPages,
  manifest,
  sourceLayoutsByPageId,
  detectedTextSupportedPageIds,
  pagePreviewRecordsById,
  sourceLanguageCode,
  targetLanguageCode,
  onPhase,
}) {
  if (String(candidateConfig.extractionProfile) === 'ocr-grouped') {
    const result = await buildOcrGroupedCandidateLayouts({
      manifest,
      requestedPageIds: [...requestedPages],
      sourceLayoutsByPageId,
      pagePreviewRecordsById,
      sourceLanguageCode,
      targetLanguageCode,
      onProgress: (details) => {
        if (Number.isFinite(Number(details?.pagesDone)) && Number.isFinite(Number(details?.pagesTotal))) {
          onPhase('extract_layouts', {
            pagesDone: Number(details.pagesDone),
            pagesTotal: Number(details.pagesTotal),
            subProgress: Number.isFinite(Number(details?.progress)) ? Number(details.progress) : undefined,
          });
        } else if (Number.isFinite(Number(details?.progress))) {
          onPhase('extract_layouts', {
            subProgress: Number(details.progress),
          });
        }
      },
    });
    return {
      pageIds: [...requestedPages],
      layouts: result.layouts,
      quality: result.quality,
      openingNotice: '',
    };
  }

  const pageIds = [...detectedTextSupportedPageIds];
  if (pageIds.length === 0) {
    return {
      pageIds,
      layouts: [],
      quality: {
        status: 'rejected',
        reasons: ['no_supported_detected_text_pages'],
      },
      openingNotice: '',
    };
  }

  const layouts = pageIds
    .map((pageId) => sourceLayoutsByPageId.get(Number(pageId)) || null)
    .filter(Boolean);

  return {
    pageIds,
    layouts,
    quality: {
      status: 'accepted',
      reasons: [],
    },
    openingNotice: buildDetectedTextSkippedPagesNotice(
      [...requestedPages].filter((pageId) => !detectedTextSupportedPageIds.includes(Number(pageId))),
    ),
  };
}

export function resolveDocumentRunDecision(candidates, {
  recommendedCandidateId = null,
} = {}) {
  const candidateIds = (candidates || []).map((candidate) => String(candidate?.id || '')).filter(Boolean);
  if (candidateIds.length === 0) {
    throw new Error('Document run produced no candidates.');
  }
  if (candidateIds.length === 1) {
    return {
      mode: 'direct-open',
      candidateId: candidateIds[0],
      recommendedCandidateId,
    };
  }
  return {
    mode: 'choose-candidate',
    candidateIds,
    recommendedCandidateId,
  };
}

export async function runDocumentCandidates({
  file,
  requestedPages,
  sourceLanguageCode = 'he',
  targetLanguageCode = 'en',
  mirrorEnabled = true,
  alternativesEnabled = false,
  candidateIdOverride = null,
  autoNudgeEnabled = true,
  repairVerticalOverflowEnabled = false,
  preserveVerticalSourceAnchorEnabled = false,
  useTightTextBBoxEnabled = false,
  strictAutoNudgeBBoxCollisionEnabled = true,
  detectLogosEnabled = false,
  protectVisualRegionsEnabled = true,
  reconstructMixedBidiLinesEnabled = false,
  debugInspectionsEnabled = false,
  useBarrierDetectionEnabled = false,
  mergeContinuationBlocksEnabled = false,
  useBucketFontRatioEnabled = true,
  browserTranslatorTimeoutMs = null,
  mockTranslationRun = null,
  candidateConfigs = null,
  onPhase = () => {},
  onQualityDecision = () => {},
}) {
  const sourcePdfBytes = new Uint8Array(await file.arrayBuffer());
  const sourcePdfName = String(file.name || 'browser-upload.pdf');

  onPhase('receive_upload');
  const client = new BrowserPipelineClient();
  try {
    onPhase('build_manifest');
    const documentId = `browser-detected-text-${crypto.randomUUID?.() || Date.now()}`;
    onPhase('extract_layouts');
    const extraction = await client.extractDocument({
      documentBytes: sourcePdfBytes.slice().buffer,
      sourcePdfName,
      documentId,
      requestedPages,
      includeMixed: true,
      extractionMode: 'detected-text',
      detectLogos: detectLogosEnabled,
      reconstructMixedBidiLines: reconstructMixedBidiLinesEnabled,
    });
    const detectedTextLayouts = Array.isArray(extraction.layouts) ? extraction.layouts : [];
    const {
      supportedPageIds: detectedTextSupportedPageIds,
      skippedPageIds: detectedTextSkippedPageIds,
    } = partitionDetectedTextRequestedPages(requestedPages, detectedTextLayouts);

    const sourceLayoutsByPageId = new Map(
      detectedTextLayouts.map((layout) => [Number(layout.page_id), layout]),
    );
    const qualityDecision = evaluateDocumentQuality({
      requestedPages,
      detectedTextLayouts,
      detectedTextSupportedPageIds,
      detectedTextSkippedPageIds,
      mirrorEnabled,
      alternativesEnabled,
    });
    onQualityDecision(qualityDecision);
    const selectedCandidateConfigs = Array.isArray(candidateConfigs) && candidateConfigs.length > 0
      ? candidateConfigs
      : candidateIdOverride
        ? buildDocumentCandidateConfigsForOverride(candidateIdOverride, {
          mirrorEnabled,
          repairVerticalOverflowEnabled,
          preserveVerticalSourceAnchorEnabled,
          useTightTextBBoxEnabled,
          useBucketFontRatioEnabled,
        })
        : buildPlannedCandidateConfigs({
          qualityDecision,
          mirrorEnabled,
          repairVerticalOverflowEnabled,
          preserveVerticalSourceAnchorEnabled,
          useTightTextBBoxEnabled,
          useBucketFontRatioEnabled,
        });
    const hasOcrCandidate = selectedCandidateConfigs.some((candidate) => String(candidate?.extractionProfile || '') === 'ocr-grouped');
    if (detectedTextSupportedPageIds.length === 0 && !hasOcrCandidate) {
      throw new Error(buildDetectedTextUnsupportedMessage(requestedPages));
    }
    const previewPageIds = hasOcrCandidate ? [...requestedPages] : [...detectedTextSupportedPageIds];
    const originalPagePreviewRecordsById = await renderOriginalPagePreviewRecords(
      sourcePdfBytes,
      previewPageIds,
      OCR_INPUT_RENDER_SCALE,
    );
    const ocrTextlessPageIds = hasOcrCandidate
      ? (extraction.manifest?.pages || [])
        .filter((page) => {
          const pageId = Number(page?.page_id);
          return (
            previewPageIds.includes(pageId)
            && shouldUseTextlessOcrInputForPage({
              pageSummary: page,
              sourceLayout: sourceLayoutsByPageId.get(pageId) || null,
            })
          );
        })
        .map((page) => Number(page.page_id))
      : [];
    const textlessOcrPagePreviewRecordsById = ocrTextlessPageIds.length > 0
      ? await renderTextlessPagePreviewRecords(sourcePdfBytes, ocrTextlessPageIds, OCR_INPUT_RENDER_SCALE)
      : new Map();
    const ocrInputPagePreviewRecordsById = mergePagePreviewRecordMaps(
      originalPagePreviewRecordsById,
      textlessOcrPagePreviewRecordsById,
    );
    const textlessPreviewPageIds = shouldRenderTextlessPagePreviews({
      debugInspectionsEnabled,
      protectVisualRegionsEnabled,
      useBarrierDetectionEnabled,
      mergeContinuationBlocksEnabled,
    })
      ? previewPageIds.filter((pageId) => !textlessOcrPagePreviewRecordsById.has(Number(pageId)))
      : [];
    const debugTextlessPagePreviewRecordsById = textlessPreviewPageIds.length > 0
      ? await renderTextlessPagePreviewRecords(sourcePdfBytes, textlessPreviewPageIds, OCR_INPUT_RENDER_SCALE)
      : new Map();
    const textlessPagePreviewRecordsById = mergePagePreviewRecordMaps(
      textlessOcrPagePreviewRecordsById,
      debugTextlessPagePreviewRecordsById,
    );
    const textlessPageBarriersById = shouldDetectPageBarriers({
      debugInspectionsEnabled,
      useBarrierDetectionEnabled,
      mergeContinuationBlocksEnabled,
    })
      ? await detectPageBarriersByPage({
        pageIds: previewPageIds,
        pagePreviewRecordsById: textlessPagePreviewRecordsById,
        sourceLayoutsByPageId,
      })
      : new Map();
    const rasterLogoCandidatesByPageId = protectVisualRegionsEnabled
      ? await detectRasterLogoCandidatesByPage({
        pageIds: previewPageIds,
        pagePreviewRecordsById: textlessPagePreviewRecordsById,
        sourceLayoutsByPageId,
      })
      : new Map();

    const candidates = [];
    const candidateCount = selectedCandidateConfigs.length;
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const candidateConfig = selectedCandidateConfigs[candidateIndex];
      const candidateOnPhase = (phase, details) => {
        onPhase(phase, { ...details, candidateIndex, candidateCount });
      };
      const candidateLayoutResult = await buildCandidateLayouts({
        candidateConfig,
        requestedPages,
        manifest: extraction.manifest,
        sourceLayoutsByPageId,
        detectedTextSupportedPageIds,
        pagePreviewRecordsById: String(candidateConfig.extractionProfile) === 'ocr-grouped'
          ? ocrInputPagePreviewRecordsById
          : originalPagePreviewRecordsById,
        sourceLanguageCode,
        targetLanguageCode,
        onPhase: candidateOnPhase,
      });
      if (candidateLayoutResult.layouts.length === 0) {
        continue;
      }
      const candidateLayouts = (
        mergeContinuationBlocksEnabled === true
        && String(candidateConfig.extractionProfile || '') === 'detected-text'
      )
        ? candidateLayoutResult.layouts.map((layout) => {
          const pageBarrierData = textlessPageBarriersById.get(Number(layout.page_id)) || {
            horizontalBarriers: [],
            verticalBarriers: [],
          };
          return mergeContinuationPairsInLayout(layout, {
            horizontalBarriers: Array.isArray(pageBarrierData.horizontalBarriers)
              ? pageBarrierData.horizontalBarriers
              : [],
            verticalBarriers: Array.isArray(pageBarrierData.verticalBarriers)
              ? pageBarrierData.verticalBarriers
              : [],
          });
        })
        : candidateLayoutResult.layouts;

      const {
        translationEngine,
        translatedPages,
      } = await translateLayoutsForCandidate({
        client,
        candidateConfig,
        fileName: sourcePdfName,
        layouts: candidateLayouts,
        sourceLanguageCode,
        targetLanguageCode,
        browserTranslatorTimeoutMs,
        mockTranslationRun,
        manifestDocumentId: extraction.manifest.document_id,
        onPhase: candidateOnPhase,
      });

      const translationsByPageId = new Map(
        translatedPages.map((translation) => [Number(translation.page_id), translation]),
      );
      let pageArtifacts = buildCandidatePageArtifacts({
        layouts: candidateLayouts,
        translationsByPageId,
        candidateConfig,
        onPhase: candidateOnPhase,
      });
      let graphicRegionEditsByPage = null;
      if (protectVisualRegionsEnabled && String(candidateConfig.mirrorMode) !== 'forced-off') {
        const protectedVisuals = applyProtectedVisualRegionsToPageArtifacts({
          pageArtifacts,
          sourceLayoutsByPageId,
          rasterLogoCandidatesByPageId,
        });
        pageArtifacts = protectedVisuals.pageArtifacts;
        graphicRegionEditsByPage = protectedVisuals.graphicRegionEditsByPage;
      }

      candidateOnPhase('render_outputs');
      const previewResult = await client.renderCanvasPreview({
        documentBytes: sourcePdfBytes.slice().buffer,
        manifest: extraction.manifest,
        pageArtifacts,
        requestedPages: candidateLayoutResult.pageIds,
        renderDpi: 144,
        clearTableRegionsFromFitted: false,
        redrawTableBordersFromFitted: false,
        mirrorTableBboxes: false,
        mirrorEnabled: String(candidateConfig.mirrorMode) !== 'forced-off',
        restoreImageOrientations: candidateConfig.restoreImageOrientations !== false,
        graphicRegionEditsByPage,
      });

      candidates.push({
        id: String(candidateConfig.id || `candidate-${candidateIndex + 1}`),
        config: candidateConfig,
        pageIds: [...candidateLayoutResult.pageIds],
        quality: candidateLayoutResult.quality,
        translationEngine,
        translatedPages,
        localSessionArgs: buildCandidateLocalSessionArgs({
          candidateConfig,
          manifest: extraction.manifest,
          pageArtifacts,
          renderedPages: previewResult.pages,
          originalPagePreviewUrlsById: subsetPagePreviewUrls(originalPagePreviewRecordsById, candidateLayoutResult.pageIds),
          textlessPagePreviewUrlsById: subsetPagePreviewUrls(textlessPagePreviewRecordsById, candidateLayoutResult.pageIds),
          textlessPageBarriersById: new Map(
            candidateLayoutResult.pageIds
              .map((pageId) => [Number(pageId), textlessPageBarriersById.get(Number(pageId)) || { horizontalBarriers: [], verticalBarriers: [] }]),
          ),
          translationEngine,
          sourceLanguageCode,
          targetLanguageCode,
          openingNotice: candidateLayoutResult.openingNotice,
          autoNudgeEnabled,
          useBarrierDetectionEnabled,
          strictAutoNudgeBBoxCollisionEnabled,
        }),
      });
    }

    if (candidates.length === 0) {
      throw new Error(buildDetectedTextUnsupportedMessage(requestedPages));
    }

    const decision = resolveDocumentRunDecision(candidates, {
      recommendedCandidateId: qualityDecision.recommendedCandidateId,
    });
    if (decision.mode === 'direct-open') {
      const selectedCandidate = candidates.find((candidate) => candidate.id === decision.candidateId);
      if (selectedCandidate) {
        storeLastBrowserTranslationRun({
          sourcePdfName,
          sourceCode: sourceLanguageCode,
          targetCode: targetLanguageCode,
          translationEngine: selectedCandidate.translationEngine,
          translations: selectedCandidate.translatedPages,
        });
      }
    }

    const resolvedPageIds = decision.mode === 'direct-open'
      ? (candidates.find((candidate) => candidate.id === decision.candidateId)?.pageIds || [])
      : [...new Set(candidates.flatMap((candidate) => candidate.pageIds || []))];

    if (decision.mode === 'direct-open') {
      onPhase('create_working_session', {
        pagesDone: resolvedPageIds.length,
        pagesTotal: resolvedPageIds.length,
      });
    }

    return {
      shared: {
        sourcePdfName,
        sourcePdfBytes,
        requestedPages: [...requestedPages],
        supportedPageIds: resolvedPageIds,
        skippedPageIds: [...requestedPages].filter((pageId) => !resolvedPageIds.includes(Number(pageId))),
        detectedTextSupportedPageIds,
        detectedTextSkippedPageIds,
      },
      candidates,
      decision,
      qualityDecision,
    };
  } finally {
    client.destroy();
  }
}
