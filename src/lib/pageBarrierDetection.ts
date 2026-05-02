/**
 * Horizontal barriers block left↔right merges. They are detected from vertical lines
 * on the page image. Data shape: { x, y1, y2 } — a vertical line at x spanning y1..y2.
 */
export type DetectedHorizontalBarrier = {
  barrier_id: string;
  x: number;
  y1: number;
  y2: number;
  score: number;
  kind: 'explicit_line' | 'vertical_edge' | 'hybrid';
};

/**
 * Vertical barriers block top↔bottom merges. They are detected from horizontal lines
 * on the page image. Data shape: { y, x1, x2 } — a horizontal line at y spanning x1..x2.
 */
export type DetectedVerticalBarrier = {
  barrier_id: string;
  y: number;
  x1: number;
  x2: number;
  score: number;
  kind: 'explicit_line' | 'vertical_edge' | 'hybrid';
};

type RawBarrierSegment = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  score: number;
  kind: 'explicit_line' | 'vertical_edge';
  supportPixels: number;
  metricSum: number;
};

const DEFAULT_MAX_DETECTION_DIMENSION_PX = 1600;
const DEFAULT_MIN_RUN_LENGTH_PX = 18;
const EXPLICIT_LINE_THRESHOLD = 232;
const EDGE_THRESHOLD = 56;
const EXPLICIT_LINE_MAX_GAP_PX = 3;
const EXPLICIT_LINE_SURROUND_RADIUS = 4;
const EXPLICIT_LINE_MIN_SURROUND_CONTRAST = 20;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function bboxToIntRegion(
  bbox: number[],
  widthPx: number,
  heightPx: number,
  pageWidthPt: number,
  pageHeightPt: number,
): [number, number, number, number] {
  const xScale = widthPx / Math.max(1, pageWidthPt);
  const yScale = heightPx / Math.max(1, pageHeightPt);
  const x0 = clamp(Math.floor(Number(bbox[0] || 0) * xScale), 0, widthPx);
  const y0 = clamp(Math.floor(Number(bbox[1] || 0) * yScale), 0, heightPx);
  const x1 = clamp(Math.ceil(Number(bbox[2] || 0) * xScale), 0, widthPx);
  const y1 = clamp(Math.ceil(Number(bbox[3] || 0) * yScale), 0, heightPx);
  return [x0, y0, x1, y1];
}

function overlapRatio(left: { y0: number; y1: number }, right: { y0: number; y1: number }): number {
  const overlap = Math.max(0, Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0));
  const minHeight = Math.max(1, Math.min(left.y1 - left.y0, right.y1 - right.y0));
  return overlap / minHeight;
}

function grayscaleFromImageData(imageData: ImageData): Float32Array {
  const { data } = imageData;
  const gray = new Float32Array(Math.max(1, data.length / 4));
  for (let index = 0, target = 0; index < data.length; index += 4, target += 1) {
    gray[target] = (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2]);
  }
  return gray;
}

function applyExcludedRegionsToGray(
  gray: Float32Array,
  {
    widthPx,
    heightPx,
    pageWidthPt,
    pageHeightPt,
    excludeBboxesPt = [],
  }: {
    widthPx: number;
    heightPx: number;
    pageWidthPt: number;
    pageHeightPt: number;
    excludeBboxesPt?: number[][];
  },
): Float32Array {
  if (!Array.isArray(excludeBboxesPt) || excludeBboxesPt.length === 0) {
    return gray;
  }
  const masked = new Float32Array(gray);
  for (const bbox of excludeBboxesPt) {
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      continue;
    }
    const [x0, y0, x1, y1] = bboxToIntRegion(
      bbox.map((value) => Number(value)),
      widthPx,
      heightPx,
      pageWidthPt,
      pageHeightPt,
    );
    if (x1 <= x0 || y1 <= y0) {
      continue;
    }
    for (let y = y0; y < y1; y += 1) {
      const rowOffset = y * widthPx;
      for (let x = x0; x < x1; x += 1) {
        masked[rowOffset + x] = 255;
      }
    }
  }
  return masked;
}

function extractColumnSegments(
  evidence: Uint8Array,
  metric: Float32Array,
  {
    width,
    height,
    minRunLengthPx,
    kind,
    maxGapPx = 0,
  }: {
    width: number;
    height: number;
    minRunLengthPx: number;
    kind: 'explicit_line' | 'vertical_edge';
    maxGapPx?: number;
  },
): RawBarrierSegment[] {
  const segments: RawBarrierSegment[] = [];
  for (let x = 1; x < (width - 1); x += 1) {
    let y = 0;
    while (y < height) {
      while (y < height && evidence[(y * width) + x] === 0) {
        y += 1;
      }
      if (y >= height) {
        break;
      }
      const y0 = y;
      let metricSum = 0;
      let supportPixels = 0;
      let gapPixels = 0;
      while (y < height) {
        const value = evidence[(y * width) + x];
        if (value !== 0) {
          metricSum += metric[(y * width) + x];
          supportPixels += 1;
          gapPixels = 0;
          y += 1;
          continue;
        }
        if (gapPixels >= maxGapPx) {
          break;
        }
        gapPixels += 1;
        y += 1;
      }
      const y1 = Math.max(y0, y - gapPixels);
      if ((y1 - y0) < minRunLengthPx || supportPixels <= 0) {
        continue;
      }
      segments.push({
        x0: x,
        x1: x + 1,
        y0,
        y1,
        score: 0,
        kind,
        supportPixels,
        metricSum,
      });
    }
  }
  return segments;
}

function mergeSegments(
  segments: RawBarrierSegment[],
  {
    mergeXGapPx,
    minOverlapRatio,
  }: {
    mergeXGapPx: number;
    minOverlapRatio: number;
  },
): RawBarrierSegment[] {
  const merged: RawBarrierSegment[] = [];
  const sorted = [...segments].sort((left, right) => (
    left.x0 - right.x0
    || left.y0 - right.y0
    || left.kind.localeCompare(right.kind)
  ));
  for (const segment of sorted) {
    let matched = false;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const current = merged[index];
      if ((segment.x0 - current.x1) > mergeXGapPx) {
        break;
      }
      if (segment.kind !== current.kind) {
        continue;
      }
      if (segment.x0 > (current.x1 + mergeXGapPx)) {
        continue;
      }
      if (overlapRatio(segment, current) < minOverlapRatio) {
        continue;
      }
      current.x0 = Math.min(current.x0, segment.x0);
      current.x1 = Math.max(current.x1, segment.x1);
      current.y0 = Math.min(current.y0, segment.y0);
      current.y1 = Math.max(current.y1, segment.y1);
      current.supportPixels += segment.supportPixels;
      current.metricSum += segment.metricSum;
      matched = true;
      break;
    }
    if (!matched) {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function scoreSegments(
  segments: RawBarrierSegment[],
  {
    width,
    height,
  }: {
    width: number;
    height: number;
  },
): RawBarrierSegment[] {
  return segments.map((segment) => {
    const spanHeight = Math.max(1, segment.y1 - segment.y0);
    const spanWidth = Math.max(1, segment.x1 - segment.x0);
    const density = segment.supportPixels / (spanWidth * spanHeight);
    const meanMetric = segment.metricSum / Math.max(1, segment.supportPixels);
    const heightRatio = spanHeight / Math.max(1, height);
    const metricRatio = clamp(meanMetric / 255, 0, 1);
    const densityRatio = segment.kind === 'explicit_line'
      ? clamp(density / 0.5, 0, 1)
      : clamp(density / 0.3, 0, 1);
    const score = clamp(
      (0.5 * clamp(heightRatio / 0.08, 0, 1))
      + (0.25 * densityRatio)
      + (0.25 * metricRatio),
      0,
      1,
    );
    return {
      ...segment,
      score,
    };
      }).filter((segment) => {
    const spanHeight = Math.max(1, segment.y1 - segment.y0);
    const spanWidth = Math.max(1, segment.x1 - segment.x0);
    const density = segment.supportPixels / (spanWidth * spanHeight);
    const meanMetric = segment.metricSum / Math.max(1, segment.supportPixels);
    if (segment.kind === 'explicit_line') {
      return spanWidth <= 10 && density >= 0.15 && meanMetric >= 0.045 * 255 && segment.score >= 0.2;
    }
    return spanWidth <= 8 && density >= 0.2 && meanMetric >= EDGE_THRESHOLD && segment.score >= 0.34;
  });
}

function combineKinds(segments: RawBarrierSegment[]): Array<DetectedHorizontalBarrier & { x0: number; x1: number }> {
  const combined: Array<RawBarrierSegment & { kinds: Set<'explicit_line' | 'vertical_edge'> }> = [];
  const sorted = [...segments].sort((left, right) => left.x0 - right.x0 || left.y0 - right.y0);
  for (const segment of sorted) {
    let matched = false;
    const centerX = (segment.x0 + segment.x1) / 2;
    for (let index = combined.length - 1; index >= 0; index -= 1) {
      const current = combined[index];
      const currentCenterX = (current.x0 + current.x1) / 2;
      if ((centerX - currentCenterX) > 4) {
        break;
      }
      if (Math.abs(centerX - currentCenterX) > 4) {
        continue;
      }
      if (overlapRatio(segment, current) < 0.45) {
        continue;
      }
      const totalScore = Math.max(0.01, current.score + segment.score);
      current.x0 = Math.min(current.x0, segment.x0);
      current.x1 = Math.max(current.x1, segment.x1);
      current.y0 = Math.min(current.y0, segment.y0);
      current.y1 = Math.max(current.y1, segment.y1);
      current.metricSum += segment.metricSum;
      current.supportPixels += segment.supportPixels;
      current.score = clamp(
        ((current.score * (totalScore - segment.score)) + (segment.score * segment.score)) / totalScore,
        0,
        1,
      );
      current.kinds.add(segment.kind);
      matched = true;
      break;
    }
    if (!matched) {
      combined.push({
        ...segment,
        kinds: new Set([segment.kind]),
      });
    }
  }
  return combined
    .map((segment, index) => {
      const centerX = (segment.x0 + segment.x1) / 2;
      const kind: DetectedHorizontalBarrier['kind'] = segment.kinds.size > 1
        ? 'hybrid'
        : [...segment.kinds][0];
      const boostedScore = clamp(segment.score + (segment.kinds.size > 1 ? 0.15 : 0), 0, 1);
      return {
        barrier_id: `barrier_${index + 1}`,
        x: centerX,
        y1: segment.y0,
        y2: segment.y1,
        score: boostedScore,
        kind,
        x0: segment.x0,
        x1: segment.x1,
      };
    })
    .filter((segment) => {
      if (segment.kind === 'explicit_line') {
        return segment.score >= 0.22;
      }
      return segment.score >= 0.34;
    })
    .sort((left, right) => left.x - right.x || left.y1 - right.y1);
}

/**
 * Core column-scanning function. Scans each column for vertical lines/edges
 * and returns horizontal barriers (barriers that block left↔right merges).
 */
function scanColumnsForHorizontalBarriers({
  gray,
  width,
  height,
  pageWidthPt,
  pageHeightPt,
  excludeBboxesPt = [],
  minRunLengthPx = DEFAULT_MIN_RUN_LENGTH_PX,
}: {
  gray: Float32Array;
  width: number;
  height: number;
  pageWidthPt: number;
  pageHeightPt: number;
  excludeBboxesPt?: number[][];
  minRunLengthPx?: number;
}): DetectedHorizontalBarrier[] {
  if (!(gray instanceof Float32Array) || width <= 0 || height <= 0) {
    return [];
  }
  const maskedGray = applyExcludedRegionsToGray(gray, {
    widthPx: width,
    heightPx: height,
    pageWidthPt,
    pageHeightPt,
    excludeBboxesPt,
  });
  const explicitEvidence = new Uint8Array(width * height);
  const explicitMetric = new Float32Array(width * height);
  const edgeEvidence = new Uint8Array(width * height);
  const edgeMetric = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 1; x < (width - 1); x += 1) {
      const index = rowOffset + x;
      const value = maskedGray[index];
      const leftValue = maskedGray[index - 1];
      const rightValue = maskedGray[index + 1];
      const explicitValue = Math.min(value, leftValue, rightValue);
      if (explicitValue <= EXPLICIT_LINE_THRESHOLD) {
        const farLeftIdx = Math.max(rowOffset, index - EXPLICIT_LINE_SURROUND_RADIUS);
        const farRightIdx = Math.min(rowOffset + width - 1, index + EXPLICIT_LINE_SURROUND_RADIUS);
        const farLeft = maskedGray[farLeftIdx];
        const farRight = maskedGray[farRightIdx];
        if (Math.max(farLeft, farRight) > explicitValue + EXPLICIT_LINE_MIN_SURROUND_CONTRAST) {
          explicitEvidence[index] = 1;
          explicitMetric[index] = clamp(255 - explicitValue, 0, 255);
        }
      }
      const leftMean = (leftValue + maskedGray[Math.max(rowOffset, index - 2)]) / 2;
      const rightMean = (rightValue + maskedGray[Math.min(rowOffset + width - 1, index + 2)]) / 2;
      const contrast = Math.abs(leftMean - rightMean);
      if (contrast >= EDGE_THRESHOLD) {
        edgeEvidence[index] = 1;
        edgeMetric[index] = contrast;
      }
    }
  }

  const explicitSegments = scoreSegments(
    mergeSegments(
      extractColumnSegments(explicitEvidence, explicitMetric, {
        width,
        height,
        minRunLengthPx,
        kind: 'explicit_line',
        maxGapPx: EXPLICIT_LINE_MAX_GAP_PX,
      }),
      { mergeXGapPx: 2, minOverlapRatio: 0.6 },
    ),
    { width, height },
  );
  const edgeSegments = scoreSegments(
    mergeSegments(
      extractColumnSegments(edgeEvidence, edgeMetric, {
        width,
        height,
        minRunLengthPx,
        kind: 'vertical_edge',
      }),
      { mergeXGapPx: 2, minOverlapRatio: 0.55 },
    ),
    { width, height },
  );

  return combineKinds([...explicitSegments, ...edgeSegments]).map((segment, index) => ({
    barrier_id: `barrier_${index + 1}`,
    x: roundTo((segment.x / Math.max(1, width)) * pageWidthPt, 2),
    y1: roundTo((segment.y1 / Math.max(1, height)) * pageHeightPt, 2),
    y2: roundTo((segment.y2 / Math.max(1, height)) * pageHeightPt, 2),
    score: roundTo(segment.score, 3),
    kind: segment.kind,
  }));
}

/** Detect horizontal barriers from a grayscale image (scans for vertical lines). */
export function detectHorizontalBarriersFromGray(args: {
  gray: Float32Array;
  width: number;
  height: number;
  pageWidthPt: number;
  pageHeightPt: number;
  excludeBboxesPt?: number[][];
  minRunLengthPx?: number;
}): DetectedHorizontalBarrier[] {
  return scanColumnsForHorizontalBarriers(args);
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image for page barrier detection: ${url}`));
    image.src = url;
  });
}

/** Detect horizontal barriers from an image URL (scans for vertical lines). */
export async function detectHorizontalBarriersFromImageUrl({
  imageUrl,
  pageWidthPt,
  pageHeightPt,
  maxDimensionPx = DEFAULT_MAX_DETECTION_DIMENSION_PX,
  excludeBboxesPt = [],
}: {
  imageUrl: string;
  pageWidthPt: number;
  pageHeightPt: number;
  maxDimensionPx?: number;
  excludeBboxesPt?: number[][];
}): Promise<DetectedHorizontalBarrier[]> {
  const image = await loadImageElement(imageUrl);
  const scale = Math.min(1, maxDimensionPx / Math.max(image.width, image.height, 1));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create canvas context for page barrier detection.');
  }
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return scanColumnsForHorizontalBarriers({
    gray: grayscaleFromImageData(imageData),
    width,
    height,
    pageWidthPt,
    pageHeightPt,
    excludeBboxesPt,
    minRunLengthPx: Math.max(12, Math.round(height * 0.01)),
  });
}

function transposeGray(
  gray: Float32Array,
  width: number,
  height: number,
): { gray: Float32Array; width: number; height: number } {
  const transposed = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      transposed[x * height + y] = gray[y * width + x];
    }
  }
  return { gray: transposed, width: height, height: width };
}

/** Detect vertical barriers from a grayscale image (transposes, scans for horizontal lines). */
export function detectVerticalBarriersFromGray({
  gray,
  width,
  height,
  pageWidthPt,
  pageHeightPt,
  excludeBboxesPt = [],
  minRunLengthPx = DEFAULT_MIN_RUN_LENGTH_PX,
}: {
  gray: Float32Array;
  width: number;
  height: number;
  pageWidthPt: number;
  pageHeightPt: number;
  excludeBboxesPt?: number[][];
  minRunLengthPx?: number;
}): DetectedVerticalBarrier[] {
  const t = transposeGray(gray, width, height);
  // Transpose exclude bboxes: [x0, y0, x1, y1] → [y0, x0, y1, x1]
  const transposedExclude = excludeBboxesPt.map((bbox) => [bbox[1], bbox[0], bbox[3], bbox[2]]);
  const horizontalResults = scanColumnsForHorizontalBarriers({
    gray: t.gray,
    width: t.width,
    height: t.height,
    pageWidthPt: pageHeightPt,
    pageHeightPt: pageWidthPt,
    excludeBboxesPt: transposedExclude,
    minRunLengthPx,
  });
  // Map back: horizontal barrier { x, y1, y2 } in transposed space → vertical barrier { y, x1, x2 }
  return horizontalResults.map((barrier, index) => ({
    barrier_id: `vbarrier_${index + 1}`,
    y: barrier.x,
    x1: barrier.y1,
    x2: barrier.y2,
    score: barrier.score,
    kind: barrier.kind,
  }));
}

/** Detect vertical barriers from an image URL (transposes, scans for horizontal lines). */
export async function detectVerticalBarriersFromImageUrl({
  imageUrl,
  pageWidthPt,
  pageHeightPt,
  maxDimensionPx = DEFAULT_MAX_DETECTION_DIMENSION_PX,
  excludeBboxesPt = [],
}: {
  imageUrl: string;
  pageWidthPt: number;
  pageHeightPt: number;
  maxDimensionPx?: number;
  excludeBboxesPt?: number[][];
}): Promise<DetectedVerticalBarrier[]> {
  const image = await loadImageElement(imageUrl);
  const scale = Math.min(1, maxDimensionPx / Math.max(image.width, image.height, 1));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create canvas context for vertical page barrier detection.');
  }
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return detectVerticalBarriersFromGray({
    gray: grayscaleFromImageData(imageData),
    width,
    height,
    pageWidthPt,
    pageHeightPt,
    excludeBboxesPt,
    minRunLengthPx: Math.max(12, Math.round(width * 0.01)),
  });
}
