export function mergeBlockTextParts(
  blocks: Array<Record<string, unknown>>,
  fieldName: string,
): string;

export function shouldRetranslateJoinedBlock(args: {
  mergedText: string;
  mergedSourceText: string;
  sourceLanguageCode?: string;
  targetLanguageCode?: string;
}): boolean;

export function buildJoinedBlockForFit(
  anchorBlock: Record<string, unknown>,
  blocks: Array<Record<string, unknown>>,
  args: {
    text: string;
    sourceText: string;
    bbox: number[];
    sourceBBox?: number[];
  },
): Record<string, unknown>;
