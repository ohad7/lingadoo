/**
 * Feature extraction for sentence continuation detection.
 *
 * Extracts a numeric feature vector from a pair of text blocks.
 * Shared between the training pipeline and the runtime scorer.
 */

// --- Text analysis constants (mirrored from sentenceContinuationDetector.js) ---

const TERMINAL_PUNCTUATION_RE = /[.!?:;]\s*$/;
const BULLET_NUMBER_RE = /^\s*(\d+[.)]\s|[-•●■]\s|[א-ת][.)]\s|סעיף\s)/;
const HEBREW_CHAR_RE = /[\u0590-\u05FF]/;

const DANGLING_PREPOSITIONS = [
  'בגין', 'של', 'על', 'עם', 'אל', 'עבור', 'לפי', 'כגון', 'כמו',
  'ללא', 'בין', 'תוך', 'מתוך', 'לפני', 'אחרי', 'בתוך',
];

const SINGLE_LETTER_PREFIXES = ['ב', 'ל', 'מ', 'ש', 'ו', 'ה', 'כ'];

const SHORT_FRAGMENT_WORD_LIMIT = 5;

// --- Text analysis helpers ---

function endsWithTerminalPunctuation(text) {
  return TERMINAL_PUNCTUATION_RE.test(text);
}

function startsWithBulletOrNumber(text) {
  return BULLET_NUMBER_RE.test(text);
}

function endsWithDanglingPreposition(text) {
  const trimmed = text.trim();
  for (const prep of DANGLING_PREPOSITIONS) {
    if (trimmed.endsWith(prep)) {
      const idx = trimmed.length - prep.length;
      if (idx === 0 || /\s/.test(trimmed[idx - 1])) {
        return true;
      }
    }
  }
  return false;
}

function endsWithSingleLetterPrefix(text) {
  const trimmed = text.trim();
  const lastWord = trimmed.split(/\s+/).pop() || '';
  return SINGLE_LETTER_PREFIXES.includes(lastWord) && HEBREW_CHAR_RE.test(lastWord);
}

function hasUnmatchedOpen(text) {
  const pairs = [['(', ')'], ['[', ']'], ['"', '"'], ['״', '״']];
  for (const [open, close] of pairs) {
    let count = 0;
    for (const ch of text) {
      if (ch === open) count++;
      if (ch === close) count--;
    }
    if (count > 0) return true;
  }
  return false;
}

function isShortFragment(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length < SHORT_FRAGMENT_WORD_LIMIT;
}

function containsHebrew(text) {
  return HEBREW_CHAR_RE.test(text);
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// --- Geometry helpers ---

function rectHeight(bbox) {
  return Math.max(0, bbox[3] - bbox[1]);
}

function rectWidth(bbox) {
  return Math.max(0, bbox[2] - bbox[0]);
}

function sameRow(a, b) {
  const aH = rectHeight(a);
  const bH = rectHeight(b);
  const minH = Math.min(aH, bH);
  if (minH <= 0) return false;
  const overlap = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return (overlap / minH) >= 0.5;
}

function verticalGap(bboxA, bboxB) {
  const botA = Math.max(bboxA[1], bboxA[3]);
  const topB = Math.min(bboxB[1], bboxB[3]);
  const botB = Math.max(bboxB[1], bboxB[3]);
  const topA = Math.min(bboxA[1], bboxA[3]);
  if (botA <= topB) return topB - botA;
  if (botB <= topA) return topA - botB;
  return 0;
}

function horizontalGap(bboxA, bboxB) {
  const gap1 = bboxA[0] - bboxB[2];
  const gap2 = bboxB[0] - bboxA[2];
  if (gap1 >= 0) return gap1;
  if (gap2 >= 0) return gap2;
  return 0;
}

// --- Feature names and extraction ---

export const FEATURE_NAMES = [
  'ends_terminal_punct',
  'starts_bullet',
  'dangling_preposition',
  'single_letter_prefix',
  'unmatched_open',
  'short_b',
  'short_a',
  'both_short',
  'font_size_ratio',
  'vertical_gap_norm',
  'horizontal_gap_norm',
  'same_row',
  'bbox_width_ratio',
  'both_hebrew',
  'a_word_count',
  'b_word_count',
];

/**
 * Extract a numeric feature vector from a pair of blocks.
 *
 * @param {Object} a - First block (upper / right in reading order)
 * @param {Object} b - Second block (lower / left in reading order)
 * @returns {number[]} Feature vector of length FEATURE_NAMES.length
 */
export function extractFeatures(a, b) {
  const textA = String(a.source_text || '').trim();
  const textB = String(b.source_text || '').trim();

  const fsA = Number(a.source_font_size) || Number(a.font_size) || 10;
  const fsB = Number(b.source_font_size) || Number(b.font_size) || 10;
  const minFS = Math.min(fsA, fsB);
  const fontSizeRatio = minFS > 0 ? Math.max(fsA, fsB) / minFS - 1 : 0;

  const maxH = Math.max(rectHeight(a.bbox), rectHeight(b.bbox));
  const vGapNorm = maxH > 0 ? verticalGap(a.bbox, b.bbox) / maxH : 0;

  const onSameRow = sameRow(a.bbox, b.bbox);
  const maxW = Math.max(rectWidth(a.bbox), rectWidth(b.bbox));
  const hGapNorm = (onSameRow && maxW > 0) ? horizontalGap(a.bbox, b.bbox) / maxW : 0;

  const wA = rectWidth(a.bbox);
  const wB = rectWidth(b.bbox);
  const minW = Math.min(wA, wB);
  const bboxWidthRatio = minW > 0 ? Math.max(wA, wB) / minW - 1 : 0;

  const shortA = isShortFragment(textA);
  const shortB = isShortFragment(textB);

  return [
    endsWithTerminalPunctuation(textA) ? 1 : 0,
    startsWithBulletOrNumber(textB) ? 1 : 0,
    endsWithDanglingPreposition(textA) ? 1 : 0,
    endsWithSingleLetterPrefix(textA) ? 1 : 0,
    hasUnmatchedOpen(textA) ? 1 : 0,
    shortB ? 1 : 0,
    shortA ? 1 : 0,
    (shortA && shortB) ? 1 : 0,
    fontSizeRatio,
    vGapNorm,
    hGapNorm,
    onSameRow ? 1 : 0,
    bboxWidthRatio,
    (containsHebrew(textA) && containsHebrew(textB)) ? 1 : 0,
    wordCount(textA),
    wordCount(textB),
  ];
}
