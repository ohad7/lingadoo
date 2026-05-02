function normalizeBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return null;
  }
  const normalized = bbox.map((value) => Number(value));
  if (!normalized.every((value) => Number.isFinite(value))) {
    return null;
  }
  const [x0, y0, x1, y1] = normalized;
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return normalized;
}

function bboxArea(bbox) {
  return Math.max(0, Number(bbox[2]) - Number(bbox[0])) * Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

function bboxIntersectionArea(left, right) {
  const x0 = Math.max(Number(left[0]), Number(right[0]));
  const y0 = Math.max(Number(left[1]), Number(right[1]));
  const x1 = Math.min(Number(left[2]), Number(right[2]));
  const y1 = Math.min(Number(left[3]), Number(right[3]));
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function bboxIou(left, right) {
  const intersection = bboxIntersectionArea(left, right);
  if (intersection <= 0) {
    return 0;
  }
  const leftArea = Math.max(1, bboxArea(left));
  const rightArea = Math.max(1, bboxArea(right));
  return intersection / Math.max(1, leftArea + rightArea - intersection);
}

function candidateOverlapsProtectedRegion(candidateBBox, protectedRegions) {
  const candidateArea = Math.max(1, bboxArea(candidateBBox));
  return protectedRegions.some((region) => {
    const regionBBox = normalizeBBox(region?.bbox);
    if (!regionBBox) {
      return false;
    }
    const overlap = bboxIntersectionArea(candidateBBox, regionBBox);
    if (overlap <= 0) {
      return false;
    }
    const regionArea = Math.max(1, bboxArea(regionBBox));
    return (
      bboxIou(candidateBBox, regionBBox) >= 0.2
      || (overlap / candidateArea) >= 0.55
      || (overlap / regionArea) >= 0.55
    );
  });
}

export function buildProtectedGraphicRegions({
  pageId,
  sourceGraphicRegions = [],
  fallbackGraphicRegions = [],
  rasterLogoCandidates = [],
  rasterScoreThreshold = 5.9,
} = {}) {
  const graphicSource = Array.isArray(sourceGraphicRegions) && sourceGraphicRegions.length > 0
    ? sourceGraphicRegions
    : fallbackGraphicRegions;

  const protectedGraphicRegions = graphicSource
    .map((region, index) => {
      const bbox = normalizeBBox(region?.bbox);
      if (!bbox) {
        return null;
      }
      return {
        ...region,
        region_id: String(region?.region_id || `protected_graphic_${pageId}_${index + 1}`),
        bbox,
        flipped: true,
        source_kind: String(region?.source_kind || 'graphic_region') || 'graphic_region',
        auto_protected: true,
      };
    })
    .filter(Boolean);

  const rasterRegions = (Array.isArray(rasterLogoCandidates) ? rasterLogoCandidates : [])
    .map((candidate, index) => {
      const bbox = normalizeBBox(candidate?.bbox);
      const score = Number(candidate?.score);
      if (!bbox || !Number.isFinite(score) || score < rasterScoreThreshold) {
        return null;
      }
      if (candidateOverlapsProtectedRegion(bbox, protectedGraphicRegions)) {
        return null;
      }
      return {
        region_id: `raster_logo_region_${pageId}_${index + 1}`,
        bbox,
        flipped: true,
        source_kind: 'raster_logo_candidate',
        auto_protected: true,
        score: Math.round(score * 100) / 100,
      };
    })
    .filter(Boolean);

  return [...protectedGraphicRegions, ...rasterRegions];
}

export function buildDefaultGraphicRegionEditsByPage(pageArtifacts = []) {
  const entries = (Array.isArray(pageArtifacts) ? pageArtifacts : [])
    .map((artifacts) => {
      const pageId = Number(artifacts?.pageId);
      const edits = (artifacts?.layout?.graphic_regions || [])
        .filter((region) => Boolean(region?.flipped) && String(region?.region_id || '').trim())
        .map((region) => ({
          op: 'flip_graphic',
          block_id: String(region.region_id),
        }));
      return pageId > 0 && edits.length > 0 ? [pageId, edits] : null;
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}
