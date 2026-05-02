import { containsSourceScript, normalizeDocumentLanguageCode } from './pdf-core/documentLanguages.js';

function normalizeJoinTextPart(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function mergeBlockTextParts(blocks, fieldName) {
  const parts = (Array.isArray(blocks) ? blocks : [])
    .map((block) => normalizeJoinTextPart(block?.[fieldName]))
    .filter(Boolean);
  return parts.join(' ');
}

export function shouldRetranslateJoinedBlock({
  mergedText,
  mergedSourceText,
  sourceLanguageCode,
  targetLanguageCode,
}) {
  const normalizedMergedText = normalizeJoinTextPart(mergedText);
  const normalizedMergedSourceText = normalizeJoinTextPart(mergedSourceText);
  const sourceCode = normalizeDocumentLanguageCode(sourceLanguageCode, 'he');
  const targetCode = normalizeDocumentLanguageCode(targetLanguageCode, 'en');
  if (!normalizedMergedText || !normalizedMergedSourceText) {
    return false;
  }
  if (sourceCode === targetCode) {
    return false;
  }
  return (
    containsSourceScript(normalizedMergedText, targetCode)
    && containsSourceScript(normalizedMergedSourceText, sourceCode)
  );
}

function blockWrapModeForJoin(block) {
  if (String(block?.wrap_mode || '') === 'word') {
    return 'word';
  }
  const blockType = String(block?.block_type || block?.type || '');
  if (blockType === 'text_line' || blockType === 'table_cell' || Boolean(block?.flattened_line_breaks)) {
    return 'word';
  }
  return 'none';
}

export function buildJoinedBlockForFit(anchorBlock, blocks, {
  text,
  sourceText,
  bbox,
  sourceBBox,
} = {}) {
  const candidates = Array.isArray(blocks) ? blocks : [];
  const maxCurrentFontSize = Math.max(
    Number(anchorBlock?.font_size) || 0,
    ...candidates.map((block) => Number(block?.font_size) || 0),
  );
  const maxSourceFontSize = Math.max(
    Number(anchorBlock?.source_font_size) || 0,
    ...candidates.map((block) => Number(block?.source_font_size) || Number(block?.font_size) || 0),
  );
  const resolvedWrapMode = candidates.some((block) => blockWrapModeForJoin(block) === 'word')
    ? 'word'
    : blockWrapModeForJoin(anchorBlock);
  const resolvedBlockType = String(anchorBlock?.block_type || anchorBlock?.type || '')
    || (resolvedWrapMode === 'word' ? 'text_line' : 'paragraph');

  return {
    ...anchorBlock,
    text: String(text || ''),
    source_text: String(sourceText || ''),
    bbox: Array.isArray(bbox) ? bbox.map((value) => Number(value)) : [0, 0, 1, 1],
    source_bbox: Array.isArray(sourceBBox)
      ? sourceBBox.map((value) => Number(value))
      : (Array.isArray(bbox) ? bbox.map((value) => Number(value)) : [0, 0, 1, 1]),
    wrap_mode: resolvedWrapMode,
    block_type: resolvedBlockType,
    source_font_size: maxSourceFontSize > 0
      ? maxSourceFontSize
      : (maxCurrentFontSize > 0 ? maxCurrentFontSize : Number(anchorBlock?.source_font_size) || 10),
    bbox_edited: true,
  };
}
