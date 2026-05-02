import { BROWSER_PIPELINE_OPERATION } from './browserPipelineCore.js';
import { getDocumentLanguage, normalizeDocumentLanguageCode } from './documentLanguages.js';

let nextRequestId = 1;

export class BrowserPipelineClient {
  constructor() {
    this._worker = new Worker(new URL('./browserPipelineWorker.js', import.meta.url), { type: 'module' });
    this._pending = new Map();
    this._worker.addEventListener('message', (event) => {
      const response = event.data;
      const requestId = String(response?.requestId || '');
      const pending = this._pending.get(requestId);
      if (!pending) {
        return;
      }
      this._pending.delete(requestId);
      const durationMs = Math.round(performance.now() - pending.startedAt);
      if (response?.ok) {
        console.info('[browser-pipeline] request succeeded', {
          requestId,
          operation: pending.operation,
          durationMs,
        });
        pending.resolve(response.result);
        return;
      }
      const message = response?.error?.message || 'browser pipeline request failed';
      const error = new Error(message);
      error.code = response?.error?.code || 'internal_error';
      console.error('[browser-pipeline] request failed', {
        requestId,
        operation: pending.operation,
        durationMs,
        code: error.code,
        message,
      });
      pending.reject(error);
    });
    this._worker.addEventListener('error', (event) => {
      const error = event?.error instanceof Error ? event.error : new Error(event?.message || 'browser pipeline worker failed');
      console.error('[browser-pipeline] worker error', error);
      for (const pending of this._pending.values()) {
        pending.reject(error);
      }
      this._pending.clear();
    });
  }

  destroy() {
    this._worker.terminate();
    this._pending.clear();
  }

  async extractDocument({
    documentBytes,
    sourcePdfName = 'browser-upload.pdf',
    documentId = null,
    requestedPages = null,
    includeMixed = true,
    extractionMode = 'digital',
    detectLogos = false,
    reconstructMixedBidiLines = false,
  }) {
    const bytes = documentBytes instanceof Uint8Array
      ? documentBytes
      : new Uint8Array(documentBytes);
    const transferableBytes = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;

    return this._request(
      BROWSER_PIPELINE_OPERATION.EXTRACT_DOCUMENT,
      {
        documentBytes: transferableBytes,
        sourcePdfName,
        documentId,
        requestedPages,
        includeMixed,
        extractionMode,
        detectLogos,
        reconstructMixedBidiLines,
      },
      [transferableBytes],
    );
  }

  async renderCanvasPreview(payload) {
    return this._request(BROWSER_PIPELINE_OPERATION.RENDER_CANVAS_PREVIEW, payload);
  }

  async buildTextOnlyPdf({
    documentBytes,
    requestedPages = null,
  }) {
    const bytes = documentBytes instanceof Uint8Array
      ? documentBytes
      : new Uint8Array(documentBytes);
    const transferableBytes = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;

    return this._request(
      BROWSER_PIPELINE_OPERATION.BUILD_TEXT_ONLY_PDF,
      {
        documentBytes: transferableBytes,
        requestedPages,
      },
      [transferableBytes],
    );
  }

  async buildDetectedTextOverlayPdf({
    documentBytes,
    requestedPages = null,
    mirrorEnabled = false,
  }) {
    const bytes = documentBytes instanceof Uint8Array
      ? documentBytes
      : new Uint8Array(documentBytes);
    const transferableBytes = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;

    return this._request(
      BROWSER_PIPELINE_OPERATION.BUILD_DETECTED_TEXT_OVERLAY_PDF,
      {
        documentBytes: transferableBytes,
        requestedPages,
        mirrorEnabled,
      },
      [transferableBytes],
    );
  }

  async probeRuntime() {
    return this._request(BROWSER_PIPELINE_OPERATION.PROBE_RUNTIME, {});
  }

  async exportEditedPdf({ pages }) {
    return this._request(BROWSER_PIPELINE_OPERATION.EXPORT_EDITED_PDF, { pages });
  }

  async prepareTranslator({
    sourceCode = 'he',
    targetCode = 'en',
    browserTranslatorTimeoutMs = null,
  }) {
    const {
      BrowserTranslatorProvider,
      IdentityFallbackTranslator,
    } = await import('./translation.js');
    const normalizedSourceCode = normalizeDocumentLanguageCode(sourceCode, 'he');
    const normalizedTargetCode = normalizeDocumentLanguageCode(targetCode, 'en');
    const sameLanguage = normalizedSourceCode === normalizedTargetCode;
    const browserTranslatorSupported = !sameLanguage && BrowserTranslatorProvider.isSupported();

    if (sameLanguage || !browserTranslatorSupported) {
      return {
        provider: new IdentityFallbackTranslator(),
        availability: sameLanguage ? 'same-language' : 'unsupported',
        downloadNeeded: false,
        translationEngine: sameLanguage ? 'browser-same-language' : 'browser-passthrough',
      };
    }

    const provider = new BrowserTranslatorProvider({
      sourceCode: normalizedSourceCode,
      targetCode: normalizedTargetCode,
      sourceLang: getDocumentLanguage(normalizedSourceCode).name,
      targetLang: getDocumentLanguage(normalizedTargetCode).name,
      timeoutMs: browserTranslatorTimeoutMs,
    });

    const availability = await provider.checkAvailability();
    if (availability === 'unavailable') {
      return {
        provider: new IdentityFallbackTranslator(),
        availability,
        downloadNeeded: false,
        translationEngine: 'browser-passthrough',
      };
    }

    const downloadNeeded = availability === 'downloadable' || availability === 'downloading';
    if (downloadNeeded) {
      provider.setCreateTimeout(120_000);
      console.info('[browser-pipeline] Translator language pack download needed', {
        availability,
        sourceCode: normalizedSourceCode,
        targetCode: normalizedTargetCode,
      });
    }

    return {
      provider,
      availability,
      downloadNeeded,
      translationEngine: 'browser-translator',
    };
  }

  async translateLayouts({
    layouts,
    sourceCode = 'he',
    targetCode = 'en',
    browserTranslatorTimeoutMs = null,
    provider: externalProvider = null,
  }) {
    const requestId = `browser-pipeline-${nextRequestId++}`;
    const startedAt = performance.now();
    console.info('[browser-pipeline] request start', {
      requestId,
      operation: BROWSER_PIPELINE_OPERATION.TRANSLATE_LAYOUTS,
      runtime: 'main-thread',
    });
    const {
      IdentityFallbackTranslator,
      InMemoryTranslationMemory,
      translatePageLayout,
    } = await import('./translation.js');
    const normalizedSourceCode = normalizeDocumentLanguageCode(sourceCode, 'he');
    const normalizedTargetCode = normalizeDocumentLanguageCode(targetCode, 'en');
    const sameLanguage = normalizedSourceCode === normalizedTargetCode;

    let provider;
    let translationEngine;
    let ownsProvider = false;

    if (externalProvider) {
      provider = externalProvider;
      translationEngine = 'browser-translator';
      // Caller owns destruction of external providers
    } else {
      const prepared = await this.prepareTranslator({
        sourceCode,
        targetCode,
        browserTranslatorTimeoutMs,
      });
      provider = prepared.provider;
      translationEngine = prepared.translationEngine;
      ownsProvider = true;
    }

    if (sameLanguage) {
      console.info('[browser-pipeline] Source and target languages match, using passthrough translations', {
        requestId,
        sourceCode: normalizedSourceCode,
        targetCode: normalizedTargetCode,
      });
    } else if (translationEngine === 'browser-passthrough') {
      console.warn('[browser-pipeline] Browser Translator API unavailable on main thread, using passthrough translations', {
        requestId,
        sourceCode: normalizedSourceCode,
        targetCode: normalizedTargetCode,
      });
    }

    const runTranslations = async () => {
      const memory = new InMemoryTranslationMemory();
      const translations = [];
      for (const layout of layouts) {
        translations.push(await translatePageLayout(layout, {
          provider,
          fallback: new IdentityFallbackTranslator(),
          memory,
          context: {
            modelVersion: translationEngine === 'browser-translator' ? 'browser-translator-v1' : 'browser-passthrough-v1',
            glossaryVersion: 'browser-ui',
            promptVersion: translationEngine === 'browser-translator' ? 'browser-translator-v1' : `${translationEngine}-v1`,
            sourceCode: normalizedSourceCode,
            targetCode: normalizedTargetCode,
          },
        }));
      }
      return translations;
    };
    try {
      const translations = await runTranslations();
      console.info('[browser-pipeline] request succeeded', {
        requestId,
        operation: BROWSER_PIPELINE_OPERATION.TRANSLATE_LAYOUTS,
        runtime: 'main-thread',
        durationMs: Math.round(performance.now() - startedAt),
        translationEngine,
      });
      return {
        translationEngine,
        translations,
      };
    } catch (error) {
      console.error('[browser-pipeline] request failed', {
        requestId,
        operation: BROWSER_PIPELINE_OPERATION.TRANSLATE_LAYOUTS,
        runtime: 'main-thread',
        durationMs: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (ownsProvider && provider && typeof provider.destroy === 'function') {
        await provider.destroy();
      }
    }
  }

  _request(operation, payload, transfer = []) {
    const requestId = `browser-pipeline-${nextRequestId++}`;
    return new Promise((resolve, reject) => {
      console.info('[browser-pipeline] request start', {
        requestId,
        operation,
      });
      this._pending.set(requestId, {
        resolve,
        reject,
        operation,
        startedAt: performance.now(),
      });
      this._worker.postMessage({ requestId, operation, payload }, transfer);
    });
  }
}
