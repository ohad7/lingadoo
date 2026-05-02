export type DocumentLanguageCode = 'en' | 'he' | 'ar' | 'fr' | 'de' | 'it';

export type DocumentLanguage = {
  code: DocumentLanguageCode;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
};

export const DOCUMENT_LANGUAGES: Record<DocumentLanguageCode, DocumentLanguage>;
export const DOCUMENT_LANGUAGE_ORDER: DocumentLanguageCode[];

export function isSupportedDocumentLanguage(code: unknown): boolean;
export function normalizeDocumentLanguageCode(
  code: unknown,
  fallback?: DocumentLanguageCode,
): DocumentLanguageCode;
export function getDocumentLanguage(code: unknown): DocumentLanguage;
export function documentLanguageDirection(code: unknown): 'ltr' | 'rtl';
export function shouldMirrorByDefault(sourceCode: unknown, targetCode: unknown): boolean;
export function containsSourceScript(text: unknown, sourceCode: unknown): boolean;
export function detectDocumentLanguage(text: unknown): {
  code: DocumentLanguageCode;
  name: string;
  confidence: number;
  reason: string;
};
