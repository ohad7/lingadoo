export const FAUX_BOLD_MIN_FONT_SIZE = 10.0;
export const FAUX_BOLD_STROKE_FIXED = 0.02;

export function normalizeFauxBoldPolicy(policy) {
  const candidate = String(policy || 'semantic').trim().toLowerCase();
  if (candidate === 'auto') {
    return 'semantic';
  }
  if (candidate === 'stroke') {
    return 'stroke';
  }
  return 'semantic';
}

export function isFauxBoldRenderMode(renderMode) {
  return Number(renderMode || 0) === 2;
}

export function resolveEffectiveWeightValue({
  explicitWeight,
  renderMode,
  policy = 'semantic',
} = {}) {
  const normalizedPolicy = normalizeFauxBoldPolicy(policy);
  const normalizedWeight = String(explicitWeight || 'normal').trim().toLowerCase() === 'bold'
    ? 'bold'
    : 'normal';
  if (normalizedWeight === 'bold') {
    return 'bold';
  }
  if (normalizedPolicy === 'semantic' && isFauxBoldRenderMode(renderMode)) {
    return 'bold';
  }
  return 'normal';
}

export function shouldApplyFauxBold({
  renderMode,
  fittedFontSize,
  policy = 'semantic',
} = {}) {
  if (normalizeFauxBoldPolicy(policy) !== 'stroke') {
    return false;
  }
  if (!isFauxBoldRenderMode(renderMode)) {
    return false;
  }
  return Number(fittedFontSize || 0) >= FAUX_BOLD_MIN_FONT_SIZE;
}

export function resolveFauxBoldStrokeWidth({
  sourceStrokeWidth,
  fittedFontSize,
} = {}) {
  if (Number(fittedFontSize || 0) <= 0) {
    return FAUX_BOLD_STROKE_FIXED;
  }
  if (Number(sourceStrokeWidth || 0) <= 0) {
    return FAUX_BOLD_STROKE_FIXED;
  }
  return Math.min(Number(sourceStrokeWidth), FAUX_BOLD_STROKE_FIXED);
}
