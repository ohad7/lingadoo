import { getDocumentLanguage, normalizeDocumentLanguageCode } from './documentLanguages.js';

export const BROWSER_PIPELINE_OPERATION = {
  PROBE_RUNTIME: 'probeRuntime',
  EXTRACT_DOCUMENT: 'extractDocument',
  TRANSLATE_LAYOUTS: 'translateLayouts',
  RENDER_CANVAS_PREVIEW: 'renderCanvasPreview',
  BUILD_TEXT_ONLY_PDF: 'buildTextOnlyPdf',
  BUILD_DETECTED_TEXT_OVERLAY_PDF: 'buildDetectedTextOverlayPdf',
  EXPORT_EDITED_PDF: 'exportEditedPdf',
};

export const BROWSER_PIPELINE_ERROR = {
  INVALID_REQUEST: 'invalid_request',
  NOT_IMPLEMENTED: 'not_implemented',
  UNSUPPORTED_RUNTIME: 'unsupported_runtime',
  INTERNAL_ERROR: 'internal_error',
};

function ensureString(value, fallback = '') {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
}

function ensureOptionalPageIds(value) {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error('requestedPages must be an array of page ids');
  }
  return value.map((pageId) => {
    const numeric = Number(pageId);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      throw new Error(`invalid page id: ${String(pageId)}`);
    }
    return numeric;
  });
}

function normalizeDocumentBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('documentBytes must be an ArrayBuffer or Uint8Array');
}

function normalizePageArtifactsById(value) {
  if (!Array.isArray(value)) {
    throw new Error('pageArtifacts must be an array');
  }
  const map = new Map();
  for (const entry of value) {
    const pageId = Number(entry?.pageId);
    if (!Number.isInteger(pageId) || pageId <= 0) {
      throw new Error(`invalid pageArtifacts pageId: ${String(entry?.pageId)}`);
    }
    map.set(pageId, {
      layout: entry?.layout || null,
      fitted: entry?.fitted || null,
    });
  }
  return map;
}

function normalizeLayouts(value) {
  if (!Array.isArray(value)) {
    throw new Error('layouts must be an array');
  }
  return value.map((layout) => {
    if (!layout || typeof layout !== 'object') {
      throw new Error('layout entry must be an object');
    }
    const pageId = Number(layout.page_id);
    if (!Number.isInteger(pageId) || pageId <= 0) {
      throw new Error(`invalid layout page_id: ${String(layout.page_id)}`);
    }
    return layout;
  });
}

function normalizeExportPages(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('pages must be a non-empty array');
  }
  return value.map((page) => {
    const pageId = Number(page?.page_id ?? page?.pageId);
    if (!Number.isInteger(pageId) || pageId <= 0) {
      throw new Error(`invalid export page id: ${String(page?.page_id ?? page?.pageId)}`);
    }
    return {
      page_id: pageId,
      page_size_pt: Array.isArray(page?.page_size_pt)
        ? page.page_size_pt.map((value) => Number(value))
        : [Number(page?.widthPt || 0), Number(page?.heightPt || 0)],
      previewPngBytes: normalizeDocumentBytes(page?.previewPngBytes),
      blocks: Array.isArray(page?.blocks) ? page.blocks : [],
      tables: Array.isArray(page?.tables) ? page.tables : [],
    };
  });
}

export async function handleBrowserPipelineRequest(request) {
  if (!request || typeof request !== 'object') {
    return {
      ok: false,
      error: {
        code: BROWSER_PIPELINE_ERROR.INVALID_REQUEST,
        message: 'request must be an object',
      },
    };
  }

  const requestId = ensureString(request.requestId);
  const operation = ensureString(request.operation);

  try {
    if (operation === BROWSER_PIPELINE_OPERATION.PROBE_RUNTIME) {
      let wasmReady = false;
      let wasmError = '';
      try {
        const imported = await import('mupdf');
        const mupdf = imported?.default || imported;
        const buffer = new mupdf.Buffer();
        try {
          wasmReady = true;
        } finally {
          buffer.destroy?.();
        }
      } catch (error) {
        wasmError = error instanceof Error ? error.message : String(error);
      }

      const previewCanvasReady = (
        typeof OffscreenCanvas === 'function'
        && typeof createImageBitmap === 'function'
        && typeof OffscreenCanvas.prototype?.convertToBlob === 'function'
      );
      const workerFetchReady = typeof fetch === 'function';
      return {
        ok: true,
        requestId,
        operation,
        result: {
          workerReady: true,
          wasmReady,
          previewCanvasReady,
          pdfExportReady: wasmReady && workerFetchReady,
          workerFetchReady,
          error: wasmError || '',
        },
      };
    }

    if (operation === BROWSER_PIPELINE_OPERATION.EXTRACT_DOCUMENT) {
      const requestStartedAt = performance.now();
      const payload = request.payload || {};
      const documentBytes = normalizeDocumentBytes(payload.documentBytes);
      const sourcePdfName = ensureString(payload.sourcePdfName, 'browser-upload.pdf');
      const requestedPages = ensureOptionalPageIds(payload.requestedPages);
      const includeMixed = payload.includeMixed !== false;
      const includeDebugPayloads = payload.includeDebugPayloads === true;
      const extractionMode = ensureString(payload.extractionMode, 'digital');
      const detectLogos = payload.detectLogos === true;
      const reconstructMixedBidiLines = payload.reconstructMixedBidiLines === true;
      console.info('[browser-pipeline-core] extractDocument start', {
        requestId,
        sourcePdfName,
        byteLength: documentBytes.byteLength,
        requestedPages,
        includeMixed,
        extractionMode,
        detectLogos,
        reconstructMixedBidiLines,
      });

      console.info('[browser-pipeline-core] loading extraction modules', { requestId });
      const {
        buildDetectedTextLayoutsFromPdfData,
        buildDigitalLayoutsFromPdfData,
        buildManifestFromPdfData,
      } = await import('./mupdfExtraction.js');
      console.info('[browser-pipeline-core] extraction modules loaded', { requestId });

      const manifestStartedAt = performance.now();
      const manifest = await buildManifestFromPdfData(documentBytes, {
        sourcePdf: sourcePdfName,
        documentId: payload.documentId || undefined,
      });
      console.info('[browser-pipeline-core] extractDocument manifest ready', {
        requestId,
        durationMs: Math.round(performance.now() - manifestStartedAt),
        pageCount: manifest.page_count,
        documentId: manifest.document_id,
      });

      const layoutStartedAt = performance.now();
      const buildLayouts = extractionMode === 'detected-text'
        ? buildDetectedTextLayoutsFromPdfData
        : buildDigitalLayoutsFromPdfData;
      const layouts = includeDebugPayloads
        ? await buildLayouts(documentBytes, {
          manifest,
          requestedPages,
          includeMixed,
          detectLogos,
          reconstructMixedBidiLines,
        })
        : await buildLayouts(documentBytes, {
          manifest,
          requestedPages,
          includeMixed,
          detectLogos,
          reconstructMixedBidiLines,
        });
      console.info('[browser-pipeline-core] extractDocument layouts ready', {
        requestId,
        durationMs: Math.round(performance.now() - layoutStartedAt),
        layoutCount: layouts.length,
        pageIds: layouts.map((layout) => Number(layout.page_id)),
      });
      console.info('[browser-pipeline-core] extractDocument done', {
        requestId,
        durationMs: Math.round(performance.now() - requestStartedAt),
      });

      return {
        ok: true,
        requestId,
        operation,
        result: {
          manifest,
          layouts,
        },
      };
    }

    if (operation === BROWSER_PIPELINE_OPERATION.TRANSLATE_LAYOUTS) {
      const requestStartedAt = performance.now();
      const payload = request.payload || {};
      const layouts = normalizeLayouts(payload.layouts || []);
      console.info('[browser-pipeline-core] translateLayouts start', {
        requestId,
        layoutCount: layouts.length,
      });
      console.info('[browser-pipeline-core] loading translation modules', { requestId });
      const {
        BrowserTranslatorProvider,
        IdentityFallbackTranslator,
        InMemoryTranslationMemory,
        translatePageLayout,
      } = await import('./translation.js');
      console.info('[browser-pipeline-core] translation modules loaded', { requestId });

      const targetCode = normalizeDocumentLanguageCode(ensureString(payload.targetCode, 'en'), 'en');
      const sourceCode = normalizeDocumentLanguageCode(ensureString(payload.sourceCode, 'he'), 'he');
      const sameLanguage = sourceCode === targetCode;
      const browserTranslatorSupported = !sameLanguage && BrowserTranslatorProvider.isSupported();
      const provider = browserTranslatorSupported
        ? new BrowserTranslatorProvider({
          sourceCode,
          targetCode,
          sourceLang: getDocumentLanguage(sourceCode).name,
          targetLang: getDocumentLanguage(targetCode).name,
        })
        : new IdentityFallbackTranslator();
      const translationEngine = sameLanguage
        ? 'browser-same-language'
        : (browserTranslatorSupported ? 'browser-translator' : 'browser-passthrough');
      const modelVersion = translationEngine === 'browser-translator'
        ? 'browser-translator-v1'
        : `${translationEngine}-v1`;
      if (sameLanguage) {
        console.info('[browser-pipeline-core] Source and target languages match, using passthrough translations', {
          requestId,
          sourceCode,
          targetCode,
        });
      } else if (!browserTranslatorSupported) {
        console.warn('[browser-pipeline-core] Browser Translator API unavailable, using passthrough translations', {
          requestId,
          sourceCode,
          targetCode,
        });
      }
      if (browserTranslatorSupported) {
        const availability = await provider.checkAvailability();
        const downloadNeeded = availability === 'downloadable' || availability === 'downloading';
        if (downloadNeeded) {
          provider.setCreateTimeout(120_000);
          console.info('[browser-pipeline-core] Translator language pack download needed', {
            requestId,
            availability,
            sourceCode,
            targetCode,
          });
        }
      }
      const memory = new InMemoryTranslationMemory();
      try {
        const translations = [];
        for (const layout of layouts) {
          translations.push(await translatePageLayout(layout, {
            provider,
            fallback: new IdentityFallbackTranslator(),
            memory,
            context: {
              modelVersion,
              glossaryVersion: 'browser-ui',
              promptVersion: modelVersion,
              sourceCode,
              targetCode,
            },
          }));
        }
        console.info('[browser-pipeline-core] translateLayouts done', {
          requestId,
          durationMs: Math.round(performance.now() - requestStartedAt),
          layoutCount: layouts.length,
          translationEngine,
        });

        return {
          ok: true,
          requestId,
          operation,
          result: {
            translationEngine,
            translations,
          },
        };
      } finally {
        if (provider && typeof provider.destroy === 'function') {
          await provider.destroy();
        }
      }
    }

    if (operation === BROWSER_PIPELINE_OPERATION.RENDER_CANVAS_PREVIEW) {
      const requestStartedAt = performance.now();
      if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
        return {
          ok: false,
          requestId,
          operation,
          error: {
            code: BROWSER_PIPELINE_ERROR.UNSUPPORTED_RUNTIME,
            message: 'renderCanvasPreview requires browser worker canvas APIs',
          },
        };
      }
      const payload = request.payload || {};
      const documentBytes = normalizeDocumentBytes(payload.documentBytes);
      const requestedPages = ensureOptionalPageIds(payload.requestedPages);
      console.info('[browser-pipeline-core] renderCanvasPreview start', {
        requestId,
        byteLength: documentBytes.byteLength,
        requestedPages,
        renderDpi: Number(payload.renderDpi || 150),
      });
      console.info('[browser-pipeline-core] loading preview renderer', { requestId });
      const { renderCanvasPreviewPages } = await import('./browserPreviewRenderer.js');
      console.info('[browser-pipeline-core] preview renderer loaded', { requestId });
      const renderedPages = await renderCanvasPreviewPages(payload.manifest, {
        sourcePdfData: documentBytes,
        pageArtifactsById: normalizePageArtifactsById(payload.pageArtifacts || []),
        requestedPages: requestedPages ? new Set(requestedPages) : null,
        renderDpi: Number(payload.renderDpi || 150),
        clearTableRegionsFromFitted: payload.clearTableRegionsFromFitted !== false,
        redrawTableBordersFromFitted: payload.redrawTableBordersFromFitted === true,
        mirrorEnabled: payload.mirrorEnabled !== false,
        restoreImageOrientationsEnabled: payload.restoreImageOrientations !== false,
        mirrorTableBboxes: payload.mirrorTableBboxes === true,
        graphicRegionEditsByPage: payload.graphicRegionEditsByPage || null,
      });
      console.info('[browser-pipeline-core] renderCanvasPreview done', {
        requestId,
        durationMs: Math.round(performance.now() - requestStartedAt),
        pageCount: renderedPages.length,
      });

      return {
        ok: true,
        requestId,
        operation,
        result: {
          pages: renderedPages,
        },
      };
    }

    if (operation === BROWSER_PIPELINE_OPERATION.BUILD_TEXT_ONLY_PDF) {
      const requestStartedAt = performance.now();
      const payload = request.payload || {};
      const documentBytes = normalizeDocumentBytes(payload.documentBytes);
      const requestedPages = ensureOptionalPageIds(payload.requestedPages);
      console.info('[browser-pipeline-core] buildTextOnlyPdf start', {
        requestId,
        byteLength: documentBytes.byteLength,
        requestedPages,
      });
      const { buildTextOnlyPdf } = await import('./browserTextOnlyPdfRenderer.js');
      const pdfBytes = await buildTextOnlyPdf({
        documentBytes,
        requestedPages,
      });
      console.info('[browser-pipeline-core] buildTextOnlyPdf done', {
        requestId,
        durationMs: Math.round(performance.now() - requestStartedAt),
        byteLength: pdfBytes.byteLength,
      });
      return {
        ok: true,
        requestId,
        operation,
        result: {
          pdfBytes,
        },
      };
    }

    if (operation === BROWSER_PIPELINE_OPERATION.BUILD_DETECTED_TEXT_OVERLAY_PDF) {
      const requestStartedAt = performance.now();
      const payload = request.payload || {};
      const documentBytes = normalizeDocumentBytes(payload.documentBytes);
      const requestedPages = ensureOptionalPageIds(payload.requestedPages);
      const mirrorEnabled = payload.mirrorEnabled === true;
      console.info('[browser-pipeline-core] buildDetectedTextOverlayPdf start', {
        requestId,
        byteLength: documentBytes.byteLength,
        requestedPages,
        mirrorEnabled,
      });
      const { buildDetectedTextOverlayPdf } = await import('./browserTextOnlyPdfRenderer.js');
      const pdfBytes = await buildDetectedTextOverlayPdf({
        documentBytes,
        requestedPages,
        mirrorEnabled,
      });
      console.info('[browser-pipeline-core] buildDetectedTextOverlayPdf done', {
        requestId,
        durationMs: Math.round(performance.now() - requestStartedAt),
        byteLength: pdfBytes.byteLength,
      });
      return {
        ok: true,
        requestId,
        operation,
        result: {
          pdfBytes,
        },
      };
    }

    if (operation === BROWSER_PIPELINE_OPERATION.EXPORT_EDITED_PDF) {
      const requestStartedAt = performance.now();
      const payload = request.payload || {};
      const pages = normalizeExportPages(payload.pages);
      console.info('[browser-pipeline-core] exportEditedPdf start', {
        requestId,
        pageCount: pages.length,
      });
      console.info('[browser-pipeline-core] loading PDF renderer', { requestId });
      const { exportEditedPdfFromPageState } = await import('./browserPdfRenderer.js');
      console.info('[browser-pipeline-core] PDF renderer loaded', { requestId });
      const pdfBytes = await exportEditedPdfFromPageState({ pages });
      console.info('[browser-pipeline-core] exportEditedPdf done', {
        requestId,
        durationMs: Math.round(performance.now() - requestStartedAt),
        byteLength: pdfBytes.byteLength,
      });
      return {
        ok: true,
        requestId,
        operation,
        result: {
          pdfBytes,
        },
      };
    }

    return {
      ok: false,
      requestId,
      operation,
      error: {
        code: BROWSER_PIPELINE_ERROR.INVALID_REQUEST,
        message: `unknown browser pipeline operation: ${operation}`,
      },
    };
  } catch (error) {
    return {
      ok: false,
      requestId,
      operation,
      error: {
        code: BROWSER_PIPELINE_ERROR.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
