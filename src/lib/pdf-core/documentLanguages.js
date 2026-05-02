export const DOCUMENT_LANGUAGES = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    dir: 'ltr',
  },
  he: {
    code: 'he',
    name: 'Hebrew',
    nativeName: 'עברית',
    dir: 'rtl',
  },
  ar: {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    dir: 'rtl',
  },
  fr: {
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    dir: 'ltr',
  },
  de: {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    dir: 'ltr',
  },
  it: {
    code: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    dir: 'ltr',
  },
};

export const DOCUMENT_LANGUAGE_ORDER = ['en', 'he', 'ar', 'fr', 'de', 'it'];

const HEBREW_RE = /[\u0590-\u05FF]/gu;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/gu;
const LATIN_RE = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žßŒœÆæ]/gu;
const HEBREW_SCRIPT_RE = /[\u0590-\u05FF]/u;
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u;
const LATIN_SCRIPT_RE = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žßŒœÆæ]/u;
const FRENCH_HINT_RE = /\b(le|la|les|des|une|un|avec|pour|dans|sur|est|et)\b/giu;
const GERMAN_HINT_RE = /\b(der|die|das|und|mit|nicht|für|ein|eine|von|auf)\b/giu;
const ITALIAN_HINT_RE = /\b(il|lo|la|gli|le|una|uno|con|per|che|del|della|dei)\b/giu;
const ENGLISH_HINT_RE = /\b(the|and|for|with|this|that|from|your|you|page|document)\b/giu;
const FRENCH_ACCENT_RE = /[àâæçéèêëîïôœùûüÿ]/giu;
const GERMAN_ACCENT_RE = /[äöüß]/giu;
const ITALIAN_ACCENT_RE = /[àèéìíîòóùú]/giu;

export function isSupportedDocumentLanguage(code) {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_LANGUAGES, String(code || '').trim().toLowerCase());
}

export function normalizeDocumentLanguageCode(code, fallback = 'en') {
  const normalized = String(code || '').trim().toLowerCase();
  return isSupportedDocumentLanguage(normalized) ? normalized : fallback;
}

export function getDocumentLanguage(code) {
  return DOCUMENT_LANGUAGES[normalizeDocumentLanguageCode(code)] || DOCUMENT_LANGUAGES.en;
}

export function documentLanguageDirection(code) {
  return getDocumentLanguage(code).dir;
}

export function shouldMirrorByDefault(sourceCode, targetCode) {
  return documentLanguageDirection(sourceCode) !== documentLanguageDirection(targetCode);
}

function countMatches(pattern, text) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

export function containsSourceScript(text, sourceCode) {
  const normalized = normalizeDocumentLanguageCode(sourceCode);
  if (normalized === 'he') {
    return HEBREW_SCRIPT_RE.test(String(text || ''));
  }
  if (normalized === 'ar') {
    return ARABIC_SCRIPT_RE.test(String(text || ''));
  }
  return LATIN_SCRIPT_RE.test(String(text || ''));
}

export function detectDocumentLanguage(text) {
  const sample = String(text || '').trim();
  if (!sample) {
    return {
      code: 'en',
      name: DOCUMENT_LANGUAGES.en.name,
      confidence: 0,
      reason: 'empty_text',
    };
  }

  const hebrewCount = countMatches(HEBREW_RE, sample);
  const arabicCount = countMatches(ARABIC_RE, sample);
  if (hebrewCount >= Math.max(3, arabicCount + 1)) {
    return {
      code: 'he',
      name: DOCUMENT_LANGUAGES.he.name,
      confidence: Math.min(1, hebrewCount / Math.max(10, sample.length * 0.08)),
      reason: 'hebrew_script',
    };
  }
  if (arabicCount >= Math.max(3, hebrewCount + 1)) {
    return {
      code: 'ar',
      name: DOCUMENT_LANGUAGES.ar.name,
      confidence: Math.min(1, arabicCount / Math.max(10, sample.length * 0.08)),
      reason: 'arabic_script',
    };
  }

  const latinCount = countMatches(LATIN_RE, sample);
  const lower = sample.toLowerCase();
  const scores = {
    fr: 0,
    de: 0,
    it: 0,
    en: 0.5,
  };
  if (latinCount > 0) {
    scores.fr += countMatches(FRENCH_HINT_RE, lower) * 2;
    scores.fr += countMatches(FRENCH_ACCENT_RE, lower) * 3;
    scores.de += countMatches(GERMAN_HINT_RE, lower) * 2;
    scores.de += countMatches(GERMAN_ACCENT_RE, lower) * 3;
    scores.it += countMatches(ITALIAN_HINT_RE, lower) * 2;
    scores.it += countMatches(ITALIAN_ACCENT_RE, lower) * 2;
    scores.en += countMatches(ENGLISH_HINT_RE, lower) * 2;
  }

  let bestCode = 'en';
  let bestScore = scores.en;
  for (const code of ['fr', 'de', 'it']) {
    if (scores[code] > bestScore) {
      bestCode = code;
      bestScore = scores[code];
    }
  }
  const confidence = latinCount > 0
    ? Math.max(0.35, Math.min(1, (bestScore + 1) / Math.max(3, latinCount * 0.12)))
    : 0.35;
  return {
    code: bestCode,
    name: DOCUMENT_LANGUAGES[bestCode].name,
    confidence,
    reason: bestCode === 'en' ? 'latin_fallback' : `${bestCode}_lexical`,
  };
}
