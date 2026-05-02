export function wrapModeForSourceBlock(block: Record<string, any>): string;
export function effectiveFontWeightForBlock(block: Record<string, any>): 'normal' | 'bold';
export function shouldApplyFauxBoldStrokeForBlock(block: Record<string, any>, baseFontSize: number): boolean;
export function prepareLineForPdfRender(line: string): string;
export function sourceClipDefaultsForLayout(layout: Record<string, any>): Record<string, boolean>;
export function resolvedLineSpacingForBlock(
  block: Record<string, any>,
  options?: { referenceFontSize?: number | null },
): number;
export function rescaledLineHeightForFontSize(
  block: Record<string, any>,
  nextFontSize: number,
): number;
export function resolveTextOrientationForBlock(block: Record<string, any>): 'horizontal' | 'vertical_ttb';
export function resolveTextRotationDegForBlock(
  block: Record<string, any>,
  options?: { mirrorEnabled?: boolean },
): 0 | 90 | -90;
export function resolveLineBaselinePt(
  block: Record<string, any>,
  options?: {
    fontSize?: number;
    lineHeight?: number;
    contentHeight?: number;
    lineIndex?: number;
    lineCount?: number;
  },
): number;
export function rebuildLocalDrawPlan(
  block: Record<string, any>,
  options?: { preferredLines?: string[] | null },
): {
  drawPlan: {
    font_size: number;
    line_height: number;
    font_weight: string;
    text_orientation: string;
    text_padding_pt: number;
    truncated: boolean;
    lines: Array<{
      text: string;
      x_pt: number;
      baseline_pt: number;
    }>;
    render_mode: number;
    stroke_width: number;
    faux_bold_policy: string;
  };
  truncated: boolean;
  overflow: boolean;
  redacted: boolean;
};
export function buildStoredDrawPlanForFittedBlock(args: {
  fittedBlock: Record<string, any>;
  sourceBlock: Record<string, any>;
  style: Record<string, any>;
  sourceClipDefault?: boolean;
  clipMode?: string;
  bboxEdited?: boolean;
  fauxBoldPolicy?: string;
  preserveVerticalSourceAnchor?: boolean;
  mirrorEnabled?: boolean;
}): {
  block: Record<string, any>;
};
