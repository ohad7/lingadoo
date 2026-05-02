export const MAIN_DETECTED_TEXT_CANDIDATE_ID = 'main-detected-text';
export const OCR_GROUPED_CANDIDATE_ID = 'ocr-grouped';
export const OCR_GROUPED_MIRRORED_CANDIDATE_ID = 'ocr-grouped-mirrored';

export function buildMainDetectedTextCandidateConfig({
  mirrorEnabled = true,
  preserveVerticalSourceAnchorEnabled = false,
  useTightTextBBoxEnabled = false,
  repairVerticalOverflowEnabled = true,
  useBucketFontRatioEnabled = true,
} = {}) {
  return {
    id: MAIN_DETECTED_TEXT_CANDIDATE_ID,
    internalLabel: 'Main detected text',
    extractionProfile: 'detected-text',
    mirrorMode: mirrorEnabled ? 'forced-on' : 'forced-off',
    fitProfile: useBucketFontRatioEnabled ? 'bucket-ratio' : 'legacy',
    preserveVerticalSourceAnchor: Boolean(preserveVerticalSourceAnchorEnabled),
    useTightTextBbox: Boolean(useTightTextBBoxEnabled),
    repairVerticalOverflow: Boolean(repairVerticalOverflowEnabled),
    restoreImageOrientations: true,
  };
}

export function buildDefaultDocumentCandidateConfigs(options = {}) {
  return [buildMainDetectedTextCandidateConfig(options)];
}

export function buildOcrGroupedCandidateConfig({
  repairVerticalOverflowEnabled = true,
} = {}) {
  return {
    id: OCR_GROUPED_CANDIDATE_ID,
    internalLabel: 'OCR grouped',
    extractionProfile: 'ocr-grouped',
    // OCR candidates treat the page as a fixed rendered background, so keep
    // the layout in source coordinates instead of applying detected-text mirroring.
    mirrorMode: 'forced-off',
    fitProfile: 'bucket-ratio',
    preserveVerticalSourceAnchor: false,
    useTightTextBbox: false,
    repairVerticalOverflow: Boolean(repairVerticalOverflowEnabled),
    restoreImageOrientations: false,
  };
}

export function buildOcrGroupedMirroredCandidateConfig({
  repairVerticalOverflowEnabled = true,
} = {}) {
  return {
    id: OCR_GROUPED_MIRRORED_CANDIDATE_ID,
    internalLabel: 'OCR grouped mirrored',
    extractionProfile: 'ocr-grouped',
    mirrorMode: 'forced-on',
    fitProfile: 'bucket-ratio',
    preserveVerticalSourceAnchor: false,
    useTightTextBbox: false,
    repairVerticalOverflow: Boolean(repairVerticalOverflowEnabled),
    restoreImageOrientations: false,
  };
}

export function buildDocumentCandidateConfigsForOverride(overrideId, options = {}) {
  if (overrideId === OCR_GROUPED_MIRRORED_CANDIDATE_ID) {
    return [buildOcrGroupedMirroredCandidateConfig(options)];
  }
  if (overrideId === OCR_GROUPED_CANDIDATE_ID) {
    return [buildOcrGroupedCandidateConfig(options)];
  }
  if (overrideId === MAIN_DETECTED_TEXT_CANDIDATE_ID) {
    return [buildMainDetectedTextCandidateConfig(options)];
  }
  return buildDefaultDocumentCandidateConfigs(options);
}
