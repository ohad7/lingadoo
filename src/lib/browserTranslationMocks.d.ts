export function resolveMockTranslationRun(args?: {
  mockRun?: Record<string, any> | null;
  fileName?: string;
  sourceCode?: string;
  targetCode?: string;
  layouts?: Record<string, any>[];
  fallbackDocumentId?: string;
}): {
  translationEngine: string;
  translations: Record<string, any>[];
} | null;

export function buildStoredBrowserTranslationRun(args: {
  sourcePdfName?: string;
  sourceCode?: string;
  targetCode?: string;
  translationEngine?: string;
  translations?: Record<string, any>[];
}): {
  sourcePdfName: string;
  sourceCode: string;
  targetCode: string;
  translationEngine: string;
  translations: Record<string, any>[];
};
