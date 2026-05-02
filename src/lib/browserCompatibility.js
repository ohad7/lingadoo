export function checkingBrowserCompatibilityReport() {
  return {
    status: 'checking',
    hardBlockers: [],
    warnings: [],
    translatorSupported: false,
    workerRuntimeReady: false,
    previewRenderingReady: false,
    pdfExportReady: false,
  };
}

function browserTranslatorSupported(globalObject = globalThis) {
  const TranslatorImpl = globalObject?.Translator;
  return Boolean(
    TranslatorImpl &&
    typeof TranslatorImpl.availability === 'function' &&
    typeof TranslatorImpl.create === 'function'
  );
}

function baseGlobalSupport(globalObject = globalThis) {
  return {
    worker: typeof globalObject.Worker === 'function',
    blob: typeof globalObject.Blob === 'function',
    objectUrl: typeof globalObject.URL?.createObjectURL === 'function',
    webAssembly: typeof globalObject.WebAssembly === 'object',
  };
}

function classifyCompatibility({
  baseSupport,
  runtimeProbe,
  translatorSupported,
}) {
  const hardBlockers = [];
  const warnings = [];

  if (!baseSupport.worker) {
    hardBlockers.push({
      key: 'worker',
      severity: 'blocker',
      label: 'Module workers',
      detail: 'Lingadoo needs module workers to run extraction, preview rendering, and PDF export locally.',
    });
  }

  if (!baseSupport.webAssembly) {
    hardBlockers.push({
      key: 'webassembly',
      severity: 'blocker',
      label: 'WebAssembly',
      detail: 'Lingadoo needs WebAssembly to load the PDF engine in the browser.',
    });
  }

  if (!baseSupport.blob || !baseSupport.objectUrl) {
    hardBlockers.push({
      key: 'blob-url',
      severity: 'blocker',
      label: 'Blob URLs',
      detail: 'Lingadoo needs Blob and URL.createObjectURL support to show previews and download PDFs.',
    });
  }

  if (runtimeProbe && !runtimeProbe.workerReady) {
    hardBlockers.push({
      key: 'worker-startup',
      severity: 'blocker',
      label: 'Browser worker startup',
      detail: runtimeProbe.error || 'Lingadoo could not start the local browser worker runtime.',
    });
  }

  if (runtimeProbe && !runtimeProbe.wasmReady) {
    hardBlockers.push({
      key: 'mupdf-wasm',
      severity: 'blocker',
      label: 'PDF engine runtime',
      detail: runtimeProbe.error || 'Lingadoo could not load the local MuPDF WebAssembly runtime.',
    });
  }

  if (runtimeProbe && !runtimeProbe.previewCanvasReady) {
    hardBlockers.push({
      key: 'preview-canvas',
      severity: 'blocker',
      label: 'Preview canvas APIs',
      detail: 'Lingadoo needs OffscreenCanvas, createImageBitmap, and convertToBlob for local page previews.',
    });
  }

  if (!translatorSupported) {
    hardBlockers.push({
      key: 'translator-api',
      severity: 'blocker',
      label: 'Supported browsers',
      detail: 'Lingadoo currently works only in Google Chrome and Microsoft Edge on desktop.',
    });
  }

  if (runtimeProbe && !runtimeProbe.workerFetchReady) {
    warnings.push({
      key: 'worker-fetch',
      severity: 'warning',
      label: 'PDF export fonts',
      detail: 'This browser worker cannot fetch export fonts. Local editing works, but PDF download may fail.',
    });
  }

  const workerRuntimeReady = baseSupport.worker && baseSupport.webAssembly && Boolean(runtimeProbe?.workerReady) && Boolean(runtimeProbe?.wasmReady);
  const previewRenderingReady = workerRuntimeReady && Boolean(runtimeProbe?.previewCanvasReady);
  const pdfExportReady = workerRuntimeReady && Boolean(runtimeProbe?.pdfExportReady);

  return {
    status: hardBlockers.length > 0 ? 'blocked' : (warnings.length > 0 ? 'limited' : 'ready'),
    hardBlockers,
    warnings,
    translatorSupported,
    workerRuntimeReady,
    previewRenderingReady,
    pdfExportReady,
  };
}

export async function assessBrowserCompatibility() {
  const baseSupport = baseGlobalSupport();
  const translatorSupported = browserTranslatorSupported();
  return classifyCompatibility({
    baseSupport,
    runtimeProbe: null,
    translatorSupported,
  });
}

export function assessBrowserCompatibilityForTest({
  baseSupport,
  runtimeProbe,
  translatorSupported = true,
}) {
  return classifyCompatibility({
    baseSupport,
    runtimeProbe,
    translatorSupported,
  });
}

export function detectBaseBrowserSupportForTest(globalObject = globalThis) {
  return baseGlobalSupport(globalObject);
}

export function browserTranslatorSupportedForTest(globalObject = globalThis) {
  return browserTranslatorSupported(globalObject);
}
