function safeBbox(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const x0 = Number(entry.x0);
  const y0 = Number(entry.y0);
  const x1 = Number(entry.x1);
  const y1 = Number(entry.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1, y1];
}

export function inflateOcrBBox(bbox, {
  paddingX = 0,
  paddingY = null,
  maxWidth = Number.POSITIVE_INFINITY,
  maxHeight = Number.POSITIVE_INFINITY,
} = {}) {
  const safe = Array.isArray(bbox) && bbox.length >= 4
    ? bbox.slice(0, 4).map((value) => Number(value))
    : null;
  if (!safe || !safe.every(Number.isFinite) || safe[2] <= safe[0] || safe[3] <= safe[1]) {
    return null;
  }
  const resolvedPaddingX = Math.max(0, Number(paddingX) || 0);
  const resolvedPaddingY = Math.max(0, Number(paddingY ?? paddingX) || 0);
  return [
    Math.max(0, safe[0] - resolvedPaddingX),
    Math.max(0, safe[1] - resolvedPaddingY),
    Math.min(Number.isFinite(maxWidth) ? maxWidth : Number.POSITIVE_INFINITY, safe[2] + resolvedPaddingX),
    Math.min(Number.isFinite(maxHeight) ? maxHeight : Number.POSITIVE_INFINITY, safe[3] + resolvedPaddingY),
  ];
}

const APP_LANGUAGE_TO_TESSERACT = {
  ar: 'ara',
  de: 'deu',
  en: 'eng',
  es: 'spa',
  fr: 'fra',
  he: 'heb',
  it: 'ita',
  nl: 'nld',
  pt: 'por',
  ru: 'rus',
};

export function resolveTesseractLanguageSpec(sourceLanguageCode = '', targetLanguageCode = '') {
  const primary = APP_LANGUAGE_TO_TESSERACT[String(sourceLanguageCode || '').trim().toLowerCase()] || 'eng';
  const secondary = APP_LANGUAGE_TO_TESSERACT[String(targetLanguageCode || '').trim().toLowerCase()] || '';
  const languages = [];
  languages.push(primary);
  if (primary !== 'eng') {
    languages.push('eng');
  }
  if (secondary && !languages.includes(secondary)) {
    languages.push(secondary);
  }
  return {
    primary,
    languages,
    spec: languages.join('+'),
  };
}

export function normalizeTesseractProgressMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const rawStatus = String(message.status || '').trim();
  const rawProgress = Number(message.progress);
  return {
    status: rawStatus || 'processing',
    progress: Number.isFinite(rawProgress)
      ? Math.min(1, Math.max(0, rawProgress))
      : null,
  };
}

function pushBox(boxes, entry) {
  const bbox = safeBbox(entry?.bbox);
  const text = String(entry?.text || '').trim();
  if (!bbox || !text) return;
  boxes.push({
    text,
    bbox,
    confidence: Number.isFinite(Number(entry?.confidence)) ? Number(entry.confidence) : null,
  });
}

function sortBoxes(boxes) {
  boxes.sort((left, right) => {
    const topDelta = left.bbox[1] - right.bbox[1];
    if (Math.abs(topDelta) > 0.5) return topDelta;
    return left.bbox[0] - right.bbox[0];
  });
  return boxes;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wordCharWidth(word) {
  const text = String(word?.text || '').trim();
  const bbox = safeBbox(word?.bbox);
  if (!bbox || !text) return null;
  const charCount = Math.max(1, text.replace(/\s+/g, '').length);
  return (bbox[2] - bbox[0]) / charCount;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function detectDominantTextDirection(words) {
  let rtlCount = 0;
  let ltrCount = 0;
  for (const word of words) {
    const text = String(word?.text || '');
    const rtlMatches = text.match(/[\u0590-\u08FF]/g);
    const ltrMatches = text.match(/[A-Za-z]/g);
    rtlCount += rtlMatches ? rtlMatches.length : 0;
    ltrCount += ltrMatches ? ltrMatches.length : 0;
  }
  return rtlCount > ltrCount ? 'rtl' : 'ltr';
}

function verticalOverlapRatio(leftBbox, rightBbox) {
  const overlapTop = Math.max(leftBbox[1], rightBbox[1]);
  const overlapBottom = Math.min(leftBbox[3], rightBbox[3]);
  const overlap = Math.max(0, overlapBottom - overlapTop);
  const minHeight = Math.max(1, Math.min(leftBbox[3] - leftBbox[1], rightBbox[3] - rightBbox[1]));
  return overlap / minHeight;
}

function mergeWordGroup(words) {
  const ordered = [...words].sort((left, right) => {
    const leftBbox = safeBbox(left?.bbox);
    const rightBbox = safeBbox(right?.bbox);
    if (!leftBbox || !rightBbox) return 0;
    return leftBbox[0] - rightBbox[0];
  });
  const firstBbox = safeBbox(ordered[0]?.bbox);
  if (!firstBbox) return null;
  let x0 = firstBbox[0];
  let y0 = firstBbox[1];
  let x1 = firstBbox[2];
  let y1 = firstBbox[3];
  const confidences = [];
  const texts = [];
  for (const word of ordered) {
    const bbox = safeBbox(word?.bbox);
    const text = String(word?.text || '').trim();
    if (!bbox || !text) continue;
    x0 = Math.min(x0, bbox[0]);
    y0 = Math.min(y0, bbox[1]);
    x1 = Math.max(x1, bbox[2]);
    y1 = Math.max(y1, bbox[3]);
    texts.push(text);
    if (Number.isFinite(Number(word?.confidence))) {
      confidences.push(Number(word.confidence));
    }
  }
  if (!texts.length) return null;
  const direction = detectDominantTextDirection(ordered);
  const confidence = confidences.length
    ? (confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    : null;
  return {
    text: (direction === 'rtl' ? [...texts].reverse() : texts).join(' '),
    bbox: [x0, y0, x1, y1],
    confidence,
  };
}

function pushGroupedLineBoxes(groupedBoxes, line) {
  const words = Array.isArray(line?.words) ? line.words : [];
  if (!words.length) return;
  const validWords = words
    .map((word) => ({
      text: String(word?.text || '').trim(),
      confidence: Number.isFinite(Number(word?.confidence)) ? Number(word.confidence) : null,
      bbox: safeBbox(word?.bbox),
      raw: word,
    }))
    .filter((word) => word.bbox && word.text);
  if (!validWords.length) return;
  if (validWords.length === 1) {
    groupedBoxes.push({
      text: validWords[0].text,
      confidence: validWords[0].confidence,
      bbox: validWords[0].bbox,
    });
    return;
  }
  validWords.sort((left, right) => left.bbox[0] - right.bbox[0]);
  const heights = validWords.map((word) => word.bbox[3] - word.bbox[1]).filter((value) => Number.isFinite(value) && value > 0);
  const charWidths = validWords.map((word) => wordCharWidth(word.raw)).filter((value) => Number.isFinite(value) && value > 0);
  const medianHeight = median(heights) || 10;
  const medianCharWidth = median(charWidths) || Math.max(1, medianHeight * 0.45);
  const maxGap = clamp(Math.max(medianCharWidth * 2.5, medianHeight * 0.35), 4, 14);
  const groups = [[validWords[0]]];
  for (let index = 1; index < validWords.length; index += 1) {
    const nextWord = validWords[index];
    const currentGroup = groups[groups.length - 1];
    const prevWord = currentGroup[currentGroup.length - 1];
    const horizontalGap = nextWord.bbox[0] - prevWord.bbox[2];
    const overlapRatio = verticalOverlapRatio(prevWord.bbox, nextWord.bbox);
    if (horizontalGap <= maxGap && overlapRatio >= 0.65) {
      currentGroup.push(nextWord);
    } else {
      groups.push([nextWord]);
    }
  }
  for (const group of groups) {
    const merged = mergeWordGroup(group.map((entry) => entry.raw));
    if (merged) {
      groupedBoxes.push(merged);
    }
  }
}

export function extractTesseractBoxesByGranularity(pageData) {
  const buckets = {
    block: [],
    line: [],
    grouped: [],
    word: [],
  };
  const blocks = Array.isArray(pageData?.blocks) ? pageData.blocks : [];
  for (const block of blocks) {
    pushBox(buckets.block, block);
    const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
    for (const paragraph of paragraphs) {
      const lines = Array.isArray(paragraph?.lines) ? paragraph.lines : [];
      for (const line of lines) {
        pushBox(buckets.line, line);
        pushGroupedLineBoxes(buckets.grouped, line);
        const words = Array.isArray(line?.words) ? line.words : [];
        for (const word of words) {
          pushBox(buckets.word, word);
        }
      }
    }
  }
  return {
    block: sortBoxes(buckets.block),
    line: sortBoxes(buckets.line),
    grouped: sortBoxes(buckets.grouped),
    word: sortBoxes(buckets.word),
  };
}

export function extractTesseractLineBoxes(pageData) {
  return extractTesseractBoxesByGranularity(pageData).line;
}

export function extractTesseractWordBoxes(pageData) {
  return extractTesseractBoxesByGranularity(pageData).word;
}
