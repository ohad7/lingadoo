import {
  buildMainDetectedTextCandidateConfig,
  buildOcrGroupedCandidateConfig,
  buildOcrGroupedMirroredCandidateConfig,
  MAIN_DETECTED_TEXT_CANDIDATE_ID,
  OCR_GROUPED_CANDIDATE_ID,
  OCR_GROUPED_MIRRORED_CANDIDATE_ID,
} from './candidateRunCatalog.js';

function roundConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, numeric)) * 1000) / 1000;
}

export function collectSuspiciousPageIds(layouts) {
  return (Array.isArray(layouts) ? layouts : [])
    .filter((layout) => Boolean(layout?.extraction_warning?.suspicious))
    .map((layout) => Number(layout?.page_id))
    .filter((pageId) => Number.isInteger(pageId) && pageId > 0);
}

export function evaluateDocumentQuality({
  requestedPages,
  detectedTextLayouts,
  detectedTextSupportedPageIds,
  detectedTextSkippedPageIds,
  mirrorEnabled = true,
  alternativesEnabled = false,
} = {}) {
  const normalizedRequestedPages = Array.isArray(requestedPages)
    ? requestedPages.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const requestedCount = normalizedRequestedPages.length;
  const supportedPageIds = Array.isArray(detectedTextSupportedPageIds)
    ? detectedTextSupportedPageIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const skippedPageIds = Array.isArray(detectedTextSkippedPageIds)
    ? detectedTextSkippedPageIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const suspiciousPageIds = collectSuspiciousPageIds(detectedTextLayouts);
  const reasons = [];
  if (suspiciousPageIds.length > 0) {
    reasons.push('suspicious_extraction');
  }
  if (skippedPageIds.length > 0) {
    reasons.push('unsupported_detected_text_pages');
  }

  const suspiciousRatio = requestedCount > 0 ? suspiciousPageIds.length / requestedCount : 0;
  const skippedRatio = requestedCount > 0 ? skippedPageIds.length / requestedCount : 0;
  const mainResultConfidence = roundConfidence(1 - Math.min(1, (suspiciousRatio * 0.7) + (skippedRatio * 0.8)));
  const suppressMainCandidate = supportedPageIds.length === 0;
  const shouldRunAlternatives = Boolean(alternativesEnabled && (reasons.length > 0 || suppressMainCandidate));
  const recommendedCandidateId = shouldRunAlternatives
    ? (mirrorEnabled ? OCR_GROUPED_MIRRORED_CANDIDATE_ID : OCR_GROUPED_CANDIDATE_ID)
    : MAIN_DETECTED_TEXT_CANDIDATE_ID;

  return {
    mainResultConfidence,
    shouldOpenDirectly: !shouldRunAlternatives,
    shouldRunAlternatives,
    suppressMainCandidate,
    recommendedCandidateId,
    suspiciousPageIds,
    skippedPageIds,
    reasons,
  };
}

export function buildPlannedCandidateConfigs({
  qualityDecision,
  mirrorEnabled = true,
  repairVerticalOverflowEnabled = true,
  preserveVerticalSourceAnchorEnabled = false,
  useTightTextBBoxEnabled = false,
  useBucketFontRatioEnabled = true,
} = {}) {
  const mainCandidate = buildMainDetectedTextCandidateConfig({
    mirrorEnabled,
    repairVerticalOverflowEnabled,
    preserveVerticalSourceAnchorEnabled,
    useTightTextBBoxEnabled,
    useBucketFontRatioEnabled,
  });
  if (!qualityDecision?.shouldRunAlternatives) {
    return [mainCandidate];
  }

  const candidates = [];
  if (!qualityDecision?.suppressMainCandidate) {
    candidates.push(mainCandidate);
  }
  candidates.push(buildOcrGroupedCandidateConfig({
    repairVerticalOverflowEnabled,
  }));
  if (mirrorEnabled) {
    candidates.push(buildOcrGroupedMirroredCandidateConfig({
      repairVerticalOverflowEnabled,
    }));
  }
  return candidates;
}
