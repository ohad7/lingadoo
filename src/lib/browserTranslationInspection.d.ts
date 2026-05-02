export type BrowserTranslationInspectionEntry = {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  sourceText: string;
  responseText: string;
  errorMessage: string;
  pageId: number | null;
  blockId: string;
  sourceCode: string;
  targetCode: string;
  strict: boolean;
  blockType: string;
  sourceDirection: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
};

export function logBrowserTranslationRequestStarted(args?: Partial<BrowserTranslationInspectionEntry>): string;
export function logBrowserTranslationRequestSucceeded(entryId: string, responseText: string): void;
export function logBrowserTranslationRequestFailed(entryId: string, error: unknown): void;
export function listBrowserTranslationInspectionEntries(): BrowserTranslationInspectionEntry[];
export function clearBrowserTranslationInspectionEntries(): void;
