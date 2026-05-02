function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function resolveStore() {
  const globalObject = globalThis;
  if (!globalObject.__LINGADOO_BROWSER_TRANSLATION_INSPECTION__) {
    globalObject.__LINGADOO_BROWSER_TRANSLATION_INSPECTION__ = {
      nextId: 1,
      entries: [],
    };
  }
  return globalObject.__LINGADOO_BROWSER_TRANSLATION_INSPECTION__;
}

export function logBrowserTranslationRequestStarted({
  sourceText,
  pageId = null,
  blockId = '',
  sourceCode = '',
  targetCode = '',
  strict = false,
  blockType = '',
  sourceDirection = '',
} = {}) {
  const store = resolveStore();
  const id = `browser-translation-${store.nextId++}`;
  const entry = {
    id,
    status: 'pending',
    sourceText: String(sourceText || ''),
    responseText: '',
    errorMessage: '',
    pageId: Number.isInteger(Number(pageId)) ? Number(pageId) : null,
    blockId: String(blockId || ''),
    sourceCode: String(sourceCode || ''),
    targetCode: String(targetCode || ''),
    strict: Boolean(strict),
    blockType: String(blockType || ''),
    sourceDirection: String(sourceDirection || ''),
    startedAt: new Date().toISOString(),
    finishedAt: '',
    durationMs: null,
  };
  store.entries.push(entry);
  return id;
}

export function logBrowserTranslationRequestSucceeded(entryId, responseText) {
  const store = resolveStore();
  const entry = store.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return;
  }
  entry.status = 'succeeded';
  entry.responseText = String(responseText || '');
  entry.finishedAt = new Date().toISOString();
  entry.durationMs = Math.max(
    0,
    Date.parse(entry.finishedAt) - Date.parse(entry.startedAt),
  );
}

export function logBrowserTranslationRequestFailed(entryId, error) {
  const store = resolveStore();
  const entry = store.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return;
  }
  entry.status = 'failed';
  entry.errorMessage = error instanceof Error ? error.message : String(error || '');
  entry.finishedAt = new Date().toISOString();
  entry.durationMs = Math.max(
    0,
    Date.parse(entry.finishedAt) - Date.parse(entry.startedAt),
  );
}

export function listBrowserTranslationInspectionEntries() {
  return clone(resolveStore().entries);
}

export function clearBrowserTranslationInspectionEntries() {
  const store = resolveStore();
  store.entries = [];
}
