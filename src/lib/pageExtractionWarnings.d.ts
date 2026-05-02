import type { PagePayload } from '../api/types';

export declare function buildExtractionWarningSummary(
  pageId: number | null,
  warning: PagePayload['extraction_warning'] | null,
): string;

export declare function buildEditorExtractionNotices(args: {
  openingNotice?: string;
  activePageId?: number | null;
  activeExtractionWarning?: PagePayload['extraction_warning'] | null;
}): Array<{
  key: string;
  tone: 'info' | 'warning';
  message: string;
}>;
