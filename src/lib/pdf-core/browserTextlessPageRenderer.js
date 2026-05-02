import mupdf from 'mupdf';

import { collectStructuredTextLineBBoxes, validBBox } from './browserTextDetection.js';

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

function rectWidth(bbox) {
  return Math.max(0, Number(bbox?.[2] || 0) - Number(bbox?.[0] || 0));
}

function rectHeight(bbox) {
  return Math.max(0, Number(bbox?.[3] || 0) - Number(bbox?.[1] || 0));
}

function mirrorRectWithinPageRect(bbox, pageRect) {
  return [
    (Number(pageRect[0]) || 0) + (Number(pageRect[2]) || 0) - (Number(bbox[2]) || 0),
    Number(bbox[1]) || 0,
    (Number(pageRect[0]) || 0) + (Number(pageRect[2]) || 0) - (Number(bbox[0]) || 0),
    Number(bbox[3]) || 0,
  ];
}

function bboxToPixmapBounds(bbox, pageRect, pixmap) {
  if (!validBBox(bbox)) {
    return null;
  }
  const width = Math.max(1, Number(pixmap.getWidth?.() || 0));
  const height = Math.max(1, Number(pixmap.getHeight?.() || 0));
  const scaleX = width / Math.max(1, rectWidth(pageRect));
  const scaleY = height / Math.max(1, rectHeight(pageRect));
  const x0 = Math.max(0, Math.min(width, Math.floor((Number(bbox[0]) - Number(pageRect[0])) * scaleX)));
  const y0 = Math.max(0, Math.min(height, Math.floor((Number(bbox[1]) - Number(pageRect[1])) * scaleY)));
  const x1 = Math.max(0, Math.min(width, Math.ceil((Number(bbox[2]) - Number(pageRect[0])) * scaleX)));
  const y1 = Math.max(0, Math.min(height, Math.ceil((Number(bbox[3]) - Number(pageRect[1])) * scaleY)));
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return [x0, y0, x1, y1];
}

function pixmapBytesPerPixel(pixmap) {
  const width = Math.max(1, Number(pixmap.getWidth?.() || 0));
  const stride = Math.max(1, Number(pixmap.getStride?.() || 0));
  return Math.max(1, Math.round(stride / width));
}

export function mirrorPixmapHorizontally(pixmap) {
  const colorSpace = pixmap.getColorSpace?.() || null;
  const mirrored = new mupdf.Pixmap(colorSpace, pixmap.getBounds(), Boolean(pixmap.getAlpha?.()));
  colorSpace?.destroy?.();
  mirrored.setResolution?.(
    Number(pixmap.getXResolution?.() || 72),
    Number(pixmap.getYResolution?.() || 72),
  );
  const sourcePixels = pixmap.getPixels();
  const destinationPixels = mirrored.getPixels();
  const width = Math.max(1, Number(pixmap.getWidth?.() || 0));
  const height = Math.max(1, Number(pixmap.getHeight?.() || 0));
  const stride = Math.max(1, Number(pixmap.getStride?.() || 0));
  const bytesPerPixel = pixmapBytesPerPixel(pixmap);
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * stride;
    for (let col = 0; col < width; col += 1) {
      const sourceOffset = rowOffset + (col * bytesPerPixel);
      const destinationOffset = rowOffset + ((width - 1 - col) * bytesPerPixel);
      destinationPixels.set(sourcePixels.slice(sourceOffset, sourceOffset + bytesPerPixel), destinationOffset);
    }
  }
  return mirrored;
}

export function restoreMirroredPixmapImageOrientations(pixmap, {
  imageBboxes,
  pageRect,
} = {}) {
  if (!Array.isArray(imageBboxes) || imageBboxes.length === 0) {
    return pixmap;
  }
  const pixels = pixmap.getPixels();
  const stride = Math.max(1, Number(pixmap.getStride?.() || 0));
  const bytesPerPixel = pixmapBytesPerPixel(pixmap);
  for (const imageBBox of imageBboxes) {
    const mirroredBBox = mirrorRectWithinPageRect(imageBBox, pageRect);
    const bounds = bboxToPixmapBounds(mirroredBBox, pageRect, pixmap);
    if (!bounds) {
      continue;
    }
    const [x0, y0, x1, y1] = bounds;
    for (let row = y0; row < y1; row += 1) {
      const rowOffset = row * stride;
      let left = x0;
      let right = x1 - 1;
      while (left < right) {
        const leftOffset = rowOffset + (left * bytesPerPixel);
        const rightOffset = rowOffset + (right * bytesPerPixel);
        const leftPixel = pixels.slice(leftOffset, leftOffset + bytesPerPixel);
        pixels.copyWithin(leftOffset, rightOffset, rightOffset + bytesPerPixel);
        pixels.set(leftPixel, rightOffset);
        left += 1;
        right -= 1;
      }
    }
  }
  return pixmap;
}

export function renderPagePixmapWithoutText(document, pageIndex, { scale }) {
  const tempDocument = new mupdf.PDFDocument();
  tempDocument.graftPage(0, document, pageIndex);
  const tempPage = tempDocument.loadPage(0);
  try {
    for (const rect of collectStructuredTextLineBBoxes(tempPage)) {
      const annotation = tempPage.createAnnotation('Redact');
      try {
        annotation.setRect(rect);
      } finally {
        annotation.destroy?.();
      }
    }
    tempPage.applyRedactions(
      false,
      mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );
    return tempPage.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
  } finally {
    tempPage.destroy?.();
    tempDocument.destroy?.();
  }
}

export function renderMirroredPagePixmapWithoutText(document, twinDocument, pageIndex, { scale }) {
  const sourcePage = document.loadPage(pageIndex);
  let twinPage = null;
  try {
    const pageRect = normalizeRect(sourcePage.getBounds());
    twinPage = twinDocument?.loadPage?.(pageIndex) || null;
    const imageBboxes = twinPage?.getImageBlocks?.() || [];
    const sourcePixmap = renderPagePixmapWithoutText(document, pageIndex, { scale });
    try {
      const mirroredPixmap = mirrorPixmapHorizontally(sourcePixmap);
      restoreMirroredPixmapImageOrientations(mirroredPixmap, {
        imageBboxes,
        pageRect,
      });
      return mirroredPixmap;
    } finally {
      sourcePixmap.destroy?.();
    }
  } finally {
    twinPage?.destroy?.();
    sourcePage.destroy?.();
  }
}
