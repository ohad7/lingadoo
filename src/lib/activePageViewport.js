export function resolveActivePageIdFromViewport({
  pageIds,
  rectByPageId,
  viewportTop,
  viewportBottom,
  probeY,
  fallbackPageId = null,
}) {
  if (!Array.isArray(pageIds) || !pageIds.length) {
    return null;
  }

  let nextPageId = pageIds.includes(fallbackPageId) ? fallbackPageId : pageIds[0];
  let bestVisibleHeight = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const pageId of pageIds) {
    const rect = rectByPageId[pageId];
    if (!rect) continue;
    const visibleTop = Math.max(rect.top, viewportTop);
    const visibleBottom = Math.min(rect.bottom, viewportBottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    if (visibleHeight > 0) {
      const distance = Math.abs(rect.top - viewportTop);
      if (
        visibleHeight > bestVisibleHeight
        || (visibleHeight === bestVisibleHeight && distance < bestDistance)
      ) {
        bestVisibleHeight = visibleHeight;
        bestDistance = distance;
        nextPageId = pageId;
      }
      continue;
    }
    if (bestVisibleHeight >= 0) {
      continue;
    }
    const distance = Math.abs(rect.top - probeY);
    if (distance < bestDistance) {
      bestDistance = distance;
      nextPageId = pageId;
    }
  }

  return nextPageId;
}

export function resolveActivePageIdFromVisibility({
  pageIds,
  visibilityByPageId,
  fallbackPageId = null,
}) {
  if (!Array.isArray(pageIds) || !pageIds.length) {
    return null;
  }

  let nextPageId = pageIds.includes(fallbackPageId) ? fallbackPageId : pageIds[0];
  let bestVisibleHeight = -1;
  let bestTopDistance = Number.POSITIVE_INFINITY;

  for (const pageId of pageIds) {
    const visibility = visibilityByPageId[pageId];
    if (!visibility || visibility.visibleHeight <= 0) {
      continue;
    }
    const topDistance = Math.abs(visibility.top);
    if (
      visibility.visibleHeight > bestVisibleHeight
      || (visibility.visibleHeight === bestVisibleHeight && topDistance < bestTopDistance)
    ) {
      bestVisibleHeight = visibility.visibleHeight;
      bestTopDistance = topDistance;
      nextPageId = pageId;
    }
  }

  return nextPageId;
}
