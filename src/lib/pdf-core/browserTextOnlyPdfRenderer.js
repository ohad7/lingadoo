import {
  collectStructuredTextLineElements,
  prepareDetectedTextElementsForAnnotation,
  validBBox,
} from './browserTextDetection.js';
import { mergeDetectedTextElementsHorizontally } from './detectedTextHorizontalMergeStage.js';
import {
  mergeDetectedTextElementsVertically,
} from './detectedTextVerticalMergeStage.js';
import {
  renderMirroredPagePixmapWithoutText,
  renderPagePixmapWithoutText,
} from './browserTextlessPageRenderer.js';
import { openMuPdfTwinDocument } from './pymupdfTwinAdapter.js';

const TEXT_DETECTION_BOX_COLORS = {
  'raw-detected': [0.18, 0.62, 0.25],
  'tight-separated': [0.53, 0.21, 0.69],
  'horizontal-merged': [0.17, 0.44, 0.83],
  'vertical-merged': [0.92, 0.49, 0.12],
};
const TEXT_DETECTION_BOX_STROKE_WIDTH = 0.6;
const TEXT_DETECTION_BOX_ALPHA = 0.9;
const PDF_DEVICE_IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];
const TEXTLESS_BACKGROUND_RENDER_DPI = 96;

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function bboxArea(bbox) {
  return Math.max(0, (Number(bbox?.[2]) || 0) - (Number(bbox?.[0]) || 0))
    * Math.max(0, (Number(bbox?.[3]) || 0) - (Number(bbox?.[1]) || 0));
}

function normalizeRect(value) {
  if (Array.isArray(value) && value.length >= 4) {
    return value.slice(0, 4).map((entry) => Number(entry) || 0);
  }
  if (!value || typeof value !== 'object') {
    return [0, 0, 1, 1];
  }
  if ('x0' in value && 'y0' in value && 'x1' in value && 'y1' in value) {
    return [
      Number(value.x0) || 0,
      Number(value.y0) || 0,
      Number(value.x1) || 0,
      Number(value.y1) || 0,
    ];
  }
  if ('x' in value && 'y' in value && 'w' in value && 'h' in value) {
    return [
      Number(value.x) || 0,
      Number(value.y) || 0,
      (Number(value.x) || 0) + (Number(value.w) || 0),
      (Number(value.y) || 0) + (Number(value.h) || 0),
    ];
  }
  return [0, 0, 1, 1];
}

function collectTableRegionRects(page) {
  try {
    const finder = typeof page?.find_tables === 'function' ? page.find_tables() : page?.findTables?.();
    return (finder?.tables || [])
      .map((table) => normalizeRect(table?.bbox))
      .filter((bbox) => validBBox(bbox));
  } catch {
    return [];
  }
}

function expandAndClampRect(bbox, pageRect, padding = 0.5) {
  return [
    Math.max(Number(pageRect[0]) || 0, (Number(bbox[0]) || 0) - padding),
    Math.max(Number(pageRect[1]) || 0, (Number(bbox[1]) || 0) - padding),
    Math.min(Number(pageRect[2]) || 0, (Number(bbox[2]) || 0) + padding),
    Math.min(Number(pageRect[3]) || 0, (Number(bbox[3]) || 0) + padding),
  ];
}

function annotationColorForElement(element) {
  return TEXT_DETECTION_BOX_COLORS[String(element?.renderKind || '')] || TEXT_DETECTION_BOX_COLORS['tight-separated'];
}

function pageSizeFromRect(pageRect) {
  return [
    Math.max(1, Number(pageRect?.[2] || 0) - Number(pageRect?.[0] || 0)),
    Math.max(1, Number(pageRect?.[3] || 0) - Number(pageRect?.[1] || 0)),
  ];
}

function pageContentMatrix(pageRect) {
  return [
    1,
    0,
    0,
    1,
    -(Number(pageRect?.[0]) || 0),
    -(Number(pageRect?.[1]) || 0),
  ];
}

function mirrorRectWithinPageRect(bbox, pageRect) {
  return [
    (Number(pageRect[0]) || 0) + (Number(pageRect[2]) || 0) - (Number(bbox[2]) || 0),
    Number(bbox[1]) || 0,
    (Number(pageRect[0]) || 0) + (Number(pageRect[2]) || 0) - (Number(bbox[0]) || 0),
    Number(bbox[3]) || 0,
  ];
}

function pointInsideRect(point, bbox, padding = 1.5) {
  return (
    Number(point?.[0]) >= ((Number(bbox?.[0]) || 0) - padding)
    && Number(point?.[0]) <= ((Number(bbox?.[2]) || 0) + padding)
    && Number(point?.[1]) >= ((Number(bbox?.[1]) || 0) - padding)
    && Number(point?.[1]) <= ((Number(bbox?.[3]) || 0) + padding)
  );
}

function addDetectedTextBoxAnnotations(page, elements, mupdf, pageRect) {
  if (!Array.isArray(elements) || elements.length === 0) {
    return;
  }
  for (const element of elements) {
    const rect = expandAndClampRect(element?.bbox || [], pageRect);
    if (!validBBox(rect)) {
      continue;
    }
    const annotation = page.createAnnotation('Square');
    try {
      annotation.setRect(rect);
      annotation.setColor(annotationColorForElement(element));
      annotation.setInteriorColor([]);
      annotation.setOpacity(TEXT_DETECTION_BOX_ALPHA);
      annotation.setBorderWidth(TEXT_DETECTION_BOX_STROKE_WIDTH);
      annotation.setBorderStyle('Solid');
      annotation.setFlags(mupdf.PDFAnnotation.IS_PRINT);
      annotation.update();
    } finally {
      annotation.destroy?.();
    }
  }
}

function drawDetectedTextBoxesToPdfDevice(device, elements, pageRect, mupdf) {
  if (!Array.isArray(elements) || elements.length === 0) {
    return;
  }
  const strokeState = new mupdf.StrokeState({
    lineCap: 'Butt',
    lineJoin: 'Miter',
    lineWidth: TEXT_DETECTION_BOX_STROKE_WIDTH,
    miterLimit: 10,
  });
  try {
    for (const element of elements) {
      const rect = expandAndClampRect(element?.bbox || [], pageRect);
      if (!validBBox(rect)) {
        continue;
      }
      const pathObject = new mupdf.Path();
      try {
        pathObject.rect(
          Number(rect[0]) - Number(pageRect?.[0] || 0),
          Number(rect[1]) - Number(pageRect?.[1] || 0),
          Number(rect[2]) - Number(pageRect?.[0] || 0),
          Number(rect[3]) - Number(pageRect?.[1] || 0),
        );
        device.strokePath(
          pathObject,
          strokeState,
          PDF_DEVICE_IDENTITY_MATRIX,
          mupdf.ColorSpace.DeviceRGB,
          annotationColorForElement(element),
          TEXT_DETECTION_BOX_ALPHA,
        );
      } finally {
        pathObject.destroy?.();
      }
    }
  } finally {
    strokeState.destroy?.();
  }
}

function buildDetectedTextDebugStages(page) {
  const tableRegions = collectTableRegionRects(page);
  const rawDetectedElements = collectStructuredTextLineElements(page)
    .filter((element) => validBBox(element?.bbox) && String(element?.text || '').trim().length > 0)
    .map((element, index) => ({
      ...element,
      debugElementId: `raw-${index + 1}`,
      renderKind: 'raw-detected',
    }));
  const tightSeparatedElements = prepareDetectedTextElementsForAnnotation(rawDetectedElements)
    .filter((element) => validBBox(element?.bbox) && String(element?.text || '').trim().length > 0)
    .map((element, index) => ({
      ...element,
      debugElementId: element.debugElementId || `tight-${index + 1}`,
      renderKind: 'tight-separated',
    }));
  const horizontalMergedElements = mergeDetectedTextElementsHorizontally(tightSeparatedElements)
    .map((element, index) => ({
      ...element,
      debugElementId: `horizontal-${index + 1}`,
      renderKind: 'horizontal-merged',
    }));
  const verticalMergedGroups = mergeDetectedTextElementsVertically(horizontalMergedElements, { tableRegions })
    .filter((element) => (Array.isArray(element?.verticalMergedElementIds) ? element.verticalMergedElementIds.length : 0) > 1)
    .map((element, index) => ({
      ...element,
      debugElementId: `vertical-${index + 1}`,
      renderKind: 'vertical-merged',
    }));
  const absorbedRawElementIds = new Set(
    horizontalMergedElements.flatMap((element) => Array.isArray(element?.mergedElementIds) ? element.mergedElementIds : []),
  );
  const absorbedHorizontalElementIds = new Set(
    verticalMergedGroups.flatMap((element) => Array.isArray(element?.verticalMergedElementIds) ? element.verticalMergedElementIds : []),
  );
  const filteredRawDetectedElements = rawDetectedElements.filter((element) => !absorbedRawElementIds.has(String(element?.debugElementId || '')));
  const filteredTightSeparatedElements = tightSeparatedElements.filter((element) => !absorbedRawElementIds.has(String(element?.debugElementId || '')));
  const filteredHorizontalMergedElements = horizontalMergedElements.filter(
    (element) => !absorbedHorizontalElementIds.has(String(element?.debugElementId || '')),
  );
  return {
    rawDetectedElements: filteredRawDetectedElements,
    tightSeparatedElements: filteredTightSeparatedElements,
    horizontalMergedElements: filteredHorizontalMergedElements,
    verticalMergedElements: verticalMergedGroups,
    annotationElements: [
      ...filteredRawDetectedElements,
      ...filteredTightSeparatedElements,
      ...filteredHorizontalMergedElements,
      ...verticalMergedGroups,
    ],
  };
}

function collectPageTextGlyphs(page, mupdf) {
  const glyphs = [];
  const seen = new Set();

  function captureTextGlyphs(text, color, alpha) {
    text.walk({
      showGlyph(font, trm, glyph, unicode, wmode, bidi) {
        const normalizedTrm = Array.isArray(trm)
          ? trm.slice(0, 6).map((value) => Number(value) || 0)
          : [1, 0, 0, 1, 0, 0];
        const key = [
          Number(font?.pointer || 0),
          Number(glyph || 0),
          Number(unicode || 0),
          Number(wmode || 0),
          ...normalizedTrm.map((value) => round(value)),
        ].join(':');
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        glyphs.push({
          font,
          glyphId: Number(glyph || 0),
          unicode: Number(unicode || 0),
          wmode: Number(wmode || 0),
          bidi: Number(bidi || 0),
          trm: normalizedTrm,
          origin: [normalizedTrm[4], normalizedTrm[5]],
          color: Array.isArray(color) ? color.slice(0, 3).map((value) => Number(value) || 0) : [0, 0, 0],
          alpha: Number(alpha || 1),
        });
      },
    });
  }

  const device = new mupdf.Device({
    fillText(text, _ctm, _colorspace, color, alpha) {
      captureTextGlyphs(text, color, alpha);
    },
    strokeText(text, _stroke, _ctm, _colorspace, color, alpha) {
      captureTextGlyphs(text, color, alpha);
    },
  });

  try {
    page.run(device, mupdf.Matrix.identity);
    return glyphs;
  } finally {
    device.close?.();
    device.destroy?.();
  }
}

function assignGlyphsToDetectedTextElements(elements, glyphs) {
  const prepared = (elements || []).map((element) => ({
    ...element,
    glyphs: [],
  }));
  for (const glyph of glyphs || []) {
    let selectedIndex = -1;
    let selectedArea = Number.POSITIVE_INFINITY;
    for (let index = 0; index < prepared.length; index += 1) {
      const element = prepared[index];
      if (!pointInsideRect(glyph.origin, element.bbox)) {
        continue;
      }
      const area = bboxArea(element.bbox);
      if (area < selectedArea) {
        selectedArea = area;
        selectedIndex = index;
      }
    }
    if (selectedIndex >= 0) {
      prepared[selectedIndex].glyphs.push(glyph);
    }
  }
  return prepared;
}

function positionDetectedTextElements(elements, pageRect, { mirrorEnabled = false } = {}) {
  return (elements || []).map((element) => ({
    ...element,
    sourceBBox: Array.isArray(element?.sourceBBox) ? [...element.sourceBBox] : [...element.bbox],
    bbox: mirrorEnabled ? mirrorRectWithinPageRect(element.bbox, pageRect) : [...element.bbox],
  }));
}

export function buildHorizontallyShiftedGlyphTrm({
  glyphTrm,
  sourceBBox,
  destinationBBox,
  pageRect,
}) {
  const deltaX = (Number(destinationBBox?.[0]) || 0) - (Number(sourceBBox?.[0]) || 0);
  return [
    Number(glyphTrm?.[0]) || 0,
    Number(glyphTrm?.[1]) || 0,
    Number(glyphTrm?.[2]) || 0,
    Number(glyphTrm?.[3]) || 0,
    (Number(glyphTrm?.[4]) || 0) + deltaX - (Number(pageRect?.[0]) || 0),
    (Number(glyphTrm?.[5]) || 0) - (Number(pageRect?.[1]) || 0),
  ];
}

function drawReconstructedDetectedTextToPdfDevice(device, elements, pageRect, mupdf) {
  for (const element of elements || []) {
    if (!Array.isArray(element?.glyphs) || element.glyphs.length === 0) {
      continue;
    }
    const sourceBBox = Array.isArray(element?.sourceBBox) ? element.sourceBBox : element.bbox;
    const destinationBBox = element.bbox;
    const color = Array.isArray(element.glyphs[0]?.color) ? element.glyphs[0].color : [0, 0, 0];
    const alpha = Number(element.glyphs[0]?.alpha || 1);
    const textObject = new mupdf.Text();
    try {
      for (const glyph of element.glyphs) {
        // Mirrored overlay mode repositions detected glyphs horizontally only.
        const shiftedTrm = buildHorizontallyShiftedGlyphTrm({
          glyphTrm: glyph.trm,
          sourceBBox,
          destinationBBox,
          pageRect,
        });
        textObject.showGlyph(
          glyph.font,
          shiftedTrm,
          Number(glyph.glyphId || 0),
          Number(glyph.unicode || 0),
          Number(glyph.wmode || 0),
        );
      }
      device.fillText(
        textObject,
        PDF_DEVICE_IDENTITY_MATRIX,
        mupdf.ColorSpace.DeviceRGB,
        color,
        alpha,
      );
    } finally {
      textObject.destroy?.();
    }
  }
}

function redactPageToTextOnly(page, pageRect, mupdf) {
  const redact = page.createAnnotation('Redact');
  try {
    redact.setRect(pageRect);
    redact.update();
  } finally {
    redact.destroy?.();
  }
  page.applyRedactions(
    false,
    mupdf.PDFPage.REDACT_IMAGE_REMOVE,
    mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,
    mupdf.PDFPage.REDACT_TEXT_NONE,
  );
}

function preparePageForDetectedTextOutput(page, mupdf) {
  const pageRect = normalizeRect(page.getBounds());
  const {
    annotationElements,
    tightSeparatedElements,
  } = buildDetectedTextDebugStages(page);
  redactPageToTextOnly(page, pageRect, mupdf);
  return {
    pageRect,
    detectedTextElements: tightSeparatedElements,
    annotationElements,
  };
}

export async function buildTextOnlyPdf({
  documentBytes,
  requestedPages = null,
}) {
  const imported = await import('mupdf');
  const mupdf = imported?.default || imported;

  const sourceBytes = documentBytes instanceof Uint8Array
    ? documentBytes
    : new Uint8Array(documentBytes);
  const pdf = new mupdf.PDFDocument(sourceBytes);
  const selectedPageIds = requestedPages && requestedPages.length > 0
    ? new Set(requestedPages.map((pageId) => Number(pageId)))
    : null;

  try {
    const pageCount = pdf.countPages();
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageId = pageIndex + 1;
      if (selectedPageIds && !selectedPageIds.has(pageId)) {
        continue;
      }
      const page = pdf.loadPage(pageIndex);
      try {
        const { pageRect, annotationElements } = preparePageForDetectedTextOutput(page, mupdf);
        addDetectedTextBoxAnnotations(page, annotationElements, mupdf, pageRect);
        page.update();
      } finally {
        page.destroy?.();
      }
    }
    if (selectedPageIds) {
      for (let pageIndex = pdf.countPages() - 1; pageIndex >= 0; pageIndex -= 1) {
        const pageId = pageIndex + 1;
        if (!selectedPageIds.has(pageId)) {
          pdf.deletePage(pageIndex);
        }
      }
    }
    pdf.subsetFonts?.();
    const buffer = pdf.saveToBuffer();
    try {
      const bytes = buffer.asUint8Array();
      return bytes.slice().buffer;
    } finally {
      buffer.destroy?.();
    }
  } finally {
    pdf.destroy?.();
  }
}

export async function buildDetectedTextOverlayPdf({
  documentBytes,
  requestedPages = null,
  mirrorEnabled = false,
}) {
  const imported = await import('mupdf');
  const mupdf = imported?.default || imported;

  const sourceBytes = documentBytes instanceof Uint8Array
    ? documentBytes
    : new Uint8Array(documentBytes);
  const pdf = new mupdf.PDFDocument(sourceBytes);
  const selectedPageIds = requestedPages && requestedPages.length > 0
    ? new Set(requestedPages.map((pageId) => Number(pageId)))
    : null;
  const outputBuffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(outputBuffer, 'pdf', '');
  const twinDocument = mirrorEnabled ? openMuPdfTwinDocument(sourceBytes, 'application/pdf') : null;

  try {
    const pageCount = pdf.countPages();
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageId = pageIndex + 1;
      if (selectedPageIds && !selectedPageIds.has(pageId)) {
        continue;
      }
      if (mirrorEnabled) {
        const page = pdf.loadPage(pageIndex);
        let backgroundPixmap = null;
        try {
          const pageRect = normalizeRect(page.getBounds());
          const {
            annotationElements,
            tightSeparatedElements,
          } = buildDetectedTextDebugStages(page);
          const detectedTextGlyphs = assignGlyphsToDetectedTextElements(
            tightSeparatedElements,
            collectPageTextGlyphs(page, mupdf),
          );
          const positionedTextElements = positionDetectedTextElements(detectedTextGlyphs, pageRect, {
            mirrorEnabled: true,
          });
          const positionedAnnotationElements = positionDetectedTextElements(annotationElements, pageRect, {
            mirrorEnabled: true,
          });
          backgroundPixmap = renderMirroredPagePixmapWithoutText(pdf, twinDocument, pageIndex, {
            scale: TEXTLESS_BACKGROUND_RENDER_DPI / 72,
          });
          const [widthPt, heightPt] = pageSizeFromRect(pageRect);
          const pageDevice = writer.beginPage([0, 0, widthPt, heightPt]);
          try {
            const backgroundImage = new mupdf.Image(backgroundPixmap.asPNG());
            try {
              pageDevice.fillImage(
                backgroundImage,
                [widthPt, 0, 0, heightPt, 0, 0],
                1,
              );
            } finally {
              backgroundImage.destroy?.();
            }
            drawReconstructedDetectedTextToPdfDevice(pageDevice, positionedTextElements, pageRect, mupdf);
            drawDetectedTextBoxesToPdfDevice(pageDevice, positionedAnnotationElements, pageRect, mupdf);
          } finally {
            pageDevice.close?.();
            writer.endPage();
          }
        } finally {
          backgroundPixmap?.destroy?.();
          page.destroy?.();
        }
        continue;
      }
      const backgroundPixmap = renderPagePixmapWithoutText(pdf, pageIndex, {
        scale: TEXTLESS_BACKGROUND_RENDER_DPI / 72,
      });
      const overlayDocument = new mupdf.PDFDocument();
      overlayDocument.graftPage(0, pdf, pageIndex);
      const overlayPage = overlayDocument.loadPage(0);
      try {
        const { pageRect, annotationElements, detectedTextElements } = preparePageForDetectedTextOutput(overlayPage, mupdf);
        overlayPage.update();
        const [widthPt, heightPt] = pageSizeFromRect(pageRect);
        const pageDevice = writer.beginPage([0, 0, widthPt, heightPt]);
        try {
          const backgroundImage = new mupdf.Image(backgroundPixmap.asPNG());
          try {
            pageDevice.fillImage(
              backgroundImage,
              [widthPt, 0, 0, heightPt, 0, 0],
              1,
            );
          } finally {
            backgroundImage.destroy?.();
          }
          overlayPage.runPageContents(pageDevice, pageContentMatrix(pageRect));
          drawDetectedTextBoxesToPdfDevice(pageDevice, annotationElements, pageRect, mupdf);
        } finally {
          pageDevice.close?.();
          writer.endPage();
        }
      } finally {
        overlayPage.destroy?.();
        overlayDocument.destroy?.();
        backgroundPixmap.destroy?.();
      }
    }
    writer.close();
    return outputBuffer.asUint8Array().slice().buffer;
  } finally {
    twinDocument?.destroy?.();
    writer.destroy?.();
    pdf.destroy?.();
  }
}
