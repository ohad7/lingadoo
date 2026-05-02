import mupdf from 'mupdf';
import { prepareLineForPdfRender } from '../localEditorDrawPlan.js';
import { resolveJustifiedLineSpacing } from '../textJustification.js';
import { measureLinePt } from '../textLayoutMetrics.js';
import { isVerticalTextOrientation, resolveLogicalTextFrame } from '../textOrientation.js';

const TRANSLATED_TEXT_IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];
const DEFAULT_FONT_SIZE = 5.0;
const NOTO_SANS_REGULAR_URL = '/fonts/NotoSansMerged-Regular.ttf';
const NOTO_SANS_BOLD_URL = '/fonts/NotoSansMerged-Bold.ttf';
const NOTO_SANS_ITALIC_URL = '/fonts/NotoSans-Italic.ttf';
const NOTO_SANS_BOLD_ITALIC_URL = '/fonts/NotoSans-BoldItalic.ttf';

const fontBytesCache = new Map();
const fontObjectCache = new Map();

function normalizeUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new Error('expected ArrayBuffer or Uint8Array');
}

function rgb01FromColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/^#/, '');
    if (normalized.length === 6) {
      return [
        parseInt(normalized.slice(0, 2), 16) / 255,
        parseInt(normalized.slice(2, 4), 16) / 255,
        parseInt(normalized.slice(4, 6), 16) / 255,
      ];
    }
  }
  return [0, 0, 0];
}

async function fetchFontBytes(url) {
  const cacheKey = String(url);
  if (fontBytesCache.has(cacheKey)) {
    return fontBytesCache.get(cacheKey);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch font: ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  fontBytesCache.set(cacheKey, bytes);
  return bytes;
}

async function resolveFontResources() {
  const [regularData, boldData, italicData, boldItalicData] = await Promise.all([
    fetchFontBytes(NOTO_SANS_REGULAR_URL).catch(() => null),
    fetchFontBytes(NOTO_SANS_BOLD_URL).catch(() => null),
    fetchFontBytes(NOTO_SANS_ITALIC_URL).catch(() => null),
    fetchFontBytes(NOTO_SANS_BOLD_ITALIC_URL).catch(() => null),
  ]);
  return {
    regularData,
    boldData,
    italicData,
    boldItalicData,
  };
}

function resolvePdfOverlayFontSpec({ weight = 'normal', italic = false } = {}) {
  const normalizedWeight = String(weight) === 'bold' ? 'bold' : 'normal';
  if (normalizedWeight === 'bold' && italic) {
    return {
      cacheKey: 'browser-noto-bold-italic',
      fontName: 'PDEbrewBrowserPDFBoldItalic',
      builtinName: 'Helvetica-BoldOblique',
      dataKey: 'boldItalicData',
    };
  }
  if (normalizedWeight === 'bold') {
    return {
      cacheKey: 'browser-noto-bold',
      fontName: 'PDEbrewBrowserPDFBold',
      builtinName: 'Helvetica-Bold',
      dataKey: 'boldData',
    };
  }
  if (italic) {
    return {
      cacheKey: 'browser-noto-italic',
      fontName: 'PDEbrewBrowserPDFItalic',
      builtinName: 'Helvetica-Oblique',
      dataKey: 'italicData',
    };
  }
  return {
    cacheKey: 'browser-noto-regular',
    fontName: 'PDEbrewBrowserPDFRegular',
    builtinName: 'Helvetica',
    dataKey: 'regularData',
  };
}

function loadPdfFont(fontResources, { weight = 'normal', italic = false } = {}) {
  const spec = resolvePdfOverlayFontSpec({ weight, italic });
  if (fontObjectCache.has(spec.cacheKey)) {
    return fontObjectCache.get(spec.cacheKey);
  }
  let font = null;
  try {
    const fontData = fontResources?.[spec.dataKey] || null;
    font = fontData
      ? new mupdf.Font(spec.fontName, fontData)
      : new mupdf.Font(spec.builtinName);
  } catch {
    font = new mupdf.Font(spec.builtinName);
  }
  fontObjectCache.set(spec.cacheKey, font);
  return font;
}

function drawTableModelsToPdfDevice(device, tableModels) {
  for (const model of tableModels || []) {
    for (const cell of model.cells || []) {
      if (!cell.fill_enabled) {
        continue;
      }
      const bbox = Array.isArray(cell.render_bbox) ? cell.render_bbox : cell.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4) {
        continue;
      }
      const pathObject = new mupdf.Path();
      try {
        pathObject.rect(
          Number(bbox[0]),
          Number(bbox[1]),
          Number(bbox[2]),
          Number(bbox[3]),
        );
        device.fillPath(
          pathObject,
          false,
          TRANSLATED_TEXT_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          rgb01FromColor(cell.fill_color),
          1,
        );
      } finally {
        pathObject.destroy?.();
      }
    }
  }
  for (const model of tableModels || []) {
    for (const border of model.borders || []) {
      const start = Array.isArray(border.start) ? border.start : null;
      const end = Array.isArray(border.end) ? border.end : null;
      if (!start || !end || start.length < 2 || end.length < 2) {
        continue;
      }
      const pathObject = new mupdf.Path();
      const strokeState = new mupdf.StrokeState({
        lineCap: 'Butt',
        lineJoin: 'Miter',
        lineWidth: Number(border.width) || 0.6,
        miterLimit: 10,
      });
      try {
        pathObject.moveTo(Number(start[0]), Number(start[1]));
        pathObject.lineTo(Number(end[0]), Number(end[1]));
        device.strokePath(
          pathObject,
          strokeState,
          TRANSLATED_TEXT_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          rgb01FromColor(border.color),
          1,
        );
      } finally {
        strokeState.destroy?.();
        pathObject.destroy?.();
      }
    }
  }
}

function buildHorizontalPdfTextMatrix({ x, baseline, fontSize }) {
  return [fontSize, 0, 0, -fontSize, x, baseline];
}

function buildVerticalPdfTextMatrix({
  textRotationDeg,
  fontSize,
  offsetX,
  offsetY,
  blockWidth,
  blockHeight,
  line,
}) {
  if (textRotationDeg === -90) {
    return [
      0,
      -fontSize,
      -fontSize,
      0,
      offsetX + (Number(line?.baseline_pt ?? line?.baseline ?? fontSize) || fontSize),
      offsetY + blockHeight - (Number(line?.x_pt ?? line?.x ?? 0) || 0),
    ];
  }
  return [
    0,
    fontSize,
    fontSize,
    0,
    offsetX + blockWidth - (Number(line?.baseline_pt ?? line?.baseline ?? fontSize) || fontSize),
    offsetY + (Number(line?.x_pt ?? line?.x ?? 0) || 0),
  ];
}

function drawPdfTextRun(device, {
  font,
  text,
  textMatrix,
  color,
  fauxBold = false,
  strokeWidth = 0.02,
}) {
  const textObject = new mupdf.Text();
  try {
    textObject.showString(font, textMatrix, text, 0);
    device.fillText(
      textObject,
      TRANSLATED_TEXT_IDENTITY_MATRIX,
      mupdf.ColorSpace.DeviceRGB,
      color,
      1,
    );
    if (fauxBold) {
      const strokeState = new mupdf.StrokeState({
        lineCap: 'Butt',
        lineJoin: 'Miter',
        lineWidth: strokeWidth,
        miterLimit: 10,
      });
      try {
        device.strokeText(
          textObject,
          strokeState,
          TRANSLATED_TEXT_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          color,
          1,
        );
      } finally {
        strokeState.destroy?.();
      }
    }
  } finally {
    textObject.destroy?.();
  }
}

function drawJustifiedHorizontalPdfLine(device, {
  font,
  lineText,
  xPt,
  baselinePt,
  targetWidthPt,
  fontSize,
  effectiveWeight,
  color,
  fauxBold,
  strokeWidth,
}) {
  const words = String(lineText || '').split(/\s+/u).filter(Boolean);
  if (words.length <= 1) {
    drawPdfTextRun(device, {
      font,
      text: lineText,
      textMatrix: buildHorizontalPdfTextMatrix({ x: xPt, baseline: baselinePt, fontSize }),
      color,
      fauxBold,
      strokeWidth,
    });
    return;
  }
  const wordWidths = words.map((word) => measureLinePt(word, fontSize, effectiveWeight));
  const { gapCount, fullGapWidthPt: gapWidth } = resolveJustifiedLineSpacing(lineText, {
    targetWidthPt,
    fontSize,
    fontWeight: effectiveWeight,
  });
  let cursorX = xPt;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    drawPdfTextRun(device, {
      font,
      text: word,
      textMatrix: buildHorizontalPdfTextMatrix({ x: cursorX, baseline: baselinePt, fontSize }),
      color,
      fauxBold,
      strokeWidth,
    });
    cursorX += wordWidths[index];
    if (index < gapCount) {
      cursorX += gapWidth;
    }
  }
}

function drawTranslatedBlocksToPdfDevice(device, blocks, fontResources) {
  for (const block of blocks || []) {
    const drawPlan = block?.draw_plan && typeof block.draw_plan === 'object'
      ? block.draw_plan
      : (block?.drawPlan && typeof block.drawPlan === 'object' ? block.drawPlan : null);
    const lines = Array.isArray(drawPlan?.lines) ? drawPlan.lines : [];
    if (!lines.length) {
      continue;
    }
    const fontSize = Number(drawPlan?.font_size) || Number(block.font_size) || DEFAULT_FONT_SIZE;
    const effectiveWeight = String(block.effective_font_weight || block.font_weight || drawPlan?.font_weight || 'normal') === 'bold'
      ? 'bold'
      : 'normal';
    const fauxBold = Boolean(block.faux_bold_policy === 'stroke' || drawPlan?.faux_bold);
    const strokeWidth = Number(block.stroke_width ?? drawPlan?.stroke_width) || 0.02;
    const color = rgb01FromColor(block.text_color || '#122333');
    const bbox = Array.isArray(block.bbox) ? block.bbox : [0, 0, 0, 0];
    const offsetX = Number(bbox[0]) || 0;
    const offsetY = Number(bbox[1]) || 0;
    const blockWidth = Math.max(0, (Number(bbox[2]) || 0) - offsetX);
    const blockHeight = Math.max(0, (Number(bbox[3]) || 0) - offsetY);
    const textOrientation = String(drawPlan?.text_orientation || block.source_text_orientation || 'horizontal');
    const textRotationDeg = Number(block?.text_rotation_deg || 0);
    const textFrame = resolveLogicalTextFrame(bbox, {
      orientation: textOrientation,
      paddingPt: Number(drawPlan?.text_padding_pt ?? (isVerticalTextOrientation(textOrientation) ? 0 : 1)),
    });
    const alignment = String(block.alignment || 'left').toLowerCase();
    if (Boolean(block.background_fill_enabled) && Array.isArray(block.background_fill_color) && bbox.length === 4) {
      const pathObject = new mupdf.Path();
      try {
        pathObject.rect(
          Number(bbox[0]),
          Number(bbox[1]),
          Number(bbox[2]),
          Number(bbox[3]),
        );
        device.fillPath(
          pathObject,
          false,
          TRANSLATED_TEXT_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          rgb01FromColor(block.background_fill_color),
          1,
        );
      } finally {
        pathObject.destroy?.();
      }
    }
    const font = loadPdfFont(fontResources, {
      weight: effectiveWeight,
      italic: String(block.font_family || '').toLowerCase().includes('italic'),
    });

    for (const line of lines) {
      const sourceText = String(line?.text || '');
      if (!sourceText) {
        continue;
      }
      const text = prepareLineForPdfRender(sourceText);
      const xPt = offsetX + (Number(line?.x_pt ?? line?.x ?? 0));
      const baselinePt = offsetY + (Number(line?.baseline_pt ?? line?.baseline ?? 0));
      if (!isVerticalTextOrientation(textOrientation) && alignment === 'justify' && line !== lines[lines.length - 1]) {
        drawJustifiedHorizontalPdfLine(device, {
          font,
          lineText: text,
          xPt,
          baselinePt,
          targetWidthPt: textFrame.contentWidth,
          fontSize,
          effectiveWeight,
          color,
          fauxBold,
          strokeWidth,
        });
        continue;
      }
      const textMatrix = isVerticalTextOrientation(textOrientation)
        ? buildVerticalPdfTextMatrix({
            textRotationDeg,
            fontSize,
            offsetX,
            offsetY,
            blockWidth,
            blockHeight,
            line,
          })
        : buildHorizontalPdfTextMatrix({ x: xPt, baseline: baselinePt, fontSize });
      drawPdfTextRun(device, {
        font,
        text,
        textMatrix,
        color,
        fauxBold,
        strokeWidth,
      });
    }
  }
}

export async function exportEditedPdfFromPageState({
  pages,
} = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('pages are required for PDF export');
  }
  const fontResources = await resolveFontResources();
  const outputBuffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(outputBuffer, 'pdf', '');
  try {
    for (const page of pages) {
      const widthPt = Number(page?.page_size_pt?.[0] || page?.widthPt || 0);
      const heightPt = Number(page?.page_size_pt?.[1] || page?.heightPt || 0);
      if (!(widthPt > 0 && heightPt > 0)) {
        throw new Error(`invalid page size for page ${String(page?.page_id || page?.pageId || '?')}`);
      }
      const pageDevice = writer.beginPage([0, 0, widthPt, heightPt]);
      try {
        const image = new mupdf.Image(normalizeUint8Array(page.previewPngBytes));
        try {
          pageDevice.fillImage(
            image,
            [widthPt, 0, 0, heightPt, 0, 0],
            1,
          );
        } finally {
          image.destroy?.();
        }
        drawTableModelsToPdfDevice(pageDevice, page.tables || []);
        drawTranslatedBlocksToPdfDevice(pageDevice, page.blocks || [], fontResources);
      } finally {
        pageDevice.close?.();
        writer.endPage();
      }
    }
    writer.close();
    return outputBuffer.asUint8Array().slice();
  } finally {
    writer.destroy?.();
  }
}
