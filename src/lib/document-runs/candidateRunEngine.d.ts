export declare const DOCUMENT_RUN_PHASES: readonly string[];

export type DocumentRunCandidate = {
  id: string;
  config: Record<string, any>;
  pageIds?: number[];
  quality: {
    status: string;
    reasons: string[];
    averageOcrConfidence?: number | null;
    pageBoxCounts?: Array<{ pageId: number; boxCount: number }>;
  };
  translationEngine?: string;
  translatedPages?: Record<string, any>[];
  localSessionArgs: Record<string, any>;
};

export type DocumentRunDecision =
  | {
    mode: 'direct-open';
    candidateId: string;
    recommendedCandidateId?: string | null;
  }
  | {
    mode: 'choose-candidate';
    candidateIds: string[];
    recommendedCandidateId?: string | null;
  };

export type DocumentQualityDecision = {
  mainResultConfidence: number;
  shouldOpenDirectly: boolean;
  shouldRunAlternatives: boolean;
  suppressMainCandidate: boolean;
  recommendedCandidateId: string | null;
  suspiciousPageIds: number[];
  skippedPageIds: number[];
  reasons: string[];
};

export declare function resolveDocumentRunDecision(
  candidates: Array<{ id: string }>,
): DocumentRunDecision;

export declare function shouldDetectPageBarriers(args?: {
  debugInspectionsEnabled?: boolean;
  useBarrierDetectionEnabled?: boolean;
  mergeContinuationBlocksEnabled?: boolean;
}): boolean;

export declare function shouldRenderTextlessPagePreviews(args?: {
  debugInspectionsEnabled?: boolean;
  protectVisualRegionsEnabled?: boolean;
  useBarrierDetectionEnabled?: boolean;
  mergeContinuationBlocksEnabled?: boolean;
}): boolean;

export declare function runDocumentCandidates(args: {
  file: File;
  requestedPages: number[];
  sourceLanguageCode?: string;
  targetLanguageCode?: string;
  mirrorEnabled?: boolean;
  alternativesEnabled?: boolean;
  candidateIdOverride?: 'main-detected-text' | 'ocr-grouped' | 'ocr-grouped-mirrored' | null;
  autoNudgeEnabled?: boolean;
  strictAutoNudgeBBoxCollisionEnabled?: boolean;
  repairVerticalOverflowEnabled?: boolean;
  preserveVerticalSourceAnchorEnabled?: boolean;
  useTightTextBBoxEnabled?: boolean;
  detectLogosEnabled?: boolean;
  protectVisualRegionsEnabled?: boolean;
  reconstructMixedBidiLinesEnabled?: boolean;
  debugInspectionsEnabled?: boolean;
  useBarrierDetectionEnabled?: boolean;
  mergeContinuationBlocksEnabled?: boolean;
  useBucketFontRatioEnabled?: boolean;
  browserTranslatorTimeoutMs?: number | null;
  mockTranslationRun?: Record<string, any> | null;
  candidateConfigs?: Record<string, any>[] | null;
  onPhase?: (phase: string, details?: { pagesDone?: number; pagesTotal?: number }) => void;
  onQualityDecision?: (decision: DocumentQualityDecision) => void;
}): Promise<{
  shared: {
    sourcePdfName: string;
    sourcePdfBytes: Uint8Array;
    requestedPages: number[];
    supportedPageIds: number[];
    skippedPageIds: number[];
    detectedTextSupportedPageIds: number[];
    detectedTextSkippedPageIds: number[];
  };
  candidates: DocumentRunCandidate[];
  decision: DocumentRunDecision;
  qualityDecision: DocumentQualityDecision;
}>;
