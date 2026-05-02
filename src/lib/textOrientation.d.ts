export const TEXT_ORIENTATION: {
  HORIZONTAL: 'horizontal';
  VERTICAL_TTB: 'vertical_ttb';
};

export function resolveTextOrientation(value: unknown): 'horizontal' | 'vertical_ttb';
export function isVerticalTextOrientation(value: unknown): boolean;
export function resolveTextPaddingPt(value: unknown): number;
export function resolveTextRenderRotationDeg(orientation: unknown, mirrorEnabled?: boolean): 0 | 90 | -90;
export function detectTextOrientationFromChars(chars: Array<{ c?: unknown; bbox?: number[] }> | unknown): 'horizontal' | 'vertical_ttb';
export function resolveLogicalTextFrame(
  bbox: number[] | unknown,
  options?: { orientation?: unknown; paddingPt?: number },
): {
  physicalWidth: number;
  physicalHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  contentWidth: number;
  contentHeight: number;
  paddingPt: number;
};
export function mapLogicalRectToPhysicalRect(
  logicalRect: number[] | unknown,
  options?: { physicalWidth?: number; physicalHeight?: number; rotationDeg?: number },
): number[];
