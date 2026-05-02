import { createCanvas } from '@napi-rs/canvas';
import mupdf from 'mupdf';

import {
  normalizeFauxBoldPolicy,
  resolveFauxBoldStrokeWidth,
  shouldApplyFauxBold,
} from './fontWeightPolicy.js';
import { MIRRORED_TEXT_PADDING_PT, prepareLineForRender } from './mirrorRenderPlan.js';

const RTL_PATTERN = /[\u0590-\u08FF]/u;
const COMPACT_LABEL_REPLACEMENTS = [
  [/\bmanagement\b/giu, 'mgmt'],
  [/\binvestment\b/giu, 'inv.'],
  [/\baccount\b/giu, 'acct.'],
  [/\bemployer\b/giu, 'empl.'],
  [/\bemployee\b/giu, 'emp.'],
  [/\bcompensation\b/giu, 'comp.'],
  [/\bbenefits\b/giu, 'ben.'],
  [/\breporting\b/giu, 'rpt.'],
  [/\bperiod\b/giu, 'prd.'],
  [/\bbalance\b/giu, 'bal.'],
  [/\bamount\b/giu, 'amt.'],
  [/\bdeposits\b/giu, 'deps.'],
  [/\bdeposit\b/giu, 'dep.'],
  [/\bnumber\b/giu, 'no.'],
  [/\baverage\b/giu, 'avg.'],
];

function rectWidth(bbox) {
  return Math.max(0, bbox[2] - bbox[0]);
}

function rectHeight(bbox) {
  return Math.max(0, bbox[3] - bbox[1]);
}

function ptRectToPx(bbox, scaleX, scaleY) {
  return [
    bbox[0] * scaleX,
    bbox[1] * scaleY,
    bbox[2] * scaleX,
    bbox[3] * scaleY,
  ];
}

function renderScaleMetrics(plan, widthPx, heightPx) {
  const scaleX = widthPx / Math.max(1, plan.page_size_pt[0]);
  const scaleY = heightPx / Math.max(1, plan.page_size_pt[1]);
  const fontScale = (scaleX + scaleY) / 2;
  return {
    scaleX,
    scaleY,
    fontScale,
  };
}

function fontDescriptor(text, fonts, fontScale, fontSize = text.font_size) {
  const family = text.weight === 'bold' ? fonts.boldFamily : fonts.regularFamily;
  const stylePrefix = text.italic ? 'italic ' : '';
  const weightPrefix = text.weight === 'bold' ? 'bold ' : '';
  return `${stylePrefix}${weightPrefix}${Math.max(1, fontSize * fontScale)}px "${family}"`;
}

const MUPDF_FONT_CACHE = new Map();

function resolveMuPdfFontSource(fonts, weight) {
  if (weight === 'bold') {
    return fonts.boldFontFile || fonts.regularFontFile || null;
  }
  return fonts.regularFontFile || fonts.boldFontFile || null;
}

function loadMuPdfFont(fonts, weight) {
  const fontFile = resolveMuPdfFontSource(fonts, weight);
  const cacheKey = `${weight}:${fontFile || 'builtin'}`;
  if (MUPDF_FONT_CACHE.has(cacheKey)) {
    return MUPDF_FONT_CACHE.get(cacheKey);
  }

  let font = null;
  try {
    if (fontFile) {
      font = new mupdf.Font(`PDEbrewMeasure-${weight}`, fontFile);
    } else {
      font = new mupdf.Font(weight === 'bold' ? 'Helvetica-Bold' : 'Helvetica');
    }
  } catch {
    try {
      font = new mupdf.Font(weight === 'bold' ? 'Helvetica-Bold' : 'Helvetica');
    } catch {
      font = null;
    }
  }

  if (font) {
    MUPDF_FONT_CACHE.set(cacheKey, font);
  }
  return font;
}

function measureLineWithMuPdf(fonts, text, line, fontSizePx) {
  const font = loadMuPdfFont(fonts, text.weight);
  if (!font) {
    return null;
  }
  let advance = 0;
  for (const character of String(line || '')) {
    const glyphId = font.encodeCharacter(character);
    advance += font.advanceGlyph(glyphId, 0);
  }
  return advance * fontSizePx;
}

function lineX(lineWidth, bboxPx, alignment, paddingPx) {
  const [x0, , x1] = bboxPx;
  const width = rectWidth(bboxPx);
  if (alignment === 'right') {
    return Math.max(x0 + paddingPx, x1 - lineWidth - paddingPx);
  }
  if (alignment === 'center') {
    return x0 + Math.max(0, (width - lineWidth) / 2);
  }
  return x0 + paddingPx;
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
}

function splitLines(value) {
  const normalized = normalizeNewlines(value);
  if (!normalized) {
    return [];
  }
  const lines = normalized.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function fontKey(text, fontSizePx) {
  return `${text.weight}|${text.italic ? 'italic' : 'normal'}|${fontSizePx}`;
}

function measureLine(ctx, cache, text, line, fontSizePx, fonts) {
  const key = `${fontKey(text, fontSizePx)}::${line}`;
  if (cache.has(key)) {
    return cache.get(key);
  }
  const mupdfWidth = measureLineWithMuPdf(fonts, text, line, fontSizePx);
  const width = mupdfWidth ?? (() => {
    ctx.font = fontDescriptor(text, fonts, 1, fontSizePx);
    return ctx.measureText(line).width;
  })();
  cache.set(key, width);
  return width;
}

function breakTokenToWidth(ctx, cache, text, token, maxWidthPx, fontSizePx, fonts) {
  if (!token) {
    return [''];
  }
  const chunks = [];
  let current = '';
  for (const character of token) {
    const candidate = `${current}${character}`;
    if (
      !current
      || measureLine(ctx, cache, text, candidate, fontSizePx, fonts) <= maxWidthPx
    ) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = character;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function wrapTextToWidth(ctx, cache, text, sourceText, maxWidthPx, fontSizePx, fonts) {
  const paragraphs = splitLines(sourceText);
  const effectiveParagraphs = paragraphs.length > 0 ? paragraphs : [String(sourceText || '')];
  const wrapped = [];
  for (const paragraph of effectiveParagraphs) {
    const words = String(paragraph || '').split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      wrapped.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      if (measureLine(ctx, cache, text, word, fontSizePx, fonts) > maxWidthPx) {
        if (current) {
          wrapped.push(current);
          current = '';
        }
        wrapped.push(...breakTokenToWidth(ctx, cache, text, word, maxWidthPx, fontSizePx, fonts));
        continue;
      }
      if (!current) {
        current = word;
        continue;
      }
      const candidate = `${current} ${word}`;
      if (measureLine(ctx, cache, text, candidate, fontSizePx, fonts) <= maxWidthPx) {
        current = candidate;
      } else {
        wrapped.push(current);
        current = word;
      }
    }
    if (current) {
      wrapped.push(current);
    }
  }
  return wrapped.length > 0 ? wrapped : [String(sourceText || '')];
}

function truncateLineToWidth(ctx, cache, text, line, maxWidthPx, fontSizePx, fonts) {
  if (measureLine(ctx, cache, text, line, fontSizePx, fonts) <= maxWidthPx) {
    return line;
  }
  const ellipsis = '...';
  if (measureLine(ctx, cache, text, ellipsis, fontSizePx, fonts) > maxWidthPx) {
    return '';
  }
  let trimmed = line;
  while (trimmed) {
    const candidate = `${trimmed}${ellipsis}`;
    if (measureLine(ctx, cache, text, candidate, fontSizePx, fonts) <= maxWidthPx) {
      return candidate;
    }
    trimmed = trimmed.slice(0, -1);
  }
  return '';
}

export function compactEnglishLabelText(text) {
  let compacted = String(text || '');
  for (const [pattern, replacement] of COMPACT_LABEL_REPLACEMENTS) {
    compacted = compacted.replace(pattern, replacement);
  }
  compacted = compacted.replace(/\bthe\b\s*/giu, '');
  compacted = compacted.replace(/\s+/gu, ' ').trim();
  return compacted;
}

export function shouldTryCompaction(text) {
  if (!text.overflow) {
    return false;
  }
  if (RTL_PATTERN.test(String(text.translated_text || ''))) {
    return false;
  }
  return String(text.translated_text || '').trim().length <= 96;
}

function linesFitBBox(ctx, cache, text, lines, bboxPx, fontSizePx, lineHeightPx, paddingPx, fonts) {
  const widthPx = Math.max(1, rectWidth(bboxPx) - (paddingPx * 2));
  const heightPx = Math.max(1, rectHeight(bboxPx) - (paddingPx * 2));
  if (lines.length === 0) {
    return true;
  }
  const maxLineWidth = Math.max(
    ...lines.map((line) => measureLine(ctx, cache, text, line, fontSizePx, fonts)),
  );
  const requiredHeight = fontSizePx + (Math.max(0, lines.length - 1) * lineHeightPx);
  return maxLineWidth <= widthPx + 1e-3 && requiredHeight <= heightPx + 1e-3;
}

export function fitMirroredTextPlan(text, {
  measureCtx,
  measureCache,
  bboxPx,
  fontScale,
  fonts,
  paddingPx = MIRRORED_TEXT_PADDING_PT * fontScale,
  minFontSize = 5.0,
  allowOverflowCompaction = true,
  allowOverflowClipping = true,
} = {}) {
  const normalizedText = normalizeNewlines(text.translated_text);
  let lines = normalizedText.includes('\n')
    ? normalizedText.split('\n')
    : [normalizedText];
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    lines = text.lines?.length ? [...text.lines] : [String(text.translated_text || '')];
  }

  const baseFontSize = Number(text.font_size) || 0;
  const baseLineHeight = Number(text.line_height) || 0;
  if (baseFontSize <= 0 || baseLineHeight <= 0) {
    return {
      lines,
      font_size: minFontSize,
      line_height: minFontSize,
      truncated: false,
    };
  }

  function fitLines(candidateLines) {
    let fontSize = baseFontSize;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const scale = fontSize / baseFontSize;
      const lineHeight = Math.max(1, baseLineHeight * scale);
      const fontSizePx = fontSize * fontScale;
      const lineHeightPx = lineHeight * fontScale;
      if (
        linesFitBBox(
          measureCtx,
          measureCache,
          text,
          candidateLines,
          bboxPx,
          fontSizePx,
          lineHeightPx,
          paddingPx,
          fonts,
        )
      ) {
        return {
          lines: candidateLines,
          font_size: fontSize,
          line_height: lineHeight,
          truncated: false,
        };
      }
      const nextFontSize = fontSize * 0.95;
      if (nextFontSize < minFontSize) {
        break;
      }
      fontSize = nextFontSize;
    }
    return null;
  }

  const fittedPlan = fitLines(lines);
  if (fittedPlan) {
    return fittedPlan;
  }

  if (!normalizedText.includes('\n') && (text.lines || []).length > 1) {
    const normalizedExistingLines = (text.lines || []).map((line) => String(line)).filter((line) => line.trim());
    if (normalizedExistingLines.length > 0) {
      const existingText = collapseWhitespace(normalizedExistingLines.join(' '));
      const candidateText = collapseWhitespace(normalizedText);
      if (existingText === candidateText) {
        const existingPlan = fitLines(normalizedExistingLines);
        if (existingPlan) {
          return existingPlan;
        }
      }
    }
  }

  if (allowOverflowCompaction && shouldTryCompaction(text)) {
    const compactText = compactEnglishLabelText(text.translated_text);
    if (compactText && compactText !== String(text.translated_text || '').trim()) {
      const widthPx = Math.max(1, rectWidth(bboxPx) - (paddingPx * 2));
      const compactLines = wrapTextToWidth(
        measureCtx,
        measureCache,
        text,
        compactText,
        widthPx,
        Math.max(minFontSize, Math.min(baseFontSize, 6.5)) * fontScale,
        fonts,
      );
      const compactPlan = fitLines(compactLines);
      if (compactPlan) {
        return compactPlan;
      }
    }
  }

  if (!allowOverflowClipping) {
    return {
      lines,
      font_size: baseFontSize,
      line_height: baseLineHeight,
      truncated: false,
    };
  }

  const fontSize = Math.min(baseFontSize, Math.max(0.1, minFontSize));
  const scale = fontSize / baseFontSize;
  const lineHeight = Math.max(1, baseLineHeight * scale);
  const availableHeightPx = Math.max(1, rectHeight(bboxPx) - (paddingPx * 2));
  let maxLines = Math.max(1, Math.floor((availableHeightPx - (fontSize * fontScale)) / (lineHeight * fontScale)) + 1);
  const maxWidthPx = Math.max(1, rectWidth(bboxPx) - (paddingPx * 2));
  let clippedInputLines = lines;
  if (clippedInputLines.length <= 1) {
    clippedInputLines = wrapTextToWidth(
      measureCtx,
      measureCache,
      text,
      text.translated_text,
      maxWidthPx,
      fontSize * fontScale,
      fonts,
    );
  }
  if (text.source_line_count_hint && text.source_line_count_hint > 0) {
    maxLines = Math.min(maxLines, text.source_line_count_hint);
  }
  const clippedLines = clippedInputLines.slice(0, maxLines);
  const droppedLines = clippedInputLines.length > maxLines;
  let truncated = droppedLines;
  if (clippedLines.length > 0 && droppedLines) {
    clippedLines[clippedLines.length - 1] = truncateLineToWidth(
      measureCtx,
      measureCache,
      text,
      `${clippedLines[clippedLines.length - 1]}...`,
      maxWidthPx,
      fontSize * fontScale,
      fonts,
    );
  }
  const normalizedLines = clippedLines.map((sourceLine) => {
    const normalized = truncateLineToWidth(
      measureCtx,
      measureCache,
      text,
      sourceLine,
      maxWidthPx,
      fontSize * fontScale,
      fonts,
    );
    if (normalized !== sourceLine) {
      truncated = true;
    }
    return normalized;
  });
  return {
    lines: normalizedLines,
    font_size: fontSize,
    line_height: lineHeight,
    truncated,
  };
}

export function collectMirroredTextDrawOperations(plan, fonts, {
  widthPx,
  heightPx,
  minFontSize = 5.0,
} = {}) {
  const { scaleX, scaleY, fontScale } = renderScaleMetrics(plan, widthPx, heightPx);
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext('2d');
  const measureCache = new Map();
  const masksBySourceBlockId = new Map(
    (plan.masks || []).map((mask) => [mask.source_block_id, mask]),
  );
  const fauxBoldPolicy = normalizeFauxBoldPolicy(plan.faux_bold_policy || 'semantic');

  return plan.texts.map((text) => {
    const bboxPx = ptRectToPx(text.bbox, scaleX, scaleY);
    const paddingPx = MIRRORED_TEXT_PADDING_PT * fontScale;
    const fittedPlan = fitMirroredTextPlan(text, {
      measureCtx,
      measureCache,
      bboxPx,
      fontScale,
      fonts,
      paddingPx,
      minFontSize,
      allowOverflowCompaction: text.allow_overflow_compaction !== false,
      allowOverflowClipping: text.allow_overflow_clipping !== false,
    });
    const fauxBold = shouldApplyFauxBold({
      renderMode: text.render_mode,
      fittedFontSize: fittedPlan.font_size,
      policy: fauxBoldPolicy,
    });
    const strokeWidth = resolveFauxBoldStrokeWidth({
      sourceStrokeWidth: text.stroke_width,
      fittedFontSize: fittedPlan.font_size,
    });
    const font = fontDescriptor(text, fonts, fontScale, fittedPlan.font_size);
    measureCtx.font = font;
    let baseline = bboxPx[1] + paddingPx + (fittedPlan.font_size * fontScale);
    const linePositions = [];
    const maxBaseline = bboxPx[3] - paddingPx + 1e-3;

    for (const line of fittedPlan.lines) {
      if (text.allow_overflow_clipping !== false && baseline > maxBaseline) {
        break;
      }
      const renderedLine = prepareLineForRender(line);
      const renderedLineWidth = measureLine(
        measureCtx,
        measureCache,
        text,
        renderedLine,
        fittedPlan.font_size * fontScale,
        fonts,
      );
      const x = lineX(renderedLineWidth, bboxPx, text.alignment, paddingPx);
      linePositions.push({
        source_text: line,
        text: renderedLine,
        x,
        baseline,
        x_pt: x / scaleX,
        baseline_pt: baseline / scaleY,
      });
      baseline += fittedPlan.line_height * fontScale;
    }

    return {
      block_id: text.block_id,
      source_block_id: text.source_block_id,
      block_type: text.block_type,
      style_id: text.style_id || null,
      source_bbox: masksBySourceBlockId.get(text.source_block_id)?.source_bbox || null,
      render_bbox: [...text.bbox],
      render_bbox_px: bboxPx,
      translated_text: text.translated_text,
      lines: [...fittedPlan.lines],
      font_size: fittedPlan.font_size,
      line_height: fittedPlan.line_height,
      truncated: Boolean(fittedPlan.truncated),
      allow_overflow_clipping: text.allow_overflow_clipping !== false,
      source_line_count_hint: text.source_line_count_hint ?? null,
      color: text.color,
      weight: text.weight,
      source_weight: text.source_weight || text.weight,
      italic: Boolean(text.italic),
      alignment: text.alignment,
      render_mode: text.render_mode || 0,
      faux_bold: fauxBold,
      stroke_width: strokeWidth,
      font_css: font,
      line_positions: linePositions,
    };
  });
}
