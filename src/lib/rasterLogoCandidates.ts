type PixelComponent = {
  bboxPx: [number, number, number, number];
  areaFg: number;
  perimeter: number;
  pageWidthPx: number;
  pageHeightPx: number;
};

export type RasterLogoScoredCandidate = {
  bboxPx: [number, number, number, number];
  score: number;
  area_ratio: number;
  aspect: number;
  fill_ratio: number;
  edge_density: number;
  symmetry_score: number;
  compactness: number;
};

export type RasterLogoOverlayCandidate = {
  visual_id: string;
  bbox: number[];
  kind: 'raster_logo_candidate';
  score: number;
};

const MAX_DETECTION_DIMENSION_PX = 1200;
const ADAPTIVE_BLOCK_RADIUS = 15;
const ADAPTIVE_THRESHOLD_C = 10;
const EDGE_THRESHOLD = 70;
const SMALL_KERNEL_RADIUS = 1;
const MERGE_KERNEL_RADIUS = 3;
const DILATE_KERNEL_RADIUS = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ptBBoxToPixelBounds(
  bbox: number[],
  {
    pageWidthPt,
    pageHeightPt,
    widthPx,
    heightPx,
  }: {
    pageWidthPt: number;
    pageHeightPt: number;
    widthPx: number;
    heightPx: number;
  },
): [number, number, number, number] | null {
  if (!Array.isArray(bbox) || bbox.length < 4 || pageWidthPt <= 0 || pageHeightPt <= 0 || widthPx <= 0 || heightPx <= 0) {
    return null;
  }
  const x0 = clamp(Math.floor((Number(bbox[0]) / pageWidthPt) * widthPx), 0, widthPx);
  const y0 = clamp(Math.floor((Number(bbox[1]) / pageHeightPt) * heightPx), 0, heightPx);
  const x1 = clamp(Math.ceil((Number(bbox[2]) / pageWidthPt) * widthPx), 0, widthPx);
  const y1 = clamp(Math.ceil((Number(bbox[3]) / pageHeightPt) * heightPx), 0, heightPx);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return [x0, y0, x1, y1];
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image for raster logo detection: ${url}`));
    image.src = url;
  });
}

function histogramPercentileRange(gray: Float32Array): { low: number; high: number } {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.length; index += 1) {
    histogram[clamp(Math.round(gray[index] || 0), 0, 255)] += 1;
  }
  const total = gray.length;
  const lowerTarget = total * 0.02;
  const upperTarget = total * 0.98;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= lowerTarget) {
      low = value;
      break;
    }
  }
  cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= upperTarget) {
      high = value;
      break;
    }
  }
  if (high <= low) {
    return { low: 0, high: 255 };
  }
  return { low, high };
}

function grayscaleFromImageData(imageData: ImageData): Float32Array {
  const rgba = imageData.data;
  const gray = new Float32Array(imageData.width * imageData.height);
  for (let index = 0, pixelIndex = 0; index < rgba.length; index += 4, pixelIndex += 1) {
    gray[pixelIndex] = (0.299 * rgba[index]) + (0.587 * rgba[index + 1]) + (0.114 * rgba[index + 2]);
  }
  return gray;
}

function normalizeContrast(gray: Float32Array): Float32Array {
  const { low, high } = histogramPercentileRange(gray);
  const span = Math.max(1, high - low);
  const normalized = new Float32Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    normalized[index] = clamp(((gray[index] - low) * 255) / span, 0, 255);
  }
  return normalized;
}

export function applyExcludedRegionsToGray(
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
    const bounds = ptBBoxToPixelBounds(bbox, {
      pageWidthPt,
      pageHeightPt,
      widthPx,
      heightPx,
    });
    if (!bounds) {
      continue;
    }
    const [x0, y0, x1, y1] = bounds;
    for (let y = y0; y < y1; y += 1) {
      const rowOffset = y * widthPx;
      for (let x = x0; x < x1; x += 1) {
        masked[rowOffset + x] = 255;
      }
    }
  }
  return masked;
}

function gaussianBlur3x3(src: Float32Array, width: number, height: number): Float32Array {
  const dst = new Float32Array(src.length);
  const kernel = [
    1, 2, 1,
    2, 4, 2,
    1, 2, 1,
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let weighted = 0;
      let total = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const sampleX = clamp(x + kx, 0, width - 1);
          const sampleY = clamp(y + ky, 0, height - 1);
          const weight = kernel[(ky + 1) * 3 + (kx + 1)];
          weighted += src[(sampleY * width) + sampleX] * weight;
          total += weight;
        }
      }
      dst[(y * width) + x] = weighted / Math.max(1, total);
    }
  }
  return dst;
}

function buildIntegralImage(src: Float32Array, width: number, height: number): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += src[((y - 1) * width) + (x - 1)];
      integral[(y * (width + 1)) + x] = integral[((y - 1) * (width + 1)) + x] + rowSum;
    }
  }
  return integral;
}

function rectAverage(integral: Float64Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  const stride = width + 1;
  const sum = integral[(y1 * stride) + x1]
    - integral[(y0 * stride) + x1]
    - integral[(y1 * stride) + x0]
    + integral[(y0 * stride) + x0];
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  return sum / area;
}

function adaptiveThresholdInverse(src: Float32Array, width: number, height: number, radius: number, constant: number): Uint8Array {
  const integral = buildIntegralImage(src, width, height);
  const dst = new Uint8Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(width, x + radius + 1);
      const y1 = Math.min(height, y + radius + 1);
      const mean = rectAverage(integral, width, x0, y0, x1, y1);
      dst[(y * width) + x] = src[(y * width) + x] < (mean - constant) ? 1 : 0;
    }
  }
  return dst;
}

function sobelEdges(src: Float32Array, width: number, height: number, threshold: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = (y * width) + x;
      const gx = (
        (-1 * src[idx - width - 1]) + (1 * src[idx - width + 1])
        + (-2 * src[idx - 1]) + (2 * src[idx + 1])
        + (-1 * src[idx + width - 1]) + (1 * src[idx + width + 1])
      );
      const gy = (
        (-1 * src[idx - width - 1]) + (-2 * src[idx - width]) + (-1 * src[idx - width + 1])
        + (1 * src[idx + width - 1]) + (2 * src[idx + width]) + (1 * src[idx + width + 1])
      );
      const magnitude = Math.abs(gx) + Math.abs(gy);
      dst[idx] = magnitude >= threshold ? 1 : 0;
    }
  }
  return dst;
}

function binaryOr(left: Uint8Array, right: Uint8Array): Uint8Array {
  const dst = new Uint8Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    dst[index] = left[index] || right[index] ? 1 : 0;
  }
  return dst;
}

function erodeBinary(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let keep = 1;
      for (let ky = -radius; ky <= radius && keep; ky += 1) {
        for (let kx = -radius; kx <= radius; kx += 1) {
          const sampleX = x + kx;
          const sampleY = y + ky;
          if (
            sampleX < 0
            || sampleY < 0
            || sampleX >= width
            || sampleY >= height
            || src[(sampleY * width) + sampleX] === 0
          ) {
            keep = 0;
            break;
          }
        }
      }
      dst[(y * width) + x] = keep;
    }
  }
  return dst;
}

function dilateBinary(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let fill = 0;
      for (let ky = -radius; ky <= radius && !fill; ky += 1) {
        for (let kx = -radius; kx <= radius; kx += 1) {
          const sampleX = x + kx;
          const sampleY = y + ky;
          if (
            sampleX >= 0
            && sampleY >= 0
            && sampleX < width
            && sampleY < height
            && src[(sampleY * width) + sampleX] === 1
          ) {
            fill = 1;
            break;
          }
        }
      }
      dst[(y * width) + x] = fill;
    }
  }
  return dst;
}

function countNonZeroRect(src: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      count += src[(y * width) + x] ? 1 : 0;
    }
  }
  return count;
}

function estimateSymmetry(binary: Uint8Array, width: number, bboxPx: [number, number, number, number]): number {
  const [x0, y0, x1, y1] = bboxPx;
  const boxWidth = Math.max(1, x1 - x0);
  const boxHeight = Math.max(1, y1 - y0);
  let occupied = 0;
  let horizontalMatches = 0;
  let verticalMatches = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!binary[(y * width) + x]) {
        continue;
      }
      occupied += 1;
      const mirroredX = x0 + (boxWidth - 1 - (x - x0));
      const mirroredY = y0 + (boxHeight - 1 - (y - y0));
      if (binary[(y * width) + mirroredX]) {
        horizontalMatches += 1;
      }
      if (binary[(mirroredY * width) + x]) {
        verticalMatches += 1;
      }
    }
  }
  if (occupied === 0) {
    return 0;
  }
  return Math.max(horizontalMatches / occupied, verticalMatches / occupied);
}

function connectedComponents(binary: Uint8Array, width: number, height: number): PixelComponent[] {
  const visited = new Uint8Array(binary.length);
  const components: PixelComponent[] = [];
  const neighbors = [-1, 0, 1];
  for (let startY = 0; startY < height; startY += 1) {
    for (let startX = 0; startX < width; startX += 1) {
      const startIndex = (startY * width) + startX;
      if (!binary[startIndex] || visited[startIndex]) {
        continue;
      }
      const queueX = [startX];
      const queueY = [startY];
      visited[startIndex] = 1;
      let head = 0;
      let minX = startX;
      let minY = startY;
      let maxX = startX + 1;
      let maxY = startY + 1;
      let areaFg = 0;
      let perimeter = 0;
      while (head < queueX.length) {
        const x = queueX[head];
        const y = queueY[head];
        head += 1;
        areaFg += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + 1);
        maxY = Math.max(maxY, y + 1);
        const fourNeighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of fourNeighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !binary[(ny * width) + nx]) {
            perimeter += 1;
          }
        }
        for (const dy of neighbors) {
          for (const dx of neighbors) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
              continue;
            }
            const nextIndex = (nextY * width) + nextX;
            if (!binary[nextIndex] || visited[nextIndex]) {
              continue;
            }
            visited[nextIndex] = 1;
            queueX.push(nextX);
            queueY.push(nextY);
          }
        }
      }
      components.push({
        bboxPx: [minX, minY, maxX, maxY],
        areaFg,
        perimeter,
        pageWidthPx: width,
        pageHeightPx: height,
      });
    }
  }
  return components;
}

export function scoreRasterLogoComponent({
  bboxPx,
  areaFg,
  perimeter,
  pageWidthPx,
  pageHeightPx,
  edgeDensity,
  fgDensity,
  symmetryScore,
}: {
  bboxPx: [number, number, number, number];
  areaFg: number;
  perimeter: number;
  pageWidthPx: number;
  pageHeightPx: number;
  edgeDensity: number;
  fgDensity: number;
  symmetryScore: number;
}): RasterLogoScoredCandidate | null {
  const width = Math.max(1, bboxPx[2] - bboxPx[0]);
  const height = Math.max(1, bboxPx[3] - bboxPx[1]);
  const areaBox = width * height;
  if (areaBox <= 0) {
    return null;
  }
  const pageArea = Math.max(1, pageWidthPx * pageHeightPx);
  const areaRatio = areaBox / pageArea;
  const aspect = width / Math.max(1, height);
  const fillRatio = areaFg / areaBox;
  if (areaRatio < 0.0002 || areaRatio > 0.08) {
    return null;
  }
  if (aspect < 0.15 || aspect > 8.0) {
    return null;
  }
  if (fillRatio < 0.03 || fillRatio > 0.95) {
    return null;
  }
  const compactness = perimeter > 0 ? (4 * Math.PI * areaFg) / (perimeter * perimeter) : 0;
  const cx = bboxPx[0] + (width / 2);
  const cy = bboxPx[1] + (height / 2);
  const topness = 1.0 - (cy / Math.max(1, pageHeightPx));
  const bottomness = cy / Math.max(1, pageHeightPx);
  const leftness = 1.0 - (cx / Math.max(1, pageWidthPx));
  const rightness = cx / Math.max(1, pageWidthPx);
  const cornerPrior = Math.max(
    topness * leftness,
    topness * rightness,
    bottomness * leftness,
    bottomness * rightness,
  );
  const headerFooterPrior = Math.max(topness, bottomness);
  let score = 0;
  if (areaRatio >= 0.0005 && areaRatio <= 0.02) {
    score += 2;
  }
  if (fgDensity >= 0.08 && fgDensity <= 0.70) {
    score += 1;
  }
  if (edgeDensity >= 0.02 && edgeDensity <= 0.40) {
    score += 1;
  }
  if (symmetryScore > 0.4) {
    score += 1;
  }
  if (compactness > 0.08) {
    score += 1;
  }
  score += 2 * cornerPrior;
  score += headerFooterPrior;
  if (score < 3.0) {
    return null;
  }
  return {
    bboxPx,
    score,
    area_ratio: areaRatio,
    aspect,
    fill_ratio: fillRatio,
    edge_density: edgeDensity,
    symmetry_score: symmetryScore,
    compactness,
  };
}

function iou(left: [number, number, number, number], right: [number, number, number, number]): number {
  const x0 = Math.max(left[0], right[0]);
  const y0 = Math.max(left[1], right[1]);
  const x1 = Math.min(left[2], right[2]);
  const y1 = Math.min(left[3], right[3]);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const leftArea = Math.max(1, (left[2] - left[0]) * (left[3] - left[1]));
  const rightArea = Math.max(1, (right[2] - right[0]) * (right[3] - right[1]));
  return intersection / Math.max(1, leftArea + rightArea - intersection);
}

function nonMaxSuppress(candidates: RasterLogoScoredCandidate[], threshold = 0.3): RasterLogoScoredCandidate[] {
  const kept: RasterLogoScoredCandidate[] = [];
  for (const candidate of [...candidates].sort((left, right) => right.score - left.score)) {
    if (kept.some((existing) => iou(existing.bboxPx, candidate.bboxPx) >= threshold)) {
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}

function detectCandidatesInBand({
  gray,
  width,
  height,
  x0,
  y0,
  x1,
  y1,
}: {
  gray: Float32Array;
  width: number;
  height: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}): RasterLogoScoredCandidate[] {
  const roiWidth = Math.max(1, x1 - x0);
  const roiHeight = Math.max(1, y1 - y0);
  const roiGray = new Float32Array(roiWidth * roiHeight);
  for (let row = 0; row < roiHeight; row += 1) {
    const sourceOffset = ((y0 + row) * width) + x0;
    roiGray.set(gray.subarray(sourceOffset, sourceOffset + roiWidth), row * roiWidth);
  }
  const normalized = normalizeContrast(roiGray);
  const blurred = gaussianBlur3x3(normalized, roiWidth, roiHeight);
  const binaryInv = adaptiveThresholdInverse(blurred, roiWidth, roiHeight, ADAPTIVE_BLOCK_RADIUS, ADAPTIVE_THRESHOLD_C);
  const edges = sobelEdges(blurred, roiWidth, roiHeight, EDGE_THRESHOLD);
  const combined = binaryOr(binaryInv, edges);
  const opened = dilateBinary(erodeBinary(combined, roiWidth, roiHeight, SMALL_KERNEL_RADIUS), roiWidth, roiHeight, SMALL_KERNEL_RADIUS);
  const closed = erodeBinary(dilateBinary(opened, roiWidth, roiHeight, MERGE_KERNEL_RADIUS), roiWidth, roiHeight, MERGE_KERNEL_RADIUS);
  const merged = dilateBinary(closed, roiWidth, roiHeight, DILATE_KERNEL_RADIUS);
  const components = connectedComponents(merged, roiWidth, roiHeight);
  const scored = components.map((component) => {
    const bboxPx: [number, number, number, number] = [
      component.bboxPx[0] + x0,
      component.bboxPx[1] + y0,
      component.bboxPx[2] + x0,
      component.bboxPx[3] + y0,
    ];
    const edgeDensity = countNonZeroRect(
      edges,
      roiWidth,
      component.bboxPx[0],
      component.bboxPx[1],
      component.bboxPx[2],
      component.bboxPx[3],
    ) / Math.max(1, (component.bboxPx[2] - component.bboxPx[0]) * (component.bboxPx[3] - component.bboxPx[1]));
    const fgDensity = component.areaFg / Math.max(1, (component.bboxPx[2] - component.bboxPx[0]) * (component.bboxPx[3] - component.bboxPx[1]));
    const symmetryScore = estimateSymmetry(merged, roiWidth, component.bboxPx);
    return scoreRasterLogoComponent({
      bboxPx,
      areaFg: component.areaFg,
      perimeter: component.perimeter,
      pageWidthPx: width,
      pageHeightPx: height,
      edgeDensity,
      fgDensity,
      symmetryScore,
    });
  }).filter((candidate): candidate is RasterLogoScoredCandidate => Boolean(candidate));
  return scored;
}

export async function detectRasterLogoCandidatesFromImageUrl({
  imageUrl,
  pageWidthPt,
  pageHeightPt,
  maxDimensionPx = MAX_DETECTION_DIMENSION_PX,
  excludeBboxesPt = [],
}: {
  imageUrl: string;
  pageWidthPt: number;
  pageHeightPt: number;
  maxDimensionPx?: number;
  excludeBboxesPt?: number[][];
}): Promise<RasterLogoOverlayCandidate[]> {
  const image = await loadImageElement(imageUrl);
  const scale = Math.min(1, maxDimensionPx / Math.max(image.width, image.height, 1));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create canvas context for raster logo detection.');
  }
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const gray = applyExcludedRegionsToGray(grayscaleFromImageData(imageData), {
    widthPx: width,
    heightPx: height,
    pageWidthPt,
    pageHeightPt,
    excludeBboxesPt,
  });
  const topBandHeight = Math.max(1, Math.round(height * 0.24));
  const bottomBandHeight = Math.max(1, Math.round(height * 0.16));
  const topCandidates = detectCandidatesInBand({
    gray,
    width,
    height,
    x0: 0,
    y0: 0,
    x1: width,
    y1: topBandHeight,
  });
  const bottomCandidates = detectCandidatesInBand({
    gray,
    width,
    height,
    x0: 0,
    y0: Math.max(0, height - bottomBandHeight),
    x1: width,
    y1: height,
  });
  const candidates = nonMaxSuppress([...topCandidates, ...bottomCandidates]);
  return candidates.map((candidate, index) => ({
    visual_id: `raster_logo_${index + 1}`,
    bbox: [
      (candidate.bboxPx[0] / width) * pageWidthPt,
      (candidate.bboxPx[1] / height) * pageHeightPt,
      (candidate.bboxPx[2] / width) * pageWidthPt,
      (candidate.bboxPx[3] / height) * pageHeightPt,
    ],
    kind: 'raster_logo_candidate',
    score: Math.round(candidate.score * 100) / 100,
  }));
}
