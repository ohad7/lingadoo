function cloneTranslationPages(translations, {
  layoutByPageId,
  fallbackDocumentId,
} = {}) {
  return (translations || []).map((entry) => ({
    ...entry,
    document_id: String(layoutByPageId?.get(Number(entry?.page_id))?.document_id || fallbackDocumentId || entry?.document_id || ''),
    page_id: Number(entry?.page_id),
    blocks: Array.isArray(entry?.blocks)
      ? entry.blocks.map((block) => ({ ...block }))
      : [],
  }));
}

export function resolveMockTranslationRun({
  mockRun,
  fileName,
  sourceCode,
  targetCode,
  layouts,
  fallbackDocumentId = '',
} = {}) {
  if (
    !mockRun
    || String(mockRun.sourcePdfName || '') !== String(fileName || '')
    || String(mockRun.sourceCode || '') !== String(sourceCode || '')
    || String(mockRun.targetCode || '') !== String(targetCode || '')
    || !Array.isArray(mockRun.translations)
  ) {
    return null;
  }
  const layoutByPageId = new Map((layouts || []).map((layout) => [Number(layout?.page_id), layout]));
  return {
    translationEngine: String(mockRun.translationEngine || 'browser-mock-translator'),
    translations: cloneTranslationPages(mockRun.translations, {
      layoutByPageId,
      fallbackDocumentId,
    }),
  };
}

export function buildStoredBrowserTranslationRun({
  sourcePdfName,
  sourceCode,
  targetCode,
  translationEngine,
  translations,
}) {
  return {
    sourcePdfName: String(sourcePdfName || ''),
    sourceCode: String(sourceCode || ''),
    targetCode: String(targetCode || ''),
    translationEngine: String(translationEngine || 'browser-local'),
    translations: cloneTranslationPages(translations),
  };
}
