const textMeasureCanvas = typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(1, 1)
  : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
const textMeasureCtx = textMeasureCanvas ? textMeasureCanvas.getContext('2d') : null;

function charWidthFactor(char) {
  if (/\s/u.test(char)) {
    return 0.33;
  }
  if ('ilI|'.includes(char)) {
    return 0.3;
  }
  if ('mwMW'.includes(char)) {
    return 0.78;
  }
  if (/\d/u.test(char)) {
    return 0.55;
  }
  if (`.,;:!?"'()[]{}-_/\\`.includes(char)) {
    return 0.3;
  }
  if ((char.codePointAt(0) || 0) >= 0x2e80) {
    return 1.0;
  }
  return 0.56;
}

export function measureLinePt(text, fontSize, fontWeight = 'normal') {
  const content = String(text || '');
  if (textMeasureCtx) {
    const weight = String(fontWeight || 'normal') === 'bold' ? '700' : '400';
    textMeasureCtx.font = `${weight} ${fontSize}px LingadooPreview, sans-serif`;
    return textMeasureCtx.measureText(content).width;
  }
  let total = 0;
  for (const char of content) {
    total += charWidthFactor(char) * fontSize;
  }
  return total;
}

function breakLongToken(token, maxWidth, fontSize, fontWeight) {
  if (!token) {
    return [token];
  }
  const chunks = [];
  let current = '';
  for (const char of token) {
    const candidate = `${current}${char}`;
    if (measureLinePt(candidate, fontSize, fontWeight) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = char;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export function splitExplicitLines(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  return lines.length > 0 ? lines : [String(text || '')];
}

function wrapParagraph(paragraph, maxWidth, fontSize, fontWeight) {
  const tokens = String(paragraph || '').split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) {
    return [''];
  }

  const lines = [];
  let current = '';
  for (const token of tokens) {
    if (measureLinePt(token, fontSize, fontWeight) > maxWidth) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (const chunk of breakLongToken(token, maxWidth, fontSize, fontWeight)) {
        if (measureLinePt(chunk, fontSize, fontWeight) > maxWidth) {
          lines.push(chunk);
          continue;
        }
        if (!current) {
          current = chunk;
          continue;
        }
        const candidate = `${current} ${chunk}`;
        if (measureLinePt(candidate, fontSize, fontWeight) <= maxWidth) {
          current = candidate;
        } else {
          lines.push(current);
          current = chunk;
        }
      }
      continue;
    }

    if (!current) {
      current = token;
      continue;
    }
    const candidate = `${current} ${token}`;
    if (measureLinePt(candidate, fontSize, fontWeight) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = token;
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

export function wrapTextToWidth(text, maxWidth, fontSize, fontWeight = 'normal') {
  const paragraphs = splitExplicitLines(text);
  const lines = [];
  for (const paragraph of paragraphs) {
    lines.push(...wrapParagraph(paragraph, maxWidth, fontSize, fontWeight));
  }
  return lines.length > 0 ? lines : [String(text || '')];
}

export function truncateLineToWidth(text, maxWidth, fontSize, fontWeight = 'normal') {
  const raw = String(text || '');
  if (measureLinePt(raw, fontSize, fontWeight) <= maxWidth) {
    return raw;
  }
  const ellipsis = '...';
  if (measureLinePt(ellipsis, fontSize, fontWeight) > maxWidth) {
    return '';
  }
  let trimmed = raw;
  while (trimmed.length > 0) {
    const candidate = `${trimmed}${ellipsis}`;
    if (measureLinePt(candidate, fontSize, fontWeight) <= maxWidth) {
      return candidate;
    }
    trimmed = trimmed.slice(0, -1);
  }
  return '';
}
