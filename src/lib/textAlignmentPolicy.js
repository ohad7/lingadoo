const RTL_PATTERN = /[\u0590-\u08FF]/u;
const LTR_PATTERN = /[A-Za-z]/u;

function countMatches(text, regex) {
  let count = 0;
  for (const char of String(text || '')) {
    if (regex.test(char)) {
      count += 1;
    }
  }
  return count;
}

export function inferTextDirection(text) {
  const rtlCount = countMatches(text, RTL_PATTERN);
  const ltrCount = countMatches(text, LTR_PATTERN);
  if (rtlCount === 0 && ltrCount === 0) {
    return 'ltr';
  }
  return rtlCount > ltrCount ? 'rtl' : 'ltr';
}

function normalizeRenderableAlignment(alignment) {
  const normalized = String(alignment || 'left');
  if (normalized === 'start' || normalized === 'auto') {
    return 'start';
  }
  if (normalized === 'right' || normalized === 'center' || normalized === 'justify') {
    return normalized;
  }
  return 'left';
}

function isTightTextTightness(textTightness) {
  const normalized = String(textTightness || '').trim().toLowerCase();
  return normalized === 'tight' || normalized === 'split-tight';
}

function resolveDirectionalStartAlignment(text) {
  return inferTextDirection(text) === 'rtl' ? 'right' : 'left';
}

export function resolveEffectiveAlignment({
  alignment = 'left',
  text = '',
  textTightness = '',
  alignmentEdited = false,
} = {}) {
  if (isTightTextTightness(textTightness) && alignmentEdited !== true) {
    return resolveDirectionalStartAlignment(text);
  }
  const normalized = normalizeRenderableAlignment(alignment);
  if (normalized === 'start') {
    return resolveDirectionalStartAlignment(text);
  }
  return normalized;
}

function mirrorSemanticAlignment(alignment) {
  const normalized = normalizeRenderableAlignment(alignment);
  if (normalized === 'start') {
    return 'start';
  }
  if (normalized === 'justify') {
    return 'justify';
  }
  if (normalized === 'left') {
    return 'right';
  }
  if (normalized === 'right') {
    return 'left';
  }
  return normalized;
}

export function resolveMirroredAlignment({
  sourceAlignment = 'left',
  translatedText = '',
  textTightness = '',
  mirrorEnabled = true,
  alignmentEdited = false,
} = {}) {
  if (isTightTextTightness(textTightness) && alignmentEdited !== true) {
    return resolveDirectionalStartAlignment(translatedText);
  }
  if (normalizeRenderableAlignment(sourceAlignment) === 'start') {
    return resolveDirectionalStartAlignment(translatedText);
  }
  if (mirrorEnabled === false) {
    return normalizeRenderableAlignment(sourceAlignment);
  }
  return mirrorSemanticAlignment(sourceAlignment);
}
