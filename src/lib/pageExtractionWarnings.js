export function buildExtractionWarningSummary(pageId, warning) {
  const normalizedPageId = Number(pageId);
  const reasons = Array.isArray(warning?.reasons) ? warning.reasons.map((reason) => String(reason)) : [];
  if (reasons.includes('background_text_image')) {
    return `Page ${normalizedPageId}: this page includes a text-heavy background image, so some text may not be captured.`;
  }
  return `Page ${normalizedPageId}: text extraction may be corrupted.`;
}

export function buildEditorExtractionNotices({
  openingNotice = '',
  activePageId = null,
  activeExtractionWarning = null,
}) {
  const notices = [];
  const normalizedOpeningNotice = String(openingNotice || '').trim();
  if (normalizedOpeningNotice) {
    notices.push({
      key: 'opening-notice',
      tone: 'info',
      message: normalizedOpeningNotice,
    });
  }
  if (activePageId != null && activeExtractionWarning?.suspicious) {
    notices.push({
      key: `page-warning-${Number(activePageId)}`,
      tone: 'warning',
      message: buildExtractionWarningSummary(activePageId, activeExtractionWarning),
    });
  }
  return notices;
}
