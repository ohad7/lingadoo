export function parseBooleanSearchParam(search, key, defaultValue = true) {
  const rawSearch = String(search || '');
  const rawKey = String(key || '').trim();
  if (!rawKey) return defaultValue;
  const params = new URLSearchParams(rawSearch.startsWith('?') ? rawSearch : `?${rawSearch}`);
  const rawValue = params.get(rawKey);
  if (rawValue == null || rawValue === '') return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
    return true;
  }
  return defaultValue;
}

export function parseNumberSearchParam(search, key, defaultValue = null) {
  const rawSearch = String(search || '');
  const rawKey = String(key || '').trim();
  if (!rawKey) return defaultValue;
  const params = new URLSearchParams(rawSearch.startsWith('?') ? rawSearch : `?${rawSearch}`);
  const rawValue = params.get(rawKey);
  if (rawValue == null || rawValue === '') return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed;
}

export function parseStringSearchParam(search, key, defaultValue = '') {
  const rawSearch = String(search || '');
  const rawKey = String(key || '').trim();
  if (!rawKey) return defaultValue;
  const params = new URLSearchParams(rawSearch.startsWith('?') ? rawSearch : `?${rawSearch}`);
  const rawValue = params.get(rawKey);
  if (rawValue == null) return defaultValue;
  const normalized = String(rawValue).trim();
  return normalized || defaultValue;
}

export function resolveAutoNudgeEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'autoNudge', true);
}

export function resolveUseBucketFontRatioEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'useBucketFontRatio', true);
}

export function resolvePreserveVerticalSourceAnchorEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'preserveVerticalSourceAnchor', false);
}

export function resolveUseTightTextBBoxEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'useTightTextBbox', false);
}

export function resolveRepairVerticalOverflowEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'repairVerticalOverflow', true);
}

export function resolveEnableTesseractOcrFromSearch(search) {
  return parseBooleanSearchParam(search, 'enableTesseractOcr', true);
}

export function resolveDetectLogosEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'detectLogos', false);
}

export function resolveProtectVisualRegionsEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'protectVisualRegions', true);
}

export function resolveDefaultReconstructMixedBidiLinesEnabled({
  appMode = 'translate',
  sourceLanguageCode = '',
} = {}) {
  const normalizedMode = String(appMode || 'translate').trim().toLowerCase();
  const normalizedLanguageCode = String(sourceLanguageCode || '').trim().toLowerCase();
  return normalizedMode === 'edit' && (
    normalizedLanguageCode === 'he'
    || normalizedLanguageCode === 'ar'
  );
}

export function resolveReconstructMixedBidiLinesEnabledFromSearch(search, defaultValue = false) {
  return parseBooleanSearchParam(search, 'reconstructMixedBidiLines', defaultValue);
}

export function resolveDebugInspectionsEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'debugInspections', false);
}

export function resolveDocumentAlternativesEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'documentAlternatives', true);
}

export function resolveBrowserTranslatorTimeoutMsFromSearch(search) {
  const value = parseNumberSearchParam(search, 'browserTranslatorTimeoutMs', null);
  return value != null && value > 0 ? value : null;
}

export function resolveProgressToneFromSearch(search) {
  const value = parseStringSearchParam(search, 'progressTone', 'silly').toLowerCase();
  if (value === 'calm' || value === 'playful' || value === 'silly') {
    return value;
  }
  return 'silly';
}

export function resolveSkipSingleCharBlocksFromSearch(search) {
  return parseBooleanSearchParam(search, 'skipSingleCharBlocks', true);
}

export function resolveUseBarrierDetectionFromSearch(search) {
  return parseBooleanSearchParam(search, 'useBarrierDetection', true);
}

export function resolveStrictAutoNudgeBBoxCollisionFromSearch(search) {
  return parseBooleanSearchParam(search, 'strictAutoNudgeBBoxCollision', true);
}

export function resolveMergeContinuationBlocksEnabledFromSearch(search) {
  return parseBooleanSearchParam(search, 'mergeContinuationBlocks', false);
}

export function resolveDocumentCandidateOverrideFromSearch(search) {
  const value = parseStringSearchParam(search, 'documentCandidate', '').toLowerCase();
  if (value === 'main-detected-text' || value === 'ocr-grouped' || value === 'ocr-grouped-mirrored') {
    return value;
  }
  return null;
}
