export declare function partitionDetectedTextRequestedPages(
  requestedPages: number[],
  layouts: Array<{ page_id?: number; blocks?: unknown[] }>,
): {
  supportedPageIds: number[];
  skippedPageIds: number[];
};

export declare function buildDetectedTextUnsupportedMessage(pageIds: number[]): string;

export declare function buildDetectedTextSkippedPagesNotice(pageIds: number[]): string;
