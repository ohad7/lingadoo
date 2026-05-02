export function isEligibleForTightTextBBox(block: Record<string, unknown>): boolean;
export function proposeTightTextBBox(block: Record<string, unknown>): number[] | null;
export function applyTightTextBBoxToEditorBlock(block: Record<string, unknown>): Record<string, unknown>;
export function resolveTightTextBBoxPreview(block: Record<string, unknown>): {
  sourceBBox: number[];
  displayBBox: number[];
  tightened: boolean;
} | null;
