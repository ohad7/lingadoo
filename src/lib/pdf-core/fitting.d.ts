export declare const GLOBAL_MIN_FONT_SIZE: number;

export function fitEditableBlockToBBox(
  block: Record<string, any>,
  options?: { minFontSize?: number; maxFontSize?: number | null },
): {
  fontSize: number;
  lineHeight: number;
  lines: string[];
  overflow: boolean;
  lineSpacing: number;
};
