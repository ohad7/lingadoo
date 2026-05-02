import mupdf from 'mupdf';

const TEXT_FONT_ITALIC = 2;
const TEXT_FONT_SERIFED = 4;
const TEXT_FONT_MONOSPACED = 8;
const TEXT_FONT_BOLD = 16;
const RTL_CHAR_RE = /[\u0590-\u08FF]/u;
const LTR_CHAR_RE = /[A-Za-z]/u;
const DEFAULT_SNAP_TOLERANCE = 3;
const DEFAULT_JOIN_TOLERANCE = 3;
const DEFAULT_INTERSECTION_TOLERANCE = 3;
const DEFAULT_MIN_WORDS_VERTICAL = 3;
const DEFAULT_MIN_WORDS_HORIZONTAL = 1;
const DEFAULT_EDGE_MIN_LENGTH = 3;
const STRUCTURED_TEXT_STYLE_OPTIONS = 'preserve-whitespace,collect-styles,use-cid-for-unknown-unicode';

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function rectWidth(rect) {
  return Math.max(0, Number(rect.x1) - Number(rect.x0));
}

function rectHeight(rect) {
  return Math.max(0, Number(rect.y1) - Number(rect.y0));
}

function makeRect(x0, y0, x1, y1) {
  return {
    x0: round(Math.min(x0, x1)),
    y0: round(Math.min(y0, y1)),
    x1: round(Math.max(x0, x1)),
    y1: round(Math.max(y0, y1)),
  };
}

function rectFromMuPdf(value) {
  if (Array.isArray(value)) {
    return makeRect(value[0], value[1], value[2], value[3]);
  }
  if (value && typeof value === 'object') {
    if ('x0' in value && 'y0' in value && 'x1' in value && 'y1' in value) {
      return makeRect(value.x0, value.y0, value.x1, value.y1);
    }
    if ('x' in value && 'y' in value && 'w' in value && 'h' in value) {
      return makeRect(value.x, value.y, Number(value.x) + Number(value.w), Number(value.y) + Number(value.h));
    }
  }
  return makeRect(0, 0, 0, 0);
}

function rectToArray(rect) {
  return [rect.x0, rect.y0, rect.x1, rect.y1];
}

function rectUnion(rects) {
  if (rects.length === 0) {
    return makeRect(0, 0, 0, 0);
  }
  return makeRect(
    Math.min(...rects.map((rect) => rect.x0)),
    Math.min(...rects.map((rect) => rect.y0)),
    Math.max(...rects.map((rect) => rect.x1)),
    Math.max(...rects.map((rect) => rect.y1)),
  );
}

function rectInside(inner, outer) {
  return (
    inner.x0 >= outer.x0
    && inner.y0 >= outer.y0
    && inner.x1 <= outer.x1
    && inner.y1 <= outer.y1
  );
}

function rectIntersects(left, right) {
  return !(
    left.x1 <= right.x0
    || left.x0 >= right.x1
    || left.y1 <= right.y0
    || left.y0 >= right.y1
  );
}

function rectIntersectionArea(left, right) {
  const x0 = Math.max(left.x0, right.x0);
  const y0 = Math.max(left.y0, right.y0);
  const x1 = Math.min(left.x1, right.x1);
  const y1 = Math.min(left.y1, right.y1);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

function getBBoxOverlap(left, right) {
  const overlap = makeRect(
    Math.max(left[0], right[0]),
    Math.max(left[1], right[1]),
    Math.min(left[2], right[2]),
    Math.min(left[3], right[3]),
  );
  if (rectWidth(overlap) > 0 || rectHeight(overlap) > 0) {
    return rectToArray(overlap);
  }
  return null;
}

function horizontalGap(left, right) {
  if (left.x1 < right.x0) {
    return right.x0 - left.x1;
  }
  if (right.x1 < left.x0) {
    return left.x0 - right.x1;
  }
  return 0;
}

function horizontalOverlapRatio(left, right) {
  const overlap = Math.max(0, Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0));
  const denominator = Math.min(rectWidth(left), rectWidth(right));
  if (denominator <= 0) {
    return 0;
  }
  return overlap / denominator;
}

function verticalOverlapHeight(left, right) {
  return Math.max(0, Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0));
}

function rectCenterX(rect) {
  return (rect.x0 + rect.x1) / 2;
}

function rectCenterY(rect) {
  return (rect.y0 + rect.y1) / 2;
}

function inferTextDirection(text) {
  let rtl = 0;
  let ltr = 0;
  for (const char of String(text || '')) {
    if (RTL_CHAR_RE.test(char)) {
      rtl += 1;
    } else if (LTR_CHAR_RE.test(char)) {
      ltr += 1;
    }
  }
  if (rtl === 0 && ltr === 0) {
    return 'UNKNOWN';
  }
  return rtl >= ltr ? 'RTL' : 'LTR';
}

function rectContainsPoint(rect, point) {
  return (
    point.x >= rect.x0
    && point.x <= rect.x1
    && point.y >= rect.y0
    && point.y <= rect.y1
  );
}

function transformPoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: round((a * x) + (c * y) + e),
    y: round((b * x) + (d * y) + f),
  };
}

function bboxFromQuad(quad) {
  const xs = [quad[0], quad[2], quad[4], quad[6]].map((value) => Number(value || 0));
  const ys = [quad[1], quad[3], quad[5], quad[7]].map((value) => Number(value || 0));
  return makeRect(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  );
}

function normalizeFontName(name) {
  return String(name || 'unknown').replace(/^[A-Z]{6}\+/, '') || 'unknown';
}

function colorToInt(color) {
  const channels = Array.isArray(color) ? color.slice(0, 3) : [0, 0, 0];
  const bytes = channels.map((value) => {
    const numeric = Number(value || 0);
    const scaled = numeric <= 1 ? numeric * 255 : numeric;
    return Math.max(0, Math.min(255, Math.round(scaled)));
  });
  return ((255 << 24) | (bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) >>> 0;
}

function fontFlags(font) {
  let flags = 0;
  if (font?.isItalic?.()) {
    flags |= TEXT_FONT_ITALIC;
  }
  if (font?.isSerif?.()) {
    flags |= TEXT_FONT_SERIFED;
  }
  if (font?.isMonospaced?.()) {
    flags |= TEXT_FONT_MONOSPACED;
  }
  if (font?.isBold?.()) {
    flags |= TEXT_FONT_BOLD;
  }
  return flags;
}

function lineDirectionValue(direction) {
  if (!direction || typeof direction !== 'object') {
    return [1, 0];
  }
  return [round(Number(direction.x || 0), 4), round(Number(direction.y || 0), 4)];
}

function hashBytes(bytes) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function imageSignature(image) {
  const pixmap = image.toPixmap();
  try {
    const pixels = pixmap.getPixels();
    return [
      image.getWidth(),
      image.getHeight(),
      image.getNumberOfComponents(),
      image.getBitsPerComponent(),
      image.getImageMask() ? 1 : 0,
      hashBytes(pixels),
    ].join(':');
  } finally {
    pixmap.destroy?.();
  }
}

function dedupeImageRects(rects) {
  const seen = new Set();
  const unique = [];
  for (const rect of rects) {
    const key = rectToArray(rect).map((value) => round(value, 1)).join(':');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(rect);
  }
  return unique;
}

function collectPdfResourceImages(pdfPage) {
  if (!pdfPage || typeof pdfPage.getObject !== 'function' || !pdfPage._doc || typeof pdfPage._doc.loadImage !== 'function') {
    return null;
  }

  const images = [];
  const seenRefs = new Set();

  const walkXObjectDict = (xObjectDict) => {
    if (!xObjectDict || typeof xObjectDict.isDictionary !== 'function' || !xObjectDict.isDictionary()) {
      return;
    }
    xObjectDict.forEach((value, key) => {
      const ref = value.isIndirect?.() ? value.asIndirect() : null;
      if (ref && seenRefs.has(ref)) {
        value.destroy?.();
        return;
      }
      if (ref) {
        seenRefs.add(ref);
      }

      const resolved = value.resolve?.() || value;
      const subtype = resolved.get?.('Subtype');
      const subtypeName = subtype?.isName?.() ? subtype.asName() : '';

      if (subtypeName === 'Image') {
        let image = null;
        try {
          image = pdfPage._doc.loadImage(value);
          images.push({
            name: String(key),
            xref: ref,
            width: image.getWidth(),
            height: image.getHeight(),
            components: image.getNumberOfComponents(),
            bitsPerComponent: image.getBitsPerComponent(),
            imageMask: image.getImageMask(),
            signature: imageSignature(image),
          });
        } catch {
          // Ignore malformed image references and continue scanning.
        } finally {
          image?.destroy?.();
        }
      } else if (subtypeName === 'Form') {
        const resources = resolved.get?.('Resources');
        const childXObject = resources?.get?.('XObject');
        walkXObjectDict(childXObject);
        childXObject?.destroy?.();
        resources?.destroy?.();
      }

      subtype?.destroy?.();
      resolved?.destroy?.();
      value.destroy?.();
    });
  };

  const pageObject = pdfPage.getObject();
  try {
    const resources = typeof pageObject.getInheritable === 'function'
      ? pageObject.getInheritable('Resources')
      : pageObject.get('Resources');
    const xObject = resources?.get?.('XObject');
    walkXObjectDict(xObject);
    xObject?.destroy?.();
    resources?.destroy?.();
  } finally {
    pageObject?.destroy?.();
  }

  return images;
}

function xrefKey(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'object') {
    if ('num' in value || 'gen' in value) {
      return `${String(value.num ?? '')}:${String(value.gen ?? '')}`;
    }
  }
  return String(value);
}

function collectRenderedImageRects(page, resourceSignatures = null) {
  const rects = [];
  const signatureCache = new Map();
  const matchesResourceImage = (image) => {
    if (!resourceSignatures) {
      return true;
    }
    if (resourceSignatures.size === 0) {
      return false;
    }
    const cacheKey = Number(image.pointer || 0);
    let signature = signatureCache.get(cacheKey);
    if (!signature) {
      signature = imageSignature(image);
      signatureCache.set(cacheKey, signature);
    }
    return resourceSignatures.has(signature);
  };

  const device = new mupdf.Device({
    fillImage(image, ctm) {
      if (!matchesResourceImage(image)) {
        return;
      }
      rects.push(rectFromMuPdf(mupdf.Rect.transform([0, 0, 1, 1], ctm)));
    },
    fillImageMask(image, ctm) {
      if (!matchesResourceImage(image)) {
        return;
      }
      rects.push(rectFromMuPdf(mupdf.Rect.transform([0, 0, 1, 1], ctm)));
    },
  });
  try {
    page.run(device, mupdf.Matrix.identity);
  } finally {
    device.close();
    device.destroy();
  }
  return dedupeImageRects(rects);
}

function isWhitespaceChar(char) {
  return /^\s$/u.test(char);
}

function normalizeStructuredTextChar(char) {
  if (!char) {
    return '';
  }
  const text = String(char);
  const codePoint = text.codePointAt(0);
  if (typeof codePoint === 'number' && codePoint < 0x20 && !isWhitespaceChar(text)) {
    return '\uFFFD';
  }
  return text;
}

function isWordSeparatorChar(char) {
  if (!char) {
    return false;
  }
  const codePoint = String(char).codePointAt(0);
  return isWhitespaceChar(char) || char === '\uFFFD' || (typeof codePoint === 'number' && codePoint < 0x20);
}

function isRtlWordChar(char) {
  if (!char) {
    return false;
  }
  const codePoint = String(char).codePointAt(0);
  if (typeof codePoint !== 'number') {
    return false;
  }
  return codePoint >= 0x590 && codePoint <= 0x900;
}

function areNeighborRects(left, right, xTolerance = 3, yTolerance = 3) {
  return !(
    left.x1 < right.x0 - xTolerance
    || left.x0 > right.x1 + xTolerance
    || left.y1 < right.y0 - yTolerance
    || left.y0 > right.y1 + yTolerance
  );
}

function sortRectsTopLeft(left, right) {
  const dy = left.y1 - right.y1;
  if (Math.abs(dy) > 0.01) {
    return dy;
  }
  return left.x0 - right.x0;
}

function sortWordsForLine(left, right) {
  if (left[5] !== right[5]) {
    return left[5] - right[5];
  }
  if (left[6] !== right[6]) {
    return left[6] - right[6];
  }
  return left[7] - right[7];
}

function orientationLength(edge) {
  return edge.orientation === 'v' ? Number(edge.height || 0) : Number(edge.width || 0);
}

function edgeToBBox(edge) {
  return [
    Number(edge.x0 || 0),
    Number(edge.top || 0),
    Number(edge.x1 || 0),
    Number(edge.bottom || 0),
  ];
}

function objToBBox(obj) {
  if (Array.isArray(obj)) {
    return obj;
  }
  return edgeToBBox(obj);
}

function edgeConnectKey(edge) {
  return JSON.stringify(edgeToBBox(edge).map((value) => round(value, 3)));
}

function makeTableEdge({ x0, x1, top, bottom, object_type = 'line', orientation = null }) {
  const rect = makeRect(x0, top, x1, bottom);
  const derivedOrientation = orientation || (
    rectHeight(rect) <= 0.001 ? 'h' : rectWidth(rect) <= 0.001 ? 'v' : null
  );
  return {
    x0: rect.x0,
    x1: rect.x1,
    top: rect.y0,
    bottom: rect.y1,
    width: rectWidth(rect),
    height: rectHeight(rect),
    orientation: derivedOrientation,
    object_type,
  };
}

function bboxToRectLike(bbox) {
  return { x0: bbox[0], top: bbox[1], x1: bbox[2], bottom: bbox[3] };
}

function mergeBboxes(bboxes) {
  if (bboxes.length === 0) {
    return [0, 0, 0, 0];
  }
  return [
    Math.min(...bboxes.map((bbox) => bbox[0])),
    Math.min(...bboxes.map((bbox) => bbox[1])),
    Math.max(...bboxes.map((bbox) => bbox[2])),
    Math.max(...bboxes.map((bbox) => bbox[3])),
  ];
}

function objectsToRect(objects) {
  return bboxToRectLike(mergeBboxes(objects.map((object) => objToBBox(object))));
}

function clusterList(values, tolerance = 0) {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return [];
  }
  if (tolerance === 0 || sorted.length === 1) {
    return sorted.map((value) => [value]);
  }
  const groups = [[sorted[0]]];
  let last = sorted[0];
  for (const value of sorted.slice(1)) {
    if (value <= last + tolerance) {
      groups.at(-1).push(value);
    } else {
      groups.push([value]);
    }
    last = value;
  }
  return groups;
}

function makeClusterDict(values, tolerance) {
  const result = new Map();
  clusterList(values, tolerance).forEach((cluster, clusterIndex) => {
    cluster.forEach((value) => {
      result.set(value, clusterIndex);
    });
  });
  return result;
}

function clusterObjects(values, keyFn, tolerance) {
  const getter = typeof keyFn === 'function' ? keyFn : (value) => value[keyFn];
  const clusterDict = makeClusterDict(values.map((value) => getter(value)), tolerance);
  const buckets = new Map();
  for (const value of values) {
    const clusterIndex = clusterDict.get(getter(value));
    if (!buckets.has(clusterIndex)) {
      buckets.set(clusterIndex, []);
    }
    buckets.get(clusterIndex).push(value);
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, items]) => items);
}

function moveEdge(edge, axis, value) {
  if (axis === 'h') {
    return {
      ...edge,
      x0: round(edge.x0 + value),
      x1: round(edge.x1 + value),
    };
  }
  return {
    ...edge,
    top: round(edge.top + value),
    bottom: round(edge.bottom + value),
  };
}

function snapObjects(objects, attr, tolerance) {
  if (!objects.length) {
    return [];
  }
  const axis = { x0: 'h', x1: 'h', top: 'v', bottom: 'v' }[attr];
  return clusterObjects(objects, (object) => object[attr], tolerance)
    .flatMap((cluster) => {
      const average = cluster.reduce((sum, object) => sum + object[attr], 0) / cluster.length;
      return cluster.map((object) => moveEdge(object, axis, average - object[attr]));
    });
}

function snapEdges(edges, xTolerance = DEFAULT_SNAP_TOLERANCE, yTolerance = DEFAULT_SNAP_TOLERANCE) {
  const vertical = edges.filter((edge) => edge.orientation === 'v');
  const horizontal = edges.filter((edge) => edge.orientation === 'h');
  return [
    ...snapObjects(vertical, 'x0', xTolerance),
    ...snapObjects(horizontal, 'top', yTolerance),
  ];
}

function resizeEdge(edge, key, value) {
  if (key === 'x0') {
    return makeTableEdge({
      ...edge,
      x0: value,
      x1: edge.x1,
      top: edge.top,
      bottom: edge.bottom,
      object_type: edge.object_type,
      orientation: edge.orientation,
    });
  }
  if (key === 'x1') {
    return makeTableEdge({
      ...edge,
      x0: edge.x0,
      x1: value,
      top: edge.top,
      bottom: edge.bottom,
      object_type: edge.object_type,
      orientation: edge.orientation,
    });
  }
  if (key === 'top') {
    return makeTableEdge({
      ...edge,
      x0: edge.x0,
      x1: edge.x1,
      top: value,
      bottom: edge.bottom,
      object_type: edge.object_type,
      orientation: edge.orientation,
    });
  }
  return makeTableEdge({
    ...edge,
    x0: edge.x0,
    x1: edge.x1,
    top: edge.top,
    bottom: value,
    object_type: edge.object_type,
    orientation: edge.orientation,
  });
}

function joinEdgeGroup(edges, orientation, tolerance = DEFAULT_JOIN_TOLERANCE) {
  if (!edges.length) {
    return [];
  }
  const minProp = orientation === 'h' ? 'x0' : 'top';
  const maxProp = orientation === 'h' ? 'x1' : 'bottom';
  const sorted = [...edges].sort((left, right) => left[minProp] - right[minProp]);
  const joined = [sorted[0]];
  for (const edge of sorted.slice(1)) {
    const last = joined.at(-1);
    if (edge[minProp] <= last[maxProp] + tolerance) {
      if (edge[maxProp] > last[maxProp]) {
        joined[joined.length - 1] = resizeEdge(last, maxProp, edge[maxProp]);
      }
    } else {
      joined.push(edge);
    }
  }
  return joined;
}

function mergeEdges(
  edges,
  snapXTolerance = DEFAULT_SNAP_TOLERANCE,
  snapYTolerance = DEFAULT_SNAP_TOLERANCE,
  joinXTolerance = DEFAULT_JOIN_TOLERANCE,
  joinYTolerance = DEFAULT_JOIN_TOLERANCE,
) {
  const snapped = (snapXTolerance > 0 || snapYTolerance > 0)
    ? snapEdges(edges, snapXTolerance, snapYTolerance)
    : [...edges];
  const grouped = new Map();
  for (const edge of snapped) {
    const key = edge.orientation === 'h'
      ? `h:${round(edge.top, 3)}`
      : `v:${round(edge.x0, 3)}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(edge);
  }
  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'en'))
    .flatMap(([key, group]) => joinEdgeGroup(group, key[0], key[0] === 'h' ? joinXTolerance : joinYTolerance));
}

function filterEdges(edges, orientation = null, edgeType = null, minLength = 1) {
  return edges.filter((edge) => {
    const typeMatch = edgeType === null || edge.object_type === edgeType;
    const orientationMatch = orientation === null || edge.orientation === orientation;
    return typeMatch && orientationMatch && orientationLength(edge) >= minLength;
  });
}

function wordRect(word) {
  return { x0: word.x0, top: word.top, x1: word.x1, bottom: word.bottom };
}

function wordsToEdgesH(words, wordThreshold = DEFAULT_MIN_WORDS_HORIZONTAL) {
  const byTop = clusterObjects(words, (word) => word.top, 1);
  const largeClusters = byTop.filter((cluster) => cluster.length >= wordThreshold);
  const rects = largeClusters.map((cluster) => objectsToRect(cluster.map((word) => wordRect(word))));
  if (!rects.length) {
    return [];
  }
  const minX0 = Math.min(...rects.map((rect) => rect.x0));
  const maxX1 = Math.max(...rects.map((rect) => rect.x1));
  return rects.flatMap((rect) => [
    makeTableEdge({ x0: minX0, x1: maxX1, top: rect.top, bottom: rect.top }),
    makeTableEdge({ x0: minX0, x1: maxX1, top: rect.bottom, bottom: rect.bottom }),
  ]);
}

function wordsToEdgesV(words, wordThreshold = DEFAULT_MIN_WORDS_VERTICAL) {
  const byX0 = clusterObjects(words, (word) => word.x0, 1);
  const byX1 = clusterObjects(words, (word) => word.x1, 1);
  const byCenter = clusterObjects(words, (word) => (word.x0 + word.x1) / 2, 1);
  const clusters = [...byX0, ...byX1, ...byCenter]
    .sort((left, right) => right.length - left.length)
    .filter((cluster) => cluster.length >= wordThreshold);
  const bboxes = [];
  for (const cluster of clusters) {
    const bbox = mergeBboxes(cluster.map((word) => [word.x0, word.top, word.x1, word.bottom]));
    if (!bboxes.some((other) => getBBoxOverlap(bbox, other))) {
      bboxes.push(bbox);
    }
  }
  if (!bboxes.length) {
    return [];
  }
  const rects = bboxes.map((bbox) => bboxToRectLike(bbox)).sort((left, right) => left.x0 - right.x0);
  const maxX1 = Math.max(...rects.map((rect) => rect.x1));
  const minTop = Math.min(...rects.map((rect) => rect.top));
  const maxBottom = Math.max(...rects.map((rect) => rect.bottom));
  return [
    ...rects.map((rect) => makeTableEdge({
      x0: rect.x0,
      x1: rect.x0,
      top: minTop,
      bottom: maxBottom,
    })),
    makeTableEdge({
      x0: maxX1,
      x1: maxX1,
      top: minTop,
      bottom: maxBottom,
    }),
  ];
}

function edgesToIntersections(edges, xTolerance = 1, yTolerance = 1) {
  const intersections = new Map();
  const vertical = edges.filter((edge) => edge.orientation === 'v')
    .sort((left, right) => left.x0 - right.x0 || left.top - right.top);
  const horizontal = edges.filter((edge) => edge.orientation === 'h')
    .sort((left, right) => left.top - right.top || left.x0 - right.x0);
  for (const vEdge of vertical) {
    for (const hEdge of horizontal) {
      if (
        vEdge.top <= hEdge.top + yTolerance
        && vEdge.bottom >= hEdge.top - yTolerance
        && vEdge.x0 >= hEdge.x0 - xTolerance
        && vEdge.x0 <= hEdge.x1 + xTolerance
      ) {
        const key = `${round(vEdge.x0, 3)}:${round(hEdge.top, 3)}`;
        if (!intersections.has(key)) {
          intersections.set(key, {
            point: [round(vEdge.x0, 3), round(hEdge.top, 3)],
            v: [],
            h: [],
          });
        }
        intersections.get(key).v.push(vEdge);
        intersections.get(key).h.push(hEdge);
      }
    }
  }
  return intersections;
}

function intersectionsToCells(intersections) {
  const pointEntries = [...intersections.values()].sort((left, right) => (
    left.point[1] - right.point[1] || left.point[0] - right.point[0]
  ));
  const points = pointEntries.map((entry) => entry.point);

  function getEntry(point) {
    return intersections.get(`${round(point[0], 3)}:${round(point[1], 3)}`);
  }

  function edgeConnects(leftPoint, rightPoint) {
    if (leftPoint[0] === rightPoint[0]) {
      const shared = new Set(getEntry(leftPoint).v.map((edge) => edgeConnectKey(edge)));
      return getEntry(rightPoint).v.some((edge) => shared.has(edgeConnectKey(edge)));
    }
    if (leftPoint[1] === rightPoint[1]) {
      const shared = new Set(getEntry(leftPoint).h.map((edge) => edgeConnectKey(edge)));
      return getEntry(rightPoint).h.some((edge) => shared.has(edgeConnectKey(edge)));
    }
    return false;
  }

  function findSmallestCell(index) {
    if (index === points.length - 1) {
      return null;
    }
    const point = points[index];
    const rest = points.slice(index + 1);
    const below = rest.filter((candidate) => candidate[0] === point[0]);
    const right = rest.filter((candidate) => candidate[1] === point[1]);
    for (const belowPoint of below) {
      if (!edgeConnects(point, belowPoint)) {
        continue;
      }
      for (const rightPoint of right) {
        if (!edgeConnects(point, rightPoint)) {
          continue;
        }
        const bottomRight = [rightPoint[0], belowPoint[1]];
        const bottomRightEntry = getEntry(bottomRight);
        if (
          bottomRightEntry
          && edgeConnects(bottomRight, rightPoint)
          && edgeConnects(bottomRight, belowPoint)
        ) {
          return [point[0], point[1], bottomRight[0], bottomRight[1]];
        }
      }
    }
    return null;
  }

  return points
    .map((_, index) => findSmallestCell(index))
    .filter(Boolean);
}

function cellsToTables(page, cells) {
  function bboxToCorners(bbox) {
    return [
      [bbox[0], bbox[1]],
      [bbox[0], bbox[3]],
      [bbox[2], bbox[1]],
      [bbox[2], bbox[3]],
    ];
  }

  const remainingCells = [...cells];
  const tables = [];
  let currentCorners = new Set();
  let currentCells = [];

  while (remainingCells.length) {
    const initialCount = currentCells.length;
    for (let index = remainingCells.length - 1; index >= 0; index -= 1) {
      const cell = remainingCells[index];
      const cellCorners = bboxToCorners(cell).map((corner) => corner.join(':'));
      if (!currentCells.length) {
        cellCorners.forEach((corner) => currentCorners.add(corner));
        currentCells.push(cell);
        remainingCells.splice(index, 1);
        continue;
      }
      const sharedCornerCount = cellCorners.filter((corner) => currentCorners.has(corner)).length;
      if (sharedCornerCount > 0) {
        cellCorners.forEach((corner) => currentCorners.add(corner));
        currentCells.push(cell);
        remainingCells.splice(index, 1);
      }
    }
    if (currentCells.length === initialCount) {
      tables.push([...currentCells]);
      currentCorners = new Set();
      currentCells = [];
    }
  }

  if (currentCells.length) {
    tables.push([...currentCells]);
  }

  function dropRedundantOuterTopSpan(table) {
    if (table.length <= 1) {
      return table;
    }
    const bbox = mergeBboxes(table);
    const enclosingCell = table.find((cell) => (
      Math.abs(cell[0] - bbox[0]) <= 0.5
      && Math.abs(cell[1] - bbox[1]) <= 0.5
      && Math.abs(cell[2] - bbox[2]) <= 0.5
      && Math.abs(cell[3] - bbox[3]) <= 0.5
    ));
    if (!enclosingCell) {
      return table;
    }
    const hasReplacementTopSpan = table.some((cell) => (
      cell !== enclosingCell
      && Math.abs(cell[1] - enclosingCell[1]) <= 0.5
      && Math.abs(cell[2] - enclosingCell[2]) <= 0.5
      && cell[3] < enclosingCell[3] - 3
    ));
    if (!hasReplacementTopSpan) {
      return table;
    }
    return table.filter((cell) => cell !== enclosingCell);
  }

  return tables
    .map((table) => dropRedundantOuterTopSpan(table))
    .filter((table) => {
      const x1Values = new Set(table.map((cell) => round(cell[2], 3)));
      const x0Values = new Set(table.map((cell) => round(cell[0], 3)));
      if (x1Values.size < 2 || x0Values.size < 2) {
        return false;
      }
      const bbox = mergeBboxes(table);
      return page.getTextbox(bbox).trim().length > 0;
    })
    .sort((left, right) => {
      const leftCorner = left.reduce((min, cell) => (
        cell[1] < min[1] || (cell[1] === min[1] && cell[0] < min[0]) ? [cell[0], cell[1]] : min
      ), [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
      const rightCorner = right.reduce((min, cell) => (
        cell[1] < min[1] || (cell[1] === min[1] && cell[0] < min[0]) ? [cell[0], cell[1]] : min
      ), [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
      return leftCorner[1] - rightCorner[1] || leftCorner[0] - rightCorner[0];
    });
}

function pathItemsToEdges(drawing, clipRect, tolerance = DEFAULT_SNAP_TOLERANCE) {
  const segments = [];
  const lineItems = (drawing.items || []).filter((item) => item[0] === 'l');
  if (!lineItems.length) {
    return [];
  }
  for (const [, startPoint, endPoint] of lineItems) {
    segments.push([startPoint, endPoint]);
  }
  if (drawing.closePath && lineItems.length >= 2) {
    const firstPoint = lineItems[0][1];
    const lastPoint = lineItems.at(-1)[2];
    segments.push([lastPoint, firstPoint]);
  }

  return segments
    .map(([startPoint, endPoint]) => {
      const dx = Math.abs(Number(startPoint.x) - Number(endPoint.x));
      const dy = Math.abs(Number(startPoint.y) - Number(endPoint.y));
      if (dx > tolerance && dy > tolerance) {
        return null;
      }
      let x0 = Math.min(Number(startPoint.x), Number(endPoint.x));
      let x1 = Math.max(Number(startPoint.x), Number(endPoint.x));
      let y0 = Math.min(Number(startPoint.y), Number(endPoint.y));
      let y1 = Math.max(Number(startPoint.y), Number(endPoint.y));
      if (x0 > clipRect.x1 || x1 < clipRect.x0 || y0 > clipRect.y1 || y1 < clipRect.y0) {
        return null;
      }
      x0 = Math.max(x0, clipRect.x0);
      x1 = Math.min(x1, clipRect.x1);
      y0 = Math.max(y0, clipRect.y0);
      y1 = Math.min(y1, clipRect.y1);
      if (dx <= tolerance) {
        const x = round((x0 + x1) / 2, 3);
        return makeTableEdge({ x0: x, x1: x, top: y0, bottom: y1, object_type: 'line', orientation: 'v' });
      }
      if (dy <= tolerance) {
        const y = round((y0 + y1) / 2, 3);
        return makeTableEdge({ x0, x1, top: y, bottom: y, object_type: 'line', orientation: 'h' });
      }
      return null;
    })
    .filter(Boolean);
}

function makeBoxEdges(rect) {
  return [
    makeTableEdge({ x0: rect.x0, x1: rect.x1, top: rect.y0, bottom: rect.y0, object_type: 'line', orientation: 'h' }),
    makeTableEdge({ x0: rect.x0, x1: rect.x1, top: rect.y1, bottom: rect.y1, object_type: 'line', orientation: 'h' }),
    makeTableEdge({ x0: rect.x0, x1: rect.x0, top: rect.y0, bottom: rect.y1, object_type: 'line', orientation: 'v' }),
    makeTableEdge({ x0: rect.x1, x1: rect.x1, top: rect.y0, bottom: rect.y1, object_type: 'line', orientation: 'v' }),
  ];
}

function charsFromRawDict(rawDict, pageHeight) {
  const chars = [];
  for (const block of rawDict?.blocks || []) {
    for (const line of block.lines || []) {
      for (const span of line.spans || []) {
        for (const char of span.chars || []) {
          const bbox = rectFromMuPdf(char.bbox);
          chars.push({
            x0: bbox.x0,
            x1: bbox.x1,
            y0: round(pageHeight - bbox.y1),
            y1: round(pageHeight - bbox.y0),
            c: char.c,
          });
        }
      }
    }
  }
  return chars;
}

function charsInRect(chars, rect) {
  return chars.some((char) => (
    rect.x0 <= char.x0
    && char.x1 <= rect.x1
    && rect.y0 <= char.y0
    && rect.y1 >= char.y1
  ));
}

function cleanGraphics(pageAdapter, drawings, clipRect, settings) {
  const linesStrict = settings.vertical_strategy === 'lines_strict'
    || settings.horizontal_strategy === 'lines_strict';
  const allPaths = drawings.filter((drawing) => rectInside(rectFromMuPdf(drawing.rect), clipRect));
  const paths = allPaths.filter((drawing) => !(
    linesStrict
    && drawing.type === 'f'
    && rectWidth(drawing.rect) > settings.snap_x_tolerance
    && rectHeight(drawing.rect) > settings.snap_y_tolerance
  ));
  const chars = charsFromRawDict(pageAdapter.getText('rawdict'), pageAdapter.rect.height);
  const rectKeys = new Set();
  const pendingRects = [];
  for (const drawing of paths) {
    const rect = rectFromMuPdf(drawing.rect);
    const key = rectToArray(rect).map((value) => round(value, 3)).join(':');
    if (rectKeys.has(key)) {
      continue;
    }
    rectKeys.add(key);
    pendingRects.push(rect);
  }
  pendingRects.sort((left, right) => left.y1 - right.y1 || left.x0 - right.x0);
  const clusterRects = [];
  while (pendingRects.length > 0) {
    let clusterRect = { ...pendingRects[0] };
    pendingRects.shift();
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pendingRects.length - 1; index >= 0; index -= 1) {
        if (!areNeighborRects(clusterRect, pendingRects[index], settings.snap_x_tolerance, settings.snap_y_tolerance)) {
          continue;
        }
        clusterRect = rectUnion([clusterRect, pendingRects[index]]);
        pendingRects.splice(index, 1);
        changed = true;
      }
    }
    if (charsInRect(chars, clusterRect)) {
      clusterRects.push(clusterRect);
    }
  }
  return { bboxes: clusterRects, paths };
}

function makeEdges(pageAdapter, drawings, clipRect, settings, words = []) {
  const { bboxes, paths } = cleanGraphics(pageAdapter, drawings, clipRect, settings);
  const pathEdges = paths.flatMap((drawing) => pathItemsToEdges(drawing, clipRect, settings.snap_x_tolerance));
  const clusterEdges = bboxes.flatMap((rect) => makeBoxEdges(rect));
  const explicitTextEdges = [];
  if (settings.vertical_strategy === 'text') {
    explicitTextEdges.push(...wordsToEdgesV(words, settings.min_words_vertical));
  }
  if (settings.horizontal_strategy === 'text') {
    explicitTextEdges.push(...wordsToEdgesH(words, settings.min_words_horizontal));
  }
  return filterEdges(
    mergeEdges(
      [...pathEdges, ...clusterEdges, ...explicitTextEdges],
      settings.snap_x_tolerance,
      settings.snap_y_tolerance,
      settings.join_x_tolerance,
      settings.join_y_tolerance,
    ),
    null,
    null,
    settings.edge_min_length,
  );
}

function buildPathItems(path, ctm) {
  const items = [];
  let currentPoint = null;
  let startPoint = null;
  let closePath = false;
  path.walk({
    moveTo(x, y) {
      currentPoint = transformPoint(ctm, x, y);
      startPoint = currentPoint;
    },
    lineTo(x, y) {
      const nextPoint = transformPoint(ctm, x, y);
      if (currentPoint) {
        items.push(['l', currentPoint, nextPoint]);
      }
      currentPoint = nextPoint;
    },
    curveTo(x1, y1, x2, y2, x3, y3) {
      const p1 = transformPoint(ctm, x1, y1);
      const p2 = transformPoint(ctm, x2, y2);
      const p3 = transformPoint(ctm, x3, y3);
      if (currentPoint) {
        items.push(['c', currentPoint, p1, p2, p3]);
      }
      currentPoint = p3;
    },
    closePath() {
      closePath = true;
      currentPoint = startPoint;
    },
  });
  return { items, closePath };
}

const ZERO_STROKE_STATE = new mupdf.StrokeState({
  lineWidth: 0,
  lineCap: 'Butt',
  lineJoin: 'Miter',
  miterLimit: 10,
});

function drawingRectFromItems(items) {
  const points = [];
  for (const item of items) {
    for (const point of item.slice(1)) {
      if (point && typeof point === 'object' && 'x' in point && 'y' in point) {
        points.push(point);
      }
    }
  }
  if (!points.length) {
    return null;
  }
  return makeRect(
    Math.min(...points.map((point) => Number(point.x))),
    Math.min(...points.map((point) => Number(point.y))),
    Math.max(...points.map((point) => Number(point.x))),
    Math.max(...points.map((point) => Number(point.y))),
  );
}

function buildDrawingEntry({ type, path, ctm, strokeState = null, color = null, fill = null, seqno }) {
  const effectiveStrokeState = type === 'f' ? ZERO_STROKE_STATE : strokeState;
  const { items, closePath } = buildPathItems(path, ctm);
  const rect = drawingRectFromItems(items) || rectFromMuPdf(path.getBounds(effectiveStrokeState, ctm));
  return {
    type,
    rect,
    items,
    closePath,
    color,
    fill,
    width: round(strokeState?.getLineWidth?.() || 0, 3),
    lineCap: strokeState?.getLineCap?.() ?? 0,
    lineJoin: strokeState?.getLineJoin?.() ?? 0,
    dashes: strokeState?.getDashes?.() || [],
    seqno,
  };
}

function buildStructuredPageData(page) {
  const structuredText = page.toStructuredText(STRUCTURED_TEXT_STYLE_OPTIONS);
  const blocks = [];
  const words = [];
  let currentBlock = null;
  let currentLine = null;
  let blockIndex = -1;
  let lineIndex = -1;

  function finalizeSpan() {
    if (!currentLine || !currentLine.currentSpan) {
      return;
    }
    const span = currentLine.currentSpan;
    span.text = span.chars.map((char) => char.c).join('');
    span.bbox = rectToArray(rectUnion(span.chars.map((char) => rectFromMuPdf(char.bbox))));
    currentLine.spans.push(span);
    currentLine.currentSpan = null;
  }

  function finalizeWord() {
    if (!currentLine || !currentLine.currentWordChars || currentLine.currentWordChars.length === 0) {
      return;
    }
    const chars = currentLine.currentWordChars;
    const bbox = rectUnion(chars.map((char) => rectFromMuPdf(char.bbox)));
    words.push([
      bbox.x0,
      bbox.y0,
      bbox.x1,
      bbox.y1,
      chars.map((char) => char.c).join(''),
      blockIndex,
      lineIndex,
      currentLine.wordIndex,
    ]);
    currentLine.wordIndex += 1;
    currentLine.currentWordChars = [];
    currentLine.lastWordCharRtl = null;
  }

  function finalizeLine() {
    if (!currentLine || !currentBlock) {
      return;
    }
    finalizeSpan();
    finalizeWord();
    currentLine.bbox = rectToArray(rectUnion(currentLine.spans.map((span) => rectFromMuPdf(span.bbox))));
    currentBlock.lines.push({
      bbox: currentLine.bbox,
      wmode: currentLine.wmode,
      dir: currentLine.dir,
      spans: currentLine.spans.map((span) => ({
        bbox: span.bbox,
        text: span.text,
        font: span.font,
        size: span.size,
        flags: span.flags,
        color: span.color,
        ascender: 0,
        descender: 0,
        origin: span.origin,
        chars: span.chars,
      })),
    });
    currentLine = null;
  }

  function finalizeBlock() {
    if (!currentBlock) {
      return;
    }
    finalizeLine();
    currentBlock.bbox = rectToArray(rectUnion(currentBlock.lines.map((line) => rectFromMuPdf(line.bbox))));
    blocks.push({
      type: 0,
      bbox: currentBlock.bbox,
      lines: currentBlock.lines,
    });
    currentBlock = null;
  }

  structuredText.walk({
    beginTextBlock() {
      finalizeBlock();
      blockIndex += 1;
      lineIndex = -1;
      currentBlock = {
        lines: [],
      };
    },
    beginLine(bbox, wmode, direction) {
      finalizeLine();
      lineIndex += 1;
      currentLine = {
        bbox: rectToArray(rectFromMuPdf(bbox)),
        wmode,
        dir: lineDirectionValue(direction),
        spans: [],
        currentSpan: null,
        currentWordChars: [],
        wordIndex: 0,
        lastWordCharRtl: null,
      };
    },
    onChar(c, origin, font, size, quad, color) {
      if (!currentLine) {
        return;
      }
      const normalizedChar = normalizeStructuredTextChar(c);
      const bbox = bboxFromQuad(quad);
      const flags = fontFlags(font);
      const styleKey = JSON.stringify({
        font: normalizeFontName(font?.getName?.()),
        size: round(size, 3),
        flags,
        color: colorToInt(color),
      });
      if (!currentLine.currentSpan || currentLine.currentSpan.styleKey !== styleKey) {
        finalizeSpan();
        currentLine.currentSpan = {
          styleKey,
          font: normalizeFontName(font?.getName?.()),
          size: round(size, 3),
          flags,
          color: colorToInt(color),
          origin: [round(Number(origin?.x || 0)), round(Number(origin?.y || 0))],
          chars: [],
          text: '',
          bbox: [0, 0, 0, 0],
        };
      }
      const charPayload = {
        origin: [round(Number(origin?.x || 0)), round(Number(origin?.y || 0))],
        bbox: rectToArray(bbox),
        c: normalizedChar,
      };
      currentLine.currentSpan.chars.push(charPayload);
      const thisCharRtl = isRtlWordChar(normalizedChar);
      if (isWordSeparatorChar(normalizedChar)) {
        finalizeWord();
      } else if (
        currentLine.currentWordChars.length > 0
        && currentLine.lastWordCharRtl !== null
        && thisCharRtl !== currentLine.lastWordCharRtl
      ) {
        finalizeWord();
        currentLine.currentWordChars.push(charPayload);
        currentLine.lastWordCharRtl = thisCharRtl;
      } else {
        currentLine.currentWordChars.push(charPayload);
        currentLine.lastWordCharRtl = thisCharRtl;
      }
    },
    endLine() {
      finalizeLine();
    },
    endTextBlock() {
      finalizeBlock();
    },
  });
  finalizeBlock();

  const pageRect = rectFromMuPdf(page.getBounds());
  return {
    width: rectWidth(pageRect),
    height: rectHeight(pageRect),
    blocks,
    words: words.sort(sortWordsForLine),
  };
}

function buildTextboxFromWords(words, clipRect) {
  const selected = words.filter((word) => {
    const wordRect = makeRect(word[0], word[1], word[2], word[3]);
    return rectIntersects(wordRect, clipRect);
  });
  if (selected.length === 0) {
    return '';
  }
  const lines = new Map();
  for (const word of selected) {
    const key = `${word[5]}:${word[6]}`;
    if (!lines.has(key)) {
      lines.set(key, []);
    }
    lines.get(key).push(word);
  }
  return [...lines.entries()]
    .sort((left, right) => {
      const [leftBlock, leftLine] = left[0].split(':').map(Number);
      const [rightBlock, rightLine] = right[0].split(':').map(Number);
      if (leftBlock !== rightBlock) {
        return leftBlock - rightBlock;
      }
      return leftLine - rightLine;
    })
    .map(([, lineWords]) => [...lineWords].sort(sortWordsForLine).map((word) => word[4]).join(' '))
    .join('\n')
    .trim();
}

function buildTextboxFromRawDict(blocks, clipRect) {
  const selectedLines = [];
  for (const block of blocks || []) {
    for (const line of block.lines || []) {
      const lineTextParts = [];
      for (const span of line.spans || []) {
        const chars = (span.chars || []).filter((char) => {
          const bbox = rectFromMuPdf(char.bbox);
          return rectIntersects(bbox, clipRect);
        });
        if (!chars.length) {
          continue;
        }
        lineTextParts.push(chars.map((char) => char.c).join(''));
      }
      const lineText = lineTextParts.join('');
      if (!lineText) {
        continue;
      }
      selectedLines.push({
        text: lineText,
      });
    }
  }
  return selectedLines
    .map((line) => line.text)
    .join('\n')
    .trim();
}

function normalizeWords(words) {
  return words.map((word, index) => ({
    bbox: makeRect(word[0], word[1], word[2], word[3]),
    text: String(word[4] || ''),
    blockNo: Number(word[5] || 0),
    lineNo: Number(word[6] || 0),
    wordNo: Number(word[7] ?? index),
  }));
}

function collectLikelyTableFillBands(drawings, pageWidth) {
  const rawBands = drawings
    .filter((drawing) => drawing?.type === 'f' && drawing.rect && Array.isArray(drawing.fill))
    .filter((drawing) => {
      const width = rectWidth(drawing.rect);
      const height = rectHeight(drawing.rect);
      if (width < pageWidth * 0.15 || width > pageWidth * 0.92) {
        return false;
      }
      if (height < 8 || height > 28) {
        return false;
      }
      const color = drawing.fill.slice(0, 3).map((value) => Number(value || 0));
      return Math.min(...color) < 0.9;
    })
    .sort((left, right) => sortRectsTopLeft(left.rect, right.rect));

  const collapsed = [];
  for (const band of rawBands) {
    const current = collapsed.at(-1);
    if (
      current
      && Math.abs(current.rect.y0 - band.rect.y0) <= 1.5
      && Math.abs(current.rect.y1 - band.rect.y1) <= 1.5
    ) {
      current.rect = rectUnion([current.rect, band.rect]);
      current.sources.push(band);
      continue;
    }
    collapsed.push({
      rect: { ...band.rect },
      fill: band.fill,
      seqno: band.seqno,
      sources: [band],
    });
  }

  return collapsed;
}

function groupTableBandsIntoRegions(bands, pageWidth) {
  if (bands.length === 0) {
    return [];
  }
  const regions = [];
  let current = {
    bands: [bands[0]],
    rect: { ...bands[0].rect },
  };
  for (const band of bands.slice(1)) {
    const yGap = band.rect.y0 - current.rect.y1;
    const sameSection = yGap <= 10;
    const xShift = band.rect.x0 - current.rect.x0;
    const widthShrink = rectWidth(band.rect) < rectWidth(current.rect) * 0.8;
    const nestedRight = band.rect.x1 <= current.rect.x1 + pageWidth * 0.05;
    const rightShiftedSubtable = (
      sameSection
      && xShift > pageWidth * 0.18
      && widthShrink
      && nestedRight
    );
    const separatedPeerTable = (
      sameSection
      && xShift > pageWidth * 0.18
      && horizontalGap(current.rect, band.rect) > 4
    );
    const startsNewRegion = yGap > 10 || rightShiftedSubtable || separatedPeerTable;
    if (!startsNewRegion) {
      current.bands.push(band);
      current.rect = rectUnion([current.rect, band.rect]);
      continue;
    }
    regions.push(current);
    current = {
      bands: [band],
      rect: { ...band.rect },
    };
  }
  regions.push(current);
  return regions;
}

function collectWordsForRegion(words, regionRect) {
  return words.filter((word) => {
    const wordRect = word.bbox;
    const center = { x: rectCenterX(wordRect), y: rectCenterY(wordRect) };
    return (
      rectContainsPoint(regionRect, center)
      || rectInside(wordRect, regionRect)
      || rectIntersectionArea(wordRect, regionRect) >= area(wordRect) * 0.55
    );
  });
}

function area(rect) {
  return rectWidth(rect) * rectHeight(rect);
}

function rectIou(left, right) {
  const intersection = rectIntersectionArea(left, right);
  if (intersection <= 0) {
    return 0;
  }
  const union = area(left) + area(right) - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function rectOverlapOnSmaller(left, right) {
  const intersection = rectIntersectionArea(left, right);
  if (intersection <= 0) {
    return 0;
  }
  const denominator = Math.max(1, Math.min(area(left), area(right)));
  return intersection / denominator;
}

function unionRectArea(rects) {
  if (!rects.length) {
    return 0;
  }
  const xs = [...new Set(rects.flatMap((rect) => [rect.x0, rect.x1]))].sort((left, right) => left - right);
  let total = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const x0 = xs[index];
    const x1 = xs[index + 1];
    if (x1 <= x0) {
      continue;
    }
    const spans = rects
      .filter((rect) => rect.x0 < x1 && rect.x1 > x0)
      .map((rect) => [rect.y0, rect.y1])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    if (!spans.length) {
      continue;
    }
    let [currentTop, currentBottom] = spans[0];
    let coveredHeight = 0;
    for (const [top, bottom] of spans.slice(1)) {
      if (top <= currentBottom) {
        currentBottom = Math.max(currentBottom, bottom);
      } else {
        coveredHeight += currentBottom - currentTop;
        currentTop = top;
        currentBottom = bottom;
      }
    }
    coveredHeight += currentBottom - currentTop;
    total += (x1 - x0) * coveredHeight;
  }
  return total;
}

function rectCoverageByRects(target, rects) {
  const clipped = rects
    .map((rect) => {
      const x0 = Math.max(target.x0, rect.x0);
      const y0 = Math.max(target.y0, rect.y0);
      const x1 = Math.min(target.x1, rect.x1);
      const y1 = Math.min(target.y1, rect.y1);
      if (x1 <= x0 || y1 <= y0) {
        return null;
      }
      return makeRect(x0, y0, x1, y1);
    })
    .filter(Boolean);
  if (!clipped.length) {
    return 0;
  }
  return unionRectArea(clipped) / Math.max(1, area(target));
}

function buildWordRows(words) {
  const grouped = new Map();
  for (const word of words) {
    const key = `${word.blockNo}:${word.lineNo}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(word);
  }

  return [...grouped.values()]
    .map((rowWords) => {
      const ordered = [...rowWords].sort((left, right) => left.wordNo - right.wordNo);
      const bbox = rectUnion(ordered.map((word) => word.bbox));
      const text = ordered.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim();
      return {
        words: ordered,
        bbox,
        text,
        direction: inferTextDirection(text),
      };
    })
    .filter((row) => row.text)
    .sort((left, right) => sortRectsTopLeft(left.bbox, right.bbox));
}

function buildRowCells(row) {
  const rowHeight = Math.max(1, rectHeight(row.bbox));
  const gapThreshold = Math.max(12, rowHeight * 2.4);
  const ordered = [...row.words].sort((left, right) => (
    row.direction === 'RTL'
      ? right.bbox.x0 - left.bbox.x0
      : left.bbox.x0 - right.bbox.x0
  ));
  const groups = [];
  let current = [ordered[0]];
  for (const word of ordered.slice(1)) {
    const previous = current[current.length - 1];
    const gap = horizontalGap(previous.bbox, word.bbox);
    if (gap > gapThreshold) {
      groups.push(current);
      current = [word];
      continue;
    }
    current.push(word);
  }
  groups.push(current);
  return groups.map((group) => rectToArray(rectUnion(group.map((word) => word.bbox))));
}

function cellsFromRegionWords(regionRect, words) {
  const rows = buildWordRows(words)
    .filter((row) => rectIntersectionArea(row.bbox, regionRect) > 0);
  if (rows.length === 0) {
    return [];
  }
  return rows.flatMap((row) => buildRowCells(row));
}

function intersectsWordsHorizontally(bbox, y, words) {
  return words.some((word) => rectInside(word.bbox, bbox) && word.bbox.y0 < y && y < word.bbox.y1);
}

function cellsFromNativeTableDict(tableDict, words) {
  if (!tableDict || Number(tableDict.type) !== 4 || !Array.isArray(tableDict.xpos) || !Array.isArray(tableDict.ypos)) {
    return [];
  }

  const bbox = rectFromMuPdf(tableDict.bbox);
  const xpos = tableDict.xpos
    .map((entry) => [Number(entry?.[0] ?? 0), Number(entry?.[1] ?? 0)])
    .sort((left, right) => left[0] - right[0]);
  const ypos = tableDict.ypos
    .map((entry) => [Number(entry?.[0] ?? 0), Number(entry?.[1] ?? 0)])
    .sort((left, right) => left[0] - right[0]);

  const nypos = [];
  for (const [y, yUncertainty] of ypos) {
    if (yUncertainty > 0) {
      continue;
    }
    if (intersectsWordsHorizontally(bbox, y, words)) {
      continue;
    }
    if (nypos.length > 0 && y - nypos[nypos.length - 1] < 3) {
      nypos[nypos.length - 1] = y;
    } else {
      nypos.push(y);
    }
  }

  if (nypos.length < 2) {
    return [];
  }

  const yMaxUncertainty = Math.max(0, Math.round((nypos.length - 2) * 0.35));
  const nxpos = xpos
    .filter((entry) => entry[1] <= yMaxUncertainty)
    .map((entry) => entry[0]);

  if (nxpos.length < 2) {
    return [];
  }

  if (bbox.x0 < nxpos[0] - 3) {
    nxpos.unshift(bbox.x0);
  }
  if (bbox.x1 > nxpos[nxpos.length - 1] + 3) {
    nxpos.push(bbox.x1);
  }

  const cells = [];
  for (let rowIndex = 0; rowIndex < nypos.length - 1; rowIndex += 1) {
    const rowBox = makeRect(bbox.x0, nypos[rowIndex], bbox.x1, nypos[rowIndex + 1]);
    const rowWords = words
      .filter((word) => rectInside(word.bbox, rowBox))
      .sort((left, right) => left.bbox.x0 - right.bbox.x0);
    const usableX = nxpos.filter((x) => !rowWords.some((word) => word.bbox.x0 < x && x < word.bbox.x1));
    for (let columnIndex = 0; columnIndex < usableX.length - 1; columnIndex += 1) {
      const cell = makeRect(usableX[columnIndex], nypos[rowIndex], usableX[columnIndex + 1], nypos[rowIndex + 1]);
      if (!mupdf.Rect.isEmpty(rectToArray(cell))) {
        cells.push(rectToArray(cell));
      }
    }
  }

  return dedupeCells(cells);
}

function dedupeCells(cells) {
  const seen = new Set();
  const deduped = [];
  for (const cell of cells) {
    const key = cell.map((value) => round(value, 2)).join(':');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(cell);
  }
  return deduped;
}

class CellGroup {
  constructor(cells) {
    this.cells = cells;
    const present = cells.filter(Boolean);
    this.bbox = present.length > 0
      ? rectToArray(rectUnion(present.map((cell) => rectFromMuPdf(cell))))
      : [0, 0, 0, 0];
  }
}

class MuPdfTwinTableRow extends CellGroup {
  constructor(cells) {
    super(cells);
  }
}

class MuPdfTwinTableHeader {
  constructor(bbox, cells, names, external = false) {
    this.bbox = bbox;
    this.cells = cells;
    this.names = names;
    this.external = external;
  }
}

class MuPdfTwinTable {
  constructor(page, cells) {
    this.page = page;
    this.cells = dedupeCells(cells);
    this.header = new MuPdfTwinTableHeader(this.bbox, [], [], false);
  }

  get bbox() {
    return rectToArray(rectUnion(this.cells.map((cell) => rectFromMuPdf(cell))));
  }

  get rows() {
    const ordered = [...this.cells].sort((left, right) => {
      const leftRect = rectFromMuPdf(left);
      const rightRect = rectFromMuPdf(right);
      return sortRectsTopLeft(leftRect, rightRect);
    });
    const xStarts = [...new Set(ordered.map((cell) => round(cell[0], 2)))].sort((left, right) => left - right);
    const grouped = new Map();
    for (const cell of ordered) {
      const key = round(cell[1], 2);
      if (!grouped.has(key)) {
        grouped.set(key, new Map());
      }
      grouped.get(key).set(round(cell[0], 2), cell);
    }
    return [...grouped.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, rowCells]) => new MuPdfTwinTableRow(xStarts.map((x0) => rowCells.get(x0) || null)));
  }

  get row_count() {
    return this.rows.length;
  }

  get col_count() {
    return Math.max(...this.rows.map((row) => row.cells.length), 0);
  }
}

class MuPdfTwinTableFinder {
  constructor(page, tables) {
    this.page = page;
    this.tables = tables;
  }

  get length() {
    return this.tables.length;
  }

  [Symbol.iterator]() {
    return this.tables[Symbol.iterator]();
  }

  at(index) {
    return this.tables.at(index);
  }
}

class MuPdfTwinTableSettings {
  constructor(settings = {}) {
    this.vertical_strategy = settings.vertical_strategy || settings.strategy || 'lines';
    this.horizontal_strategy = settings.horizontal_strategy || settings.strategy || 'lines';
    this.snap_tolerance = Number(settings.snap_tolerance ?? DEFAULT_SNAP_TOLERANCE);
    this.snap_x_tolerance = Number(settings.snap_x_tolerance ?? this.snap_tolerance);
    this.snap_y_tolerance = Number(settings.snap_y_tolerance ?? this.snap_tolerance);
    this.join_tolerance = Number(settings.join_tolerance ?? DEFAULT_JOIN_TOLERANCE);
    this.join_x_tolerance = Number(settings.join_x_tolerance ?? this.join_tolerance);
    this.join_y_tolerance = Number(settings.join_y_tolerance ?? this.join_tolerance);
    this.edge_min_length = Number(settings.edge_min_length ?? DEFAULT_EDGE_MIN_LENGTH);
    this.min_words_vertical = Number(settings.min_words_vertical ?? DEFAULT_MIN_WORDS_VERTICAL);
    this.min_words_horizontal = Number(settings.min_words_horizontal ?? DEFAULT_MIN_WORDS_HORIZONTAL);
    this.intersection_tolerance = Number(settings.intersection_tolerance ?? DEFAULT_INTERSECTION_TOLERANCE);
    this.intersection_x_tolerance = Number(settings.intersection_x_tolerance ?? this.intersection_tolerance);
    this.intersection_y_tolerance = Number(settings.intersection_y_tolerance ?? this.intersection_tolerance);
  }

  static resolve(settings = null) {
    if (settings instanceof MuPdfTwinTableSettings) {
      return settings;
    }
    return new MuPdfTwinTableSettings(settings || {});
  }
}

export class MuPdfTwinPageAdapter {
  constructor(page, options = {}) {
    this.page = page;
    this.pageIndex = Number(options.pageIndex || 0);
    this._structuredData = null;
    this._imageResources = null;
    this.layout_information = null;
    this.table_settings = null;
    const pageRect = this._pageRect();
    this.rect = {
      ...pageRect,
      width: rectWidth(pageRect),
      height: rectHeight(pageRect),
    };
  }

  destroy() {
    this.page?.destroy?.();
  }

  _pageRect() {
    return rectFromMuPdf(this.page.getBounds());
  }

  _structuredPageData() {
    if (!this._structuredData) {
      this._structuredData = buildStructuredPageData(this.page);
    }
    return this._structuredData;
  }

  toDisplayList(showExtras = true) {
    return this.page.toDisplayList(showExtras);
  }

  toStructuredText(options = '') {
    return this.page.toStructuredText(options);
  }

  toPixmap(options = {}) {
    const matrix = options.matrix || mupdf.Matrix.identity;
    const colorspace = options.colorspace || mupdf.ColorSpace.DeviceRGB;
    const alpha = Boolean(options.alpha);
    const showExtras = options.showExtras !== false;
    return this.page.toPixmap(matrix, colorspace, alpha, showExtras);
  }

  getText(mode, options = {}) {
    const normalizedMode = String(mode || 'text').toLowerCase();
    const data = this._structuredPageData();
    if (normalizedMode === 'words') {
      return data.words.map((word) => [...word]);
    }
    if (normalizedMode === 'rawdict') {
      return {
        width: round(data.width, 3),
        height: round(data.height, 3),
        blocks: data.blocks.map((block) => JSON.parse(JSON.stringify(block))),
      };
    }
    if (normalizedMode === 'dict') {
      return {
        width: round(data.width, 3),
        height: round(data.height, 3),
        blocks: data.blocks.map((block) => ({
          type: block.type,
          bbox: [...block.bbox],
          lines: block.lines.map((line) => ({
            bbox: [...line.bbox],
            wmode: line.wmode,
            dir: [...line.dir],
            spans: line.spans.map((span) => ({
              bbox: [...span.bbox],
              text: span.text,
              font: span.font,
              size: span.size,
              flags: span.flags,
              color: span.color,
              ascender: span.ascender,
              descender: span.descender,
              origin: [...span.origin],
            })),
          })),
        })),
      };
    }
    if (normalizedMode === 'text') {
      return data.words.map((word) => word[4]).join(' ').trim();
    }
    throw new Error(`Unsupported getText mode: ${mode}`);
  }

  get_text(mode, options = {}) {
    return this.getText(mode, options);
  }

  getTextbox(rect, options = {}) {
    const clipRect = rectFromMuPdf(rect);
    const rawDict = this.getText('rawdict', options);
    return buildTextboxFromRawDict(rawDict.blocks || [], clipRect);
  }

  get_textbox(rect, options = {}) {
    return this.getTextbox(rect, options);
  }

  getDrawings(options = {}) {
    const clipRect = options.clip ? rectFromMuPdf(options.clip) : null;
    const drawings = [];
    let seqno = 0;
    const device = new mupdf.Device({
      fillPath: (path, evenOdd, ctm, colorspace, color) => {
        const entry = buildDrawingEntry({
          type: 'f',
          path,
          ctm,
          color: null,
          fill: Array.isArray(color) ? color.slice(0, 4).map((value) => round(value, 4)) : null,
          seqno: seqno++,
        });
        if (!clipRect || rectInside(entry.rect, clipRect) || rectIntersects(entry.rect, clipRect)) {
          entry.evenOdd = Boolean(evenOdd);
          drawings.push(entry);
        }
      },
      strokePath: (path, strokeState, ctm, colorspace, color) => {
        const entry = buildDrawingEntry({
          type: 's',
          path,
          ctm,
          strokeState,
          color: Array.isArray(color) ? color.slice(0, 4).map((value) => round(value, 4)) : null,
          fill: null,
          seqno: seqno++,
        });
        if (!clipRect || rectInside(entry.rect, clipRect) || rectIntersects(entry.rect, clipRect)) {
          drawings.push(entry);
        }
      },
    });
    try {
      this.page.run(device, mupdf.Matrix.identity);
    } finally {
      device.close();
      device.destroy();
    }
    return drawings;
  }

  get_drawings(options = {}) {
    return this.getDrawings(options);
  }

  getImageResources() {
    if (this._imageResources !== null) {
      return this._imageResources.map((entry) => ({ ...entry }));
    }
    const images = collectPdfResourceImages(this.page);
    this._imageResources = Array.isArray(images) ? images : [];
    return this._imageResources.map((entry) => ({ ...entry }));
  }

  getImageBlocks() {
    const resourceSignatures = new Set(this.getImageResources().map((entry) => entry.signature));
    return collectRenderedImageRects(this.page, resourceSignatures).map((rect) => rectToArray(rect));
  }

  get_images(_full = false) {
    return this.getImageResources().map((entry) => ([
      entry.xref ?? 0,
      0,
      entry.width ?? 0,
      entry.height ?? 0,
      entry.bitsPerComponent ?? 0,
      '',
      '',
      entry.name ?? '',
    ]));
  }

  get_image_rects(xref) {
    const resources = this.getImageResources();
    const target = resources.find((entry) => xrefKey(entry.xref) === xrefKey(xref));
    if (!target) {
      return [];
    }
    return collectRenderedImageRects(this.page, new Set([target.signature])).map((rect) => ({
      ...rect,
      is_empty: rectWidth(rect) <= 0 || rectHeight(rect) <= 0,
      is_infinite: false,
    }));
  }

  clusterDrawings(options = {}) {
    const clipRect = options.clip ? rectFromMuPdf(options.clip) : this._pageRect();
    const xTolerance = Number(options.x_tolerance ?? options.xTolerance ?? 3);
    const yTolerance = Number(options.y_tolerance ?? options.yTolerance ?? 3);
    const finalFilter = options.final_filter !== false;
    const drawings = options.drawings || this.getDrawings({ clip: clipRect });
    const rects = drawings
      .map((drawing) => rectFromMuPdf(drawing.rect))
      .filter((rect) => rectInside(rect, clipRect))
      .sort(sortRectsTopLeft);

    const clusters = [];
    const pending = [...rects];
    while (pending.length > 0) {
      let clusterRect = { ...pending[0] };
      pending.shift();
      let changed = true;
      while (changed) {
        changed = false;
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          if (!areNeighborRects(clusterRect, pending[index], xTolerance, yTolerance)) {
            continue;
          }
          clusterRect = rectUnion([clusterRect, pending[index]]);
          pending.splice(index, 1);
          changed = true;
        }
      }
      clusters.push(clusterRect);
    }

    return clusters.filter((rect) => {
      if (!finalFilter) {
        return true;
      }
      return rectWidth(rect) > xTolerance && rectHeight(rect) > yTolerance;
    });
  }

  _findNativeTableWithinBounds(rect) {
    const structuredText = this.page.toStructuredText(STRUCTURED_TEXT_STYLE_OPTIONS);
    try {
      if (typeof structuredText.findTableWithinBounds !== 'function') {
        return null;
      }
      return structuredText.findTableWithinBounds(rectToArray(rect)) || {};
    } finally {
      structuredText.destroy?.();
    }
  }

  findTables(options = {}) {
    const settings = MuPdfTwinTableSettings.resolve(options);
    const words = normalizeWords(this.getText('words'));
    const drawings = this.getDrawings();
    const pageRect = this._pageRect();
    const edges = makeEdges(this, drawings, pageRect, settings, words);
    const intersections = edgesToIntersections(
      edges,
      settings.intersection_x_tolerance,
      settings.intersection_y_tolerance,
    );
    const cells = intersectionsToCells(intersections);
    const edgeTables = cellsToTables(this, cells).map((tableCells) => new MuPdfTwinTable(this, tableCells));
    const tables = [...edgeTables];

    tables.sort((left, right) => {
      const leftRect = rectFromMuPdf(left.bbox);
      const rightRect = rectFromMuPdf(right.bbox);
      return leftRect.y0 - rightRect.y0 || leftRect.x0 - rightRect.x0;
    });

    const finder = new MuPdfTwinTableFinder(this, tables);
    finder.edges = edges;
    finder.intersections = intersections;
    finder.cells = cells;
    this.table_settings = settings;
    return finder;
  }

  find_tables(options = {}) {
    return this.findTables(options);
  }

  getLayoutInfo() {
    const tables = this.findTables().tables;
    this.layout_information = tables.length > 0
      ? tables.map((table) => [...table.bbox, 'table'])
      : [];
    return this.layout_information;
  }

  getLayout() {
    return this.getLayoutInfo();
  }
}

export class MuPdfTwinDocumentAdapter {
  constructor(document) {
    this.document = document;
  }

  destroy() {
    this.document?.destroy?.();
  }

  close() {
    this.destroy();
  }

  countPages() {
    return this.document.countPages();
  }

  loadPage(index) {
    return new MuPdfTwinPageAdapter(this.document.loadPage(index), { pageIndex: index });
  }
}

export function openMuPdfTwinDocument(pdfData, magic = 'application/pdf') {
  return new MuPdfTwinDocumentAdapter(mupdf.Document.openDocument(pdfData, magic));
}

export const __testOnly = {
  collectLikelyTableFillBands,
  groupTableBandsIntoRegions,
  cleanGraphics,
  makeEdges,
  edgesToIntersections,
  intersectionsToCells,
  cellsToTables,
};
