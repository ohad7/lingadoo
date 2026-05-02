export function resolveJustifiedLineSpacing(lineText: string, options?: {
  targetWidthPt?: number;
  fontSize?: number;
  fontWeight?: string;
}): {
  gapCount: number;
  fullGapWidthPt: number;
  extraWordSpacingPt: number;
};
