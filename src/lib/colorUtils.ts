const MAX_DOC_COLORS = 6;
// Euclidean distance in 0-1 RGB space; ~0.15 ≈ 38/255 per channel when all three differ equally
const SIMILAR_COLOR_THRESHOLD = 0.15;

type BlockLike = {
  text_color?: string | null;
  background_fill_color?: number[] | null;
};

type PageLike = {
  blocks: BlockLike[];
};

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function isTooClose(candidate: [number, number, number], accepted: [number, number, number][]): boolean {
  return accepted.some((c) => rgbDistance(candidate, c) < SIMILAR_COLOR_THRESHOLD);
}

export function extractDocTextColors(pages: PageLike[]): string[] {
  // Count occurrences per normalized hex
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const block of page.blocks) {
      if (!block.text_color || typeof block.text_color !== 'string') continue;
      const hex = block.text_color.toLowerCase();
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }

  // Most frequent first, then perceptually deduplicate
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const result: string[] = [];
  const acceptedRgb: [number, number, number][] = [];
  for (const [hex] of sorted) {
    const rgb = hexToRgb01(hex);
    if (isTooClose(rgb, acceptedRgb)) continue;
    result.push(hex);
    acceptedRgb.push(rgb);
    if (result.length >= MAX_DOC_COLORS) break;
  }
  return result;
}

export function extractDocBgColors(pages: PageLike[]): number[][] {
  // Count occurrences keyed by rounded value
  const countMap = new Map<string, { color: number[]; count: number }>();
  for (const page of pages) {
    for (const block of page.blocks) {
      if (!Array.isArray(block.background_fill_color) || block.background_fill_color.length < 3) continue;
      const key = block.background_fill_color.map((v) => Math.round(v * 100)).join(',');
      const existing = countMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        countMap.set(key, { color: block.background_fill_color, count: 1 });
      }
    }
  }

  // Most frequent first, then perceptually deduplicate
  const sorted = [...countMap.values()].sort((a, b) => b.count - a.count);
  const result: number[][] = [];
  const acceptedRgb: [number, number, number][] = [];
  for (const { color } of sorted) {
    const rgb: [number, number, number] = [color[0], color[1], color[2]];
    if (isTooClose(rgb, acceptedRgb)) continue;
    result.push(color);
    acceptedRgb.push(rgb);
    if (result.length >= MAX_DOC_COLORS) break;
  }
  return result;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [0, 0, 0];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}
