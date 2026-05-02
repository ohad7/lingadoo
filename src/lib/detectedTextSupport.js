function normalizePageIds(pageIds) {
  return [...new Set((Array.isArray(pageIds) ? pageIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function formatPageList(pageIds) {
  return normalizePageIds(pageIds).join(', ');
}

export function partitionDetectedTextRequestedPages(requestedPages, layouts) {
  const normalizedRequestedPages = normalizePageIds(requestedPages);
  const supportedPageIds = normalizePageIds(
    (Array.isArray(layouts) ? layouts : [])
      .filter((layout) => Array.isArray(layout?.blocks) && layout.blocks.length > 0)
      .map((layout) => Number(layout?.page_id)),
  ).filter((pageId) => normalizedRequestedPages.includes(pageId));
  const supportedSet = new Set(supportedPageIds);
  const skippedPageIds = normalizedRequestedPages.filter((pageId) => !supportedSet.has(pageId));
  return {
    supportedPageIds,
    skippedPageIds,
  };
}

export function buildDetectedTextUnsupportedMessage(pageIds) {
  const normalizedPageIds = normalizePageIds(pageIds);
  if (normalizedPageIds.length === 1) {
    return `Page ${normalizedPageIds[0]} looks like a scanned or image-only page, so it cannot open in this text-based editor yet. Try a different method.`;
  }
  return `Pages ${formatPageList(normalizedPageIds)} look like scanned or image-only pages, so they cannot open in this text-based editor yet. Try a different method.`;
}

export function buildDetectedTextSkippedPagesNotice(pageIds) {
  const normalizedPageIds = normalizePageIds(pageIds);
  if (normalizedPageIds.length === 0) {
    return '';
  }
  if (normalizedPageIds.length === 1) {
    return `Skipped page ${normalizedPageIds[0]} because it looks scanned or image-only.`;
  }
  return `Skipped pages ${formatPageList(normalizedPageIds)} because they look scanned or image-only.`;
}
