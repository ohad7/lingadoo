import type { PagePayload } from '../api/types';
import type { PageBlock } from '../api/types';

export function recomputePageWarnings(
  page: PagePayload,
  options?: {
    recomputeAllDrawPlans?: boolean;
  },
): PagePayload;

export function applyAutoNudgeToPage(
  page: PagePayload,
  options?: {
    repairVerticalOverflowEnabled?: boolean;
    horizontalBarriers?: Array<{ x: number; y1: number; y2: number }>;
    strictAutoNudgeBBoxCollisionEnabled?: boolean;
  },
): PagePayload;

export function fitBlockToWarningPreview(
  block: PageBlock,
  options?: {
    blocks?: PageBlock[];
    pageSize?: number[];
    minFontSize?: number;
    maxFontSize?: number | null;
    allowGrowth?: boolean;
  },
): PageBlock;

export function finalizeEditorPageWarnings(
  page: PagePayload,
  options?: {
    autoNudgeEnabled?: boolean;
    repairVerticalOverflowEnabled?: boolean;
    horizontalBarriers?: Array<{ x: number; y1: number; y2: number }>;
    strictAutoNudgeBBoxCollisionEnabled?: boolean;
  },
): PagePayload;
