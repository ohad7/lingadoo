import { measureLinePt } from './textLayoutMetrics.js';

export function resolveJustifiedLineSpacing(lineText, {
  targetWidthPt,
  fontSize,
  fontWeight = 'normal',
} = {}) {
  const text = String(lineText || '');
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length <= 1) {
    return {
      gapCount: 0,
      fullGapWidthPt: 0,
      extraWordSpacingPt: 0,
    };
  }
  const safeTargetWidth = Math.max(0, Number(targetWidthPt) || 0);
  const safeFontSize = Math.max(1, Number(fontSize) || 10);
  const weight = String(fontWeight || 'normal');
  const wordWidths = words.map((word) => measureLinePt(word, safeFontSize, weight));
  const totalWordWidth = wordWidths.reduce((sum, width) => sum + width, 0);
  const fullLineWidth = measureLinePt(text, safeFontSize, weight);
  const gapCount = words.length - 1;
  const fullGapWidthPt = Math.max(0, (safeTargetWidth - totalWordWidth) / gapCount);
  const extraWordSpacingPt = Math.max(0, (safeTargetWidth - fullLineWidth) / gapCount);
  return {
    gapCount,
    fullGapWidthPt,
    extraWordSpacingPt,
  };
}
