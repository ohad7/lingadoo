// Browser-local digital extraction helpers.
// Shared runtime builders now delegate through this module from mupdfExtraction.js.

export const PORT_STATUS = {
  PORTED_TESTED: 'ported_tested',
  PORTED_UNTESTED: 'ported_untested',
  PARTIAL: 'partial',
  STUB: 'stub',
};

const RTL_PATTERN = /[\u0590-\u08FF]/u;
const LTR_PATTERN = /[A-Za-z]/u;
const RTL_LABEL_WITH_LEADING_COLON_RE = /^\s*:\s*([\u0590-\u08FF][\u0590-\u08FF\s"'()./\-]+?)\s*$/u;
const RTL_LABEL_VALUE_START_RE = /[A-Za-z0-9@(+]/u;
const _BT_ET_BLOCK_RE = /\bBT\b([\s\S]*?)\bET\b/g;
const _TEXT_STREAM_OP_RE = /\/([\w+\-.]+)\s+([\d.]+)\s+Tf|(\d+)\s+Tr|([\d.]+)\s+w\b|<[0-9A-Fa-f]+>\s*Tj|\[.*?\]\s*TJ|([-\d.e]+)\s+([-\d.e]+)\s+Td|([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+Tm/gs;
const LATIN1_DECODER = new TextDecoder('latin1');
const SCHEMA_VERSION = '1.0';
const STAGE_PAGE_LAYOUT = 'page_layout';

function makeStub(name) {
  return function digitalStagePortStub() {
    throw new Error(`${name} is not ported in digitalStagePort.js yet`);
  };
}

function normalizeWhitespace(value) {
  return String(value || '').split(/\s+/).filter(Boolean).join(' ');
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0.0;
  }
  const ordered = [...values].map((value) => Number(value)).sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) {
    return ordered[middle];
  }
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

export const DIGITAL_STAGE_PORT_STATUS = {
  _extract_text_render_modes: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _lookup_render_mode: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _infer_direction: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _normalize_rtl_label_colon_order: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _to_hex_color: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _infer_alignment: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _style_key: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _detect_two_columns: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _assign_columns: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _extract_lines_and_styles: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _bbox_area: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _bbox_intersection_area: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _bbox_overlap_ratio: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _is_line_inside_any_table: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _dedupe_table_cell_candidates: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _prune_spanning_table_cells: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _is_boundary_table_row_outlier: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _trim_boundary_table_rows: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _reject_false_positive_table_reason: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _extract_table_cell_candidates: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _ordered_line_indexes: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Equivalent behavior exists in mupdfExtraction.js.',
  },
  _combine_bbox: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _horizontal_gap: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _same_baseline: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _extract_page_words: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _word_center_x: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _order_word_tokens_for_direction: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _join_word_tokens: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _compose_structured_kv_text: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _split_words_by_gap: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _word_overlap_ratio: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _split_structured_kv_block_candidate: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _expand_structured_kv_candidates: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _geometry_candidate_from_lines: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _build_geometry_rows: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _build_block_candidates_from_rows: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _compose_block_text: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _block_type: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _extract_image_blocks: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _detect_vector_graphic_regions: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _serialize_line: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _serialize_word: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _serialize_candidate: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _serialize_geometry_row: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  _extract_digital_page_layout_impl: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  extract_digital_page_layout: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
  build_digital_layouts: {
    status: PORT_STATUS.PORTED_TESTED,
    tested: true,
    notes: 'Ported directly from Python into digitalStagePort.js.',
  },
};

function decodeLatin1(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return LATIN1_DECODER.decode(value);
  }
  if (value instanceof ArrayBuffer) {
    return LATIN1_DECODER.decode(new Uint8Array(value));
  }
  if (Array.isArray(value)) {
    return LATIN1_DECODER.decode(Uint8Array.from(value));
  }
  if (value && typeof value === 'object' && typeof value.byteLength === 'number') {
    return LATIN1_DECODER.decode(new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength));
  }
  return String(value || '');
}

function pageGetText(page, mode) {
  if (typeof page?.get_text === 'function') {
    return page.get_text(mode);
  }
  if (typeof page?.getText === 'function') {
    return page.getText(mode);
  }
  throw new Error(`page text API is unavailable for mode: ${mode}`);
}

function pageGetDrawings(page, options = {}) {
  if (typeof page?.get_drawings === 'function') {
    return page.get_drawings(options);
  }
  if (typeof page?.getDrawings === 'function') {
    return page.getDrawings(options);
  }
  return [];
}

function logSuspiciousStyleExtraction({ span, key, bbox, direction, pageWidth }) {
  const fontSize = Number(key?.[1]);
  if (!Number.isFinite(fontSize) || fontSize >= 1.0) {
    return;
  }
  console.warn('[digital-stage-port] suspicious extracted style font size', {
    fontSize,
    spanText: String(span?.text || '').slice(0, 160),
    spanFont: String(span?.font || ''),
    rawSpanSize: Number(span?.size),
    bbox: Array.isArray(bbox) ? bbox.map((value) => Number(value)) : bbox,
    direction,
    pageWidth,
  });
}

export function _extract_text_render_modes(page) {
  const pageHeight = Number(page?.rect?.height || 0);
  const result = [];
  let streamText = '';
  try {
    if (typeof page?.getContents === 'function') {
      streamText = String(page.getContents() || '');
    } else {
      const contents = page?.get_contents?.();
      if (!contents || contents.length === 0) {
        return result;
      }
      const streamParts = [];
      for (const xref of contents) {
        const raw = page?.parent?.xref_stream?.(xref);
        streamParts.push(decodeLatin1(raw));
      }
      streamText = streamParts.join('\n');
    }
    if (!streamText) {
      return result;
    }
  } catch {
    return result;
  }

  for (const btMatch of streamText.matchAll(_BT_ET_BLOCK_RE)) {
    const btContent = btMatch[1] || '';
    let currentRenderMode = 0;
    let currentStrokeWidth = 0.0;
    let txtX = 0.0;
    let txtY = 0.0;
    let lineStartX = 0.0;
    let lineStartY = 0.0;
    for (const opMatch of btContent.matchAll(_TEXT_STREAM_OP_RE)) {
      const full = String(opMatch[0] || '').trimEnd();
      if (opMatch[3] != null) {
        currentRenderMode = Number.parseInt(opMatch[3], 10);
        if (Number.isNaN(currentRenderMode)) {
          currentRenderMode = 0;
        }
      } else if (opMatch[4] != null) {
        currentStrokeWidth = Number(opMatch[4]);
        if (!Number.isFinite(currentStrokeWidth)) {
          currentStrokeWidth = 0.0;
        }
      } else if (opMatch[5] != null) {
        const tx = Number(opMatch[5]);
        const ty = Number(opMatch[6]);
        lineStartX += Number.isFinite(tx) ? tx : 0.0;
        lineStartY += Number.isFinite(ty) ? ty : 0.0;
        txtX = lineStartX;
        txtY = lineStartY;
      } else if (opMatch[7] != null) {
        const nextX = Number(opMatch[11]);
        const nextY = Number(opMatch[12]);
        if (Number.isFinite(nextX)) {
          txtX = nextX;
          lineStartX = nextX;
        }
        if (Number.isFinite(nextY)) {
          txtY = nextY;
          lineStartY = nextY;
        }
      } else if ((full.endsWith('Tj') || full.endsWith('TJ')) && currentRenderMode !== 0) {
        result.push({
          page_x: Number(txtX),
          page_y: Number(pageHeight - txtY),
          render_mode: Number(currentRenderMode),
          stroke_width: Number(currentStrokeWidth),
        });
      }
    }
  }
  return result;
}
export function _lookup_render_mode(bbox, entries, { tolerance = 6.0 } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [0, 0.0];
  }
  const bx = Number(bbox[2]);
  const by = Number(bbox[3]);
  let bestDist = Number.POSITIVE_INFINITY;
  let best = [0, 0.0];
  for (const entry of entries) {
    const dy = Math.abs(Number(entry.page_y) - by);
    if (dy > Number(tolerance)) {
      continue;
    }
    const dx = Math.abs(Number(entry.page_x) - bx);
    const dist = dy + dx * 0.05;
    if (dist < bestDist) {
      bestDist = dist;
      best = [Number(entry.render_mode), Number(entry.stroke_width)];
    }
  }
  return best;
}
export function _infer_direction(text) {
  const value = String(text || '');
  const rtlCount = [...value].filter((char) => RTL_PATTERN.test(char)).length;
  const ltrCount = [...value].filter((char) => LTR_PATTERN.test(char)).length;
  if (rtlCount === 0 && ltrCount === 0) {
    return 'UNKNOWN';
  }
  return rtlCount >= ltrCount ? 'RTL' : 'LTR';
}
export function _normalize_rtl_label_colon_order(text) {
  function normalizeLine(line) {
    const normalized = String(line || '').trim();
    if (!normalized) {
      return normalized;
    }
    const match = normalized.match(RTL_LABEL_WITH_LEADING_COLON_RE);
    if (match) {
      const label = normalizeWhitespace(match[1]);
      return `${label}:`;
    }
    if (!normalized.startsWith(':')) {
      return normalized;
    }
    const payload = normalized.slice(1).trim();
    if (!payload || !RTL_PATTERN.test(payload)) {
      return normalized;
    }
    const valueMatch = payload.match(RTL_LABEL_VALUE_START_RE);
    if (!valueMatch || valueMatch.index == null) {
      return normalized;
    }
    const label = normalizeWhitespace(payload.slice(0, valueMatch.index));
    const value = payload.slice(valueMatch.index).trim();
    if (!label || !value || !RTL_PATTERN.test(label)) {
      return normalized;
    }
    return `${label}: ${value}`;
  }

  const lines = String(text || '').split('\n');
  if (lines.length <= 1) {
    return normalizeLine(String(text || ''));
  }
  return lines.map((line) => normalizeLine(line)).join('\n');
}
export function _to_hex_color(colorValue) {
  const rgb = Number(colorValue || 0) & 0xFFFFFF;
  return `#${rgb.toString(16).padStart(6, '0')}`;
}
export function _infer_alignment(bbox, pageWidth, direction) {
  const x0 = Number(bbox[0]);
  const x1 = Number(bbox[2]);
  const width = Number(pageWidth);
  const leftMargin = x0;
  const rightMargin = width - x1;
  const balancedMargins = Math.abs(leftMargin - rightMargin) <= width * 0.03;
  const widthRatio = Math.max(0, x1 - x0) / Math.max(1, width);
  const hasClearSideMargins = Math.min(leftMargin, rightMargin) >= width * 0.08;
  if (balancedMargins && hasClearSideMargins && widthRatio <= 0.8) {
    return 'center';
  }
  if (direction === 'RTL') {
    return 'right';
  }
  if (direction === 'LTR') {
    return 'left';
  }
  return 'left';
}
export function _style_key(span, lineBbox, pageWidth, lineDirection, renderModes = null) {
  const fontName = String(span?.font || 'unknown');
  const fontSize = Math.round(Number(span?.size ?? 12.0) * 100) / 100;
  const flags = Number(span?.flags ?? 0);
  const isBold = Boolean(flags & 16) || fontName.toLowerCase().includes('bold');
  const isItalic = Boolean(flags & 2) || fontName.toLowerCase().includes('italic');
  const color = _to_hex_color(Number(span?.color ?? 0));
  const alignment = _infer_alignment(lineBbox, pageWidth, lineDirection);
  const [renderMode, strokeWidth] = _lookup_render_mode(lineBbox, renderModes || []);
  return [
    fontName,
    fontSize,
    isBold ? 'bold' : 'normal',
    isItalic,
    color,
    alignment,
    1.2,
    renderMode,
    strokeWidth,
  ];
}
export function _detect_two_columns(lines, pageWidth) {
  if (!Array.isArray(lines) || lines.length < 4) {
    return null;
  }
  const centers = lines
    .map((line) => (Number(line.bbox[0]) + Number(line.bbox[2])) / 2)
    .sort((left, right) => left - right);
  if (centers.length < 2) {
    return null;
  }
  const gaps = centers.slice(0, -1).map((value, index) => [index, centers[index + 1] - value]);
  const [splitIndex, largestGap] = gaps.reduce((best, current) => (current[1] > best[1] ? current : best));
  if (largestGap < Number(pageWidth) * 0.18) {
    return null;
  }
  const splitValue = (centers[splitIndex] + centers[splitIndex + 1]) / 2;
  const leftCount = centers.filter((center) => center <= splitValue).length;
  const rightCount = centers.length - leftCount;
  if (leftCount < 2 || rightCount < 2) {
    return null;
  }
  return splitValue;
}

export function _assign_columns(lines, pageWidth, direction) {
  const splitValue = _detect_two_columns(lines, pageWidth);
  for (const line of lines || []) {
    if (splitValue === null) {
      line.column = 0;
    } else {
      const centerX = (Number(line.bbox[0]) + Number(line.bbox[2])) / 2;
      line.column = centerX <= splitValue ? 0 : 1;
    }
  }
  if (splitValue === null) {
    return [0];
  }
  return direction === 'RTL' ? [1, 0] : [0, 1];
}
export function _extract_lines_and_styles(page) {
  const rawDict = pageGetText(page, 'dict') || {};
  const pageWidth = Number(page?.rect?.width || 0);
  const renderModeEntries = _extract_text_render_modes(page);
  const styleRegistry = new Map();
  const styles = [];
  const lines = [];
  const styledSpans = [];

  function splitLineSpans(spans, { line_bbox: lineBbox }) {
    if (!Array.isArray(spans) || spans.length <= 1) {
      return [spans || []];
    }
    const lineHeight = Math.max(1.0, Number(lineBbox[3]) - Number(lineBbox[1]));
    const splitGapThreshold = Math.max(pageWidth * 0.06, lineHeight * 4.0);
    const fragments = [];
    let currentFragment = [spans[0]];
    let previousBbox = (spans[0]?.bbox || [0, 0, 0, 0]).map((value) => Number(value));
    for (const span of spans.slice(1)) {
      const spanBbox = (span?.bbox || [0, 0, 0, 0]).map((value) => Number(value));
      const gap = _horizontal_gap(previousBbox, spanBbox);
      if (gap > splitGapThreshold) {
        fragments.push(currentFragment);
        currentFragment = [span];
      } else {
        currentFragment.push(span);
      }
      previousBbox = spanBbox;
    }
    fragments.push(currentFragment);
    return fragments;
  }

  function textFromSpans(spans) {
    const chunks = [];
    let previousBbox = null;
    for (const span of spans || []) {
      const spanText = String(span?.text || '');
      if (!spanText.trim()) {
        continue;
      }
      const spanBbox = (span?.bbox || [0, 0, 0, 0]).map((value) => Number(value));
      if (
        previousBbox !== null
        && _horizontal_gap(previousBbox, spanBbox) > 1.0
        && chunks.length
        && !String(chunks[chunks.length - 1]).endsWith(' ')
        && !spanText.startsWith(' ')
      ) {
        chunks.push(' ');
      }
      chunks.push(spanText);
      previousBbox = spanBbox;
    }
    return _normalize_rtl_label_colon_order(chunks.join('').trim());
  }

  function resolveStyle(span, { bbox, direction }) {
    const key = _style_key(span, bbox, pageWidth, direction, renderModeEntries);
    logSuspiciousStyleExtraction({ span, key, bbox, direction, pageWidth });
    const keyJson = JSON.stringify(key);
    let styleId = styleRegistry.get(keyJson);
    if (styleId == null) {
      styleId = `s${styles.length + 1}`;
      styleRegistry.set(keyJson, styleId);
      styles.push({
        style_id: styleId,
        font_family: key[0],
        font_size: key[1],
        weight: key[2],
        italic: key[3],
        color: key[4],
        alignment: key[5],
        line_spacing: key[6],
        render_mode: key[7],
        stroke_width: key[8],
      });
    }
    return styleId;
  }

  for (const rawBlock of rawDict.blocks || []) {
    if (rawBlock?.type !== 0) {
      continue;
    }
    for (const rawLine of rawBlock.lines || []) {
      const rawSpans = rawLine.spans || [];
      const lineBbox = (rawLine.bbox || [0, 0, 0, 0]).map((value) => Number(value));
      const spanGroups = splitLineSpans(rawSpans, { line_bbox: lineBbox });
      if (!spanGroups.length) {
        continue;
      }
      for (const spans of spanGroups) {
        const text = textFromSpans(spans);
        if (!text) {
          continue;
        }
        const mergedBbox = _combine_bbox(
          spans.map((span) => (span?.bbox || [0, 0, 0, 0]).map((value) => Number(value))),
        );
        const lineDirection = _infer_direction(text);
        const referenceSpan = spans.find((span) => span?.text) || spans[0];
        const styleId = resolveStyle(referenceSpan, { bbox: mergedBbox, direction: lineDirection });
        const key = _style_key(referenceSpan, mergedBbox, pageWidth, lineDirection, renderModeEntries);
        lines.push({
          text,
          bbox: mergedBbox,
          style_id: styleId,
          style_core: [key[0], key[1], key[2], key[3], key[4], key[6]],
          font_size: key[1],
          direction: lineDirection,
          column: 0,
        });
        for (const rawSpan of spans) {
          const spanText = String(rawSpan?.text || '').trim();
          if (!spanText) {
            continue;
          }
          const spanBbox = (rawSpan?.bbox || [0, 0, 0, 0]).map((value) => Number(value));
          const spanDirection = _infer_direction(spanText);
          const spanStyleId = resolveStyle(rawSpan, { bbox: spanBbox, direction: spanDirection });
          styledSpans.push({
            text: spanText,
            bbox: spanBbox,
            style_id: spanStyleId,
            direction: spanDirection,
          });
        }
      }
    }
  }

  return [lines, styles, styledSpans];
}
export function _bbox_area(bbox) {
  return Math.max(0, Number(bbox[2]) - Number(bbox[0])) * Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

export function _bbox_intersection_area(left, right) {
  const x0 = Math.max(Number(left[0]), Number(right[0]));
  const y0 = Math.max(Number(left[1]), Number(right[1]));
  const x1 = Math.min(Number(left[2]), Number(right[2]));
  const y1 = Math.min(Number(left[3]), Number(right[3]));
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}
export function _bbox_overlap_ratio(inner, outer) {
  const innerArea = _bbox_area(inner);
  if (innerArea <= 0) {
    return 0;
  }
  return _bbox_intersection_area(inner, outer) / innerArea;
}
export function _is_line_inside_any_table(lineBbox, tableBboxes, { table_regions = null } = {}) {
  const lineArea = _bbox_area(lineBbox);
  if (lineArea <= 0) {
    return false;
  }
  if (Array.isArray(table_regions)) {
    for (const tableRegion of table_regions) {
      const overlapRatio = _bbox_intersection_area(lineBbox, tableRegion) / lineArea;
      if (overlapRatio >= 0.5) {
        return true;
      }
    }
  }
  for (const tableBbox of tableBboxes || []) {
    const overlapRatio = _bbox_intersection_area(lineBbox, tableBbox) / lineArea;
    if (overlapRatio >= 0.5) {
      return true;
    }
  }
  return false;
}
export function _dedupe_table_cell_candidates(candidates) {
  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const [x0, y0, x1, y1] = candidate.bbox.map((value) => Number(value));
    const key = JSON.stringify([
      Number(x0.toFixed(3)),
      Number(y0.toFixed(3)),
      Number(x1.toFixed(3)),
      Number(y1.toFixed(3)),
      candidate.style_id,
      candidate.text,
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}
export function _prune_spanning_table_cells(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 3) {
    return candidates;
  }
  const heights = candidates.map((candidate) => Math.max(0, Number(candidate.bbox[3]) - Number(candidate.bbox[1])));
  const medianHeight = heights.length ? median(heights) : 0.0;
  if (medianHeight <= 0) {
    return candidates;
  }

  const kept = [];
  for (const candidate of candidates) {
    const candidateArea = _bbox_area(candidate.bbox);
    const candidateHeight = Math.max(0, Number(candidate.bbox[3]) - Number(candidate.bbox[1]));
    if (candidateArea <= 0) {
      kept.push(candidate);
      continue;
    }

    let coveredSmallerCells = 0;
    for (const other of candidates) {
      if (other === candidate) {
        continue;
      }
      const otherArea = _bbox_area(other.bbox);
      if (otherArea <= 0 || otherArea >= candidateArea * 0.95) {
        continue;
      }
      const overlap = _bbox_intersection_area(candidate.bbox, other.bbox);
      if (overlap / otherArea >= 0.85) {
        coveredSmallerCells += 1;
      }
    }

    const isSpanningOutlier = (
      candidateHeight >= medianHeight * 1.8
      && coveredSmallerCells >= 2
      && String(candidate.text || '').split('\n').length - 1 >= 2
    );
    if (isSpanningOutlier) {
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}
export function _is_boundary_table_row_outlier(row, { median_height }) {
  const medianHeight = Number(median_height);
  if (medianHeight <= 0) {
    return false;
  }
  if (Number(row.cell_count) <= 0) {
    return false;
  }
  const sparseLimit = Math.max(3, Math.round(Number(row.cell_count) * 0.6));
  return (
    Number(row.height) >= Math.max(24.0, medianHeight * 2.5)
    && Number(row.non_empty_cells) <= sparseLimit
  );
}
export function _trim_boundary_table_rows(rows) {
  if (!Array.isArray(rows) || rows.length < 3) {
    return rows;
  }
  let heights = rows
    .filter((row) => Number(row.height) > 0.0 && Number(row.non_empty_cells) > 0)
    .map((row) => Number(row.height));
  if (heights.length === 0) {
    heights = rows.filter((row) => Number(row.height) > 0.0).map((row) => Number(row.height));
  }
  const medianHeight = heights.length ? median(heights) : 0.0;
  if (medianHeight <= 0) {
    return rows;
  }

  let start = 0;
  while (start < rows.length && _is_boundary_table_row_outlier(rows[start], { median_height: medianHeight })) {
    start += 1;
  }

  let end = rows.length;
  while (end > start && _is_boundary_table_row_outlier(rows[end - 1], { median_height: medianHeight })) {
    end -= 1;
  }

  const trimmed = rows.slice(start, end);
  return trimmed.length ? trimmed : rows;
}
export function _reject_false_positive_table_reason({ rows, lines }) {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(lines) || lines.length === 0) {
    return '';
  }

  const nonEmptyCells = rows.flatMap((row) =>
    (row.cells || [])
      .filter(([, text]) => String(text || '').trim())
      .map(([bbox, text]) => [bbox, text]),
  );
  if (nonEmptyCells.length === 0) {
    return '';
  }

  const regionBbox = _combine_bbox(rows.map((row) => row.bbox));
  const regionArea = _bbox_area(regionBbox);
  if (regionArea <= 0) {
    return '';
  }

  const [dominantBbox, dominantText] = nonEmptyCells.reduce((best, current) =>
    (_bbox_area(current[0]) > _bbox_area(best[0]) ? current : best)
  );
  const dominantAreaRatio = _bbox_area(dominantBbox) / regionArea;
  const linesInRegion = lines.filter((line) => _bbox_overlap_ratio(line.bbox, dominantBbox) >= 0.6);
  const uniqueBaselines = new Set(
    linesInRegion.map((line) => [Number(line.bbox[1]).toFixed(1), Number(line.bbox[3]).toFixed(1)].join(':')),
  );

  if (
    rows.length === 1
    && nonEmptyCells.length === 1
    && dominantAreaRatio >= 0.75
    && linesInRegion.length >= 4
    && uniqueBaselines.size >= 3
    && String(dominantText).split('\n').length - 1 >= 2
  ) {
    return 'single_cell_table_overrides_multiple_text_rows';
  }

  if (
    rows.length <= 2
    && nonEmptyCells.length <= 2
    && dominantAreaRatio >= 0.65
    && linesInRegion.length >= 8
    && uniqueBaselines.size >= 5
    && String(dominantText).split('\n').length - 1 >= 4
  ) {
    return 'sparse_dominant_table_cell_overrides_dense_text_geometry';
  }

  return '';
}
export function _extract_table_cell_candidates(page, { spans, lines, debug_tables = null }) {
  let tableFinder;
  try {
    tableFinder = page.find_tables();
  } catch {
    return [[], []];
  }

  const candidates = [];
  const tableRegions = [];
  const defaultStyleId = Array.isArray(spans) && spans.length ? spans[0].style_id : null;
  for (const [tableIndexZero, table] of (tableFinder.tables || []).entries()) {
    const tableIndex = tableIndexZero + 1;
    const rawRows = [];
    for (const row of table.rows || []) {
      const rowCells = [];
      for (const cell of row.cells || []) {
        if (cell == null) {
          continue;
        }
        const cellBbox = cell.map((value) => Number(value));
        const text = _normalize_rtl_label_colon_order(String(page.get_textbox({ x0: cellBbox[0], y0: cellBbox[1], x1: cellBbox[2], y1: cellBbox[3] }) || '').trim());
        rowCells.push([cellBbox, text]);
      }
      if (!rowCells.length) {
        continue;
      }
      const rowBbox = _combine_bbox(rowCells.map(([bbox]) => bbox));
      rawRows.push({
        cells: rowCells,
        bbox: rowBbox,
        height: Math.max(0.0, rowBbox[3] - rowBbox[1]),
        non_empty_cells: rowCells.filter(([, text]) => text).length,
        cell_count: rowCells.length,
      });
    }

    const keptRows = _trim_boundary_table_rows(rawRows);
    const rejectedReason = _reject_false_positive_table_reason({ rows: keptRows, lines });
    const tableBbox = table.bbox
      ? table.bbox.map((value) => Number(value))
      : (rawRows.length ? _combine_bbox(rawRows.map((row) => row.bbox)) : [0.0, 0.0, 1.0, 1.0]);
    if (Array.isArray(debug_tables)) {
      debug_tables.push({
        table_index: tableIndex,
        bbox: tableBbox.map((value) => Number(value)),
        row_count: rawRows.length,
        kept_row_count: keptRows.length,
        accepted: !Boolean(rejectedReason),
        rejected_reason: rejectedReason,
        rows: keptRows.map((row) => ({
          bbox: row.bbox.map((value) => Number(value)),
          height: Number(row.height),
          non_empty_cells: Number(row.non_empty_cells),
          cell_count: Number(row.cell_count),
          cells: row.cells.map(([cellBbox, text]) => ({
            bbox: cellBbox.map((value) => Number(value)),
            text,
          })),
        })),
      });
    }
    if (rejectedReason) {
      continue;
    }

    const keptHeights = keptRows.map((row) => Number(row.height)).filter((height) => height > 0.0);
    const keptMedianHeight = keptHeights.length ? median(keptHeights) : 0.0;

    const regionCells = [];
    for (const row of keptRows) {
      if (
        Number(row.non_empty_cells) === 0
        && keptMedianHeight > 0.0
        && Number(row.height) >= Math.max(24.0, keptMedianHeight * 2.5)
      ) {
        continue;
      }
      for (const [cellBbox, text] of row.cells) {
        regionCells.push(cellBbox);
        if (!text) {
          continue;
        }

        const styleAreaById = new Map();
        for (const span of spans || []) {
          const area = _bbox_intersection_area(span.bbox, cellBbox);
          if (area <= 0) {
            continue;
          }
          styleAreaById.set(span.style_id, (styleAreaById.get(span.style_id) || 0.0) + area);
        }

        let styleId = null;
        if (styleAreaById.size) {
          styleId = [...styleAreaById.entries()].sort((left, right) => right[1] - left[1])[0][0];
        } else if (defaultStyleId != null) {
          styleId = defaultStyleId;
        } else {
          continue;
        }

        candidates.push({
          bbox: cellBbox,
          text,
          style_id: styleId,
          type: 'table_cell',
        });
      }
    }
    if (regionCells.length) {
      tableRegions.push(_combine_bbox(regionCells));
    }
  }

  const deduped = _dedupe_table_cell_candidates(candidates);
  return [_prune_spanning_table_cells(deduped), tableRegions];
}
export function _ordered_line_indexes(lines, columnOrder, direction) {
  const columnRank = new Map((columnOrder || []).map((column, rank) => [column, rank]));
  return [...(lines || []).keys()].sort((leftIndex, rightIndex) => {
    const left = lines[leftIndex];
    const right = lines[rightIndex];
    const leftHorizontal = direction === 'RTL' ? -Number(left.bbox[2]) : Number(left.bbox[0]);
    const rightHorizontal = direction === 'RTL' ? -Number(right.bbox[2]) : Number(right.bbox[0]);
    const leftKey = [
      Number(columnRank.get(left.column) ?? 0),
      Number(left.bbox[1]),
      leftHorizontal,
    ];
    const rightKey = [
      Number(columnRank.get(right.column) ?? 0),
      Number(right.bbox[1]),
      rightHorizontal,
    ];
    if (leftKey[0] !== rightKey[0]) {
      return leftKey[0] - rightKey[0];
    }
    if (leftKey[1] !== rightKey[1]) {
      return leftKey[1] - rightKey[1];
    }
    return leftKey[2] - rightKey[2];
  });
}
export function _combine_bbox(bboxes) {
  return [
    Math.min(...bboxes.map((bbox) => Number(bbox[0]))),
    Math.min(...bboxes.map((bbox) => Number(bbox[1]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[2]))),
    Math.max(...bboxes.map((bbox) => Number(bbox[3]))),
  ];
}
export function _horizontal_gap(left, right) {
  if (Number(left[2]) < Number(right[0])) {
    return Number(right[0]) - Number(left[2]);
  }
  if (Number(right[2]) < Number(left[0])) {
    return Number(left[0]) - Number(right[2]);
  }
  return 0;
}
export function _same_baseline(left, right, { tolerance }) {
  return (
    Math.abs(Number(left[1]) - Number(right[1])) <= Number(tolerance)
    && Math.abs(Number(left[3]) - Number(right[3])) <= Number(tolerance)
  );
}
export function _extract_page_words(page) {
  const words = [];
  let rawWords;
  try {
    rawWords = pageGetText(page, 'words');
  } catch {
    return words;
  }
  for (const raw of rawWords || []) {
    if (!Array.isArray(raw) || raw.length < 8) {
      continue;
    }
    const [x0, y0, x1, y1, text, block_no, line_no, word_no] = raw;
    const token = String(text || '').trim();
    if (!token) {
      continue;
    }
    words.push({
      text: token,
      bbox: [Number(x0), Number(y0), Number(x1), Number(y1)],
      block_no: Number(block_no),
      line_no: Number(line_no),
      word_no: Number(word_no),
    });
  }
  return words;
}
export function _word_center_x(word) {
  return (Number(word.bbox[0]) + Number(word.bbox[2])) / 2;
}

export function _order_word_tokens_for_direction(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }
  const direction = _infer_direction(words.map((word) => word.text).join(' '));
  if (direction === 'RTL') {
    return [...words].sort((left, right) => (
      Number(right.bbox[0]) - Number(left.bbox[0]) || Number(left.word_no ?? left.wordNo ?? 0) - Number(right.word_no ?? right.wordNo ?? 0)
    ));
  }
  if (direction === 'LTR') {
    return [...words].sort((left, right) => (
      Number(left.bbox[0]) - Number(right.bbox[0]) || Number(left.word_no ?? left.wordNo ?? 0) - Number(right.word_no ?? right.wordNo ?? 0)
    ));
  }
  return [...words].sort((left, right) => Number(left.word_no ?? left.wordNo ?? 0) - Number(right.word_no ?? right.wordNo ?? 0));
}
export function _join_word_tokens(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return '';
  }
  const noSpaceBefore = new Set(['.', ',', ';', ':', '!', '?', '%', ')', ']', '}']);
  const result = [];
  for (const token of words.map((word) => word.text)) {
    if (!token) {
      continue;
    }
    if (result.length === 0) {
      result.push(token);
      continue;
    }
    const previous = result[result.length - 1];
    if (noSpaceBefore.has(token)) {
      result[result.length - 1] = `${previous}${token}`;
      continue;
    }
    if (/[([{/]$/.test(previous)) {
      result[result.length - 1] = `${previous}${token}`;
      continue;
    }
    if (previous.endsWith('.') && token.length <= 2) {
      result[result.length - 1] = `${previous}${token}`;
      continue;
    }
    if (previous.endsWith('-')) {
      result[result.length - 1] = `${previous}${token}`;
      continue;
    }
    result.push(` ${token}`);
  }

  let normalized = result.join('').trim();
  normalized = normalized.replace(/\s*:\s*/g, ': ');
  normalized = normalized.replace(/(?<=\w)\s*\.\s*(?=\w)/g, '.');
  normalized = normalizeWhitespace(normalized);
  return normalized.trim();
}
export function _compose_structured_kv_text(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return '';
  }
  const ordered = _order_word_tokens_for_direction(words);
  const fallback = _join_word_tokens(ordered);
  const direction = _infer_direction(ordered.map((word) => word.text).join(' '));
  const colonTokens = words.filter((word) => word.text === ':');
  if (direction !== 'RTL' || colonTokens.length !== 1) {
    return fallback;
  }

  const colon = colonTokens[0];
  const colonX = _word_center_x(colon);
  const left = words.filter((word) => word !== colon && _word_center_x(word) < colonX - 0.25);
  const right = words.filter((word) => word !== colon && _word_center_x(word) > colonX + 0.25);
  if (left.length === 0 || right.length === 0) {
    return fallback;
  }
  if (!RTL_PATTERN.test(right.map((word) => word.text).join(' '))) {
    return fallback;
  }

  const keyText = _join_word_tokens(_order_word_tokens_for_direction(right));
  const valueText = _join_word_tokens(_order_word_tokens_for_direction(left));
  if (!keyText || !valueText) {
    return fallback;
  }
  return `${keyText}: ${valueText}`;
}
export function _split_words_by_gap(words, { gap_threshold }) {
  if (!Array.isArray(words) || words.length <= 1) {
    return [words];
  }
  const ordered = [...words].sort((left, right) => Number(left.bbox[0]) - Number(right.bbox[0]));
  const groups = [];
  let current = [ordered[0]];
  for (const currentWord of ordered.slice(1)) {
    const previous = current.at(-1);
    const gap = Number(currentWord.bbox[0]) - Number(previous.bbox[2]);
    if (gap > Number(gap_threshold)) {
      groups.push(current);
      current = [currentWord];
    } else {
      current.push(currentWord);
    }
  }
  groups.push(current);
  return groups;
}

export function _word_overlap_ratio(wordBBox, targetBBox) {
  const area = _bbox_area(wordBBox);
  if (area <= 0) {
    return 0;
  }
  return _bbox_intersection_area(wordBBox, targetBBox) / area;
}
export function _split_structured_kv_block_candidate(candidate, { page_words, page_width, page_direction }) {
  if (candidate.type !== 'paragraph') {
    return null;
  }
  if (!String(candidate.text || '').includes(':')) {
    return null;
  }
  if (_infer_direction(candidate.text) !== 'RTL') {
    return null;
  }

  const candidateWords = (page_words || []).filter((word) => _word_overlap_ratio(word.bbox, candidate.bbox) >= 0.55);
  if (candidateWords.length < 4) {
    return null;
  }

  const lineGroups = new Map();
  for (const word of candidateWords) {
    const key = `${Number(word.block_no)}:${Number(word.line_no)}`;
    if (!lineGroups.has(key)) {
      lineGroups.set(key, []);
    }
    lineGroups.get(key).push(word);
  }
  if (lineGroups.size === 0) {
    return null;
  }

  const rows = [...lineGroups.values()].sort((left, right) => (
    Math.min(...left.map((word) => Number(word.bbox[1]))) - Math.min(...right.map((word) => Number(word.bbox[1])))
  ));
  const fragments = [];
  let sawSplitLine = false;
  for (const row of rows) {
    if (!row.length) {
      continue;
    }
    const rowHeights = row.map((word) => Math.max(1.0, Number(word.bbox[3]) - Number(word.bbox[1])));
    const rowHeight = rowHeights.length ? median(rowHeights) : 1.0;
    const gapThreshold = Math.max(Number(page_width) * 0.04, rowHeight * 3.0);
    const groups = _split_words_by_gap(row, { gap_threshold: gapThreshold });
    if (groups.length > 1) {
      sawSplitLine = true;
    }
    for (const group of groups) {
      const text = _compose_structured_kv_text(group);
      if (!text) {
        continue;
      }
      fragments.push({
        bbox: _combine_bbox(group.map((word) => word.bbox)),
        text,
        style_id: candidate.style_id,
        type: candidate.type,
      });
    }
  }

  if (!sawSplitLine || fragments.length <= 1) {
    return null;
  }

  const colonFragments = fragments.filter((fragment) => String(fragment.text).includes(':')).length;
  if (colonFragments === 0) {
    return null;
  }

  return fragments.sort((left, right) => {
    const leftHorizontal = page_direction === 'RTL' ? -Number(left.bbox[2]) : Number(left.bbox[0]);
    const rightHorizontal = page_direction === 'RTL' ? -Number(right.bbox[2]) : Number(right.bbox[0]);
    if (Number(left.bbox[1]) !== Number(right.bbox[1])) {
      return Number(left.bbox[1]) - Number(right.bbox[1]);
    }
    return leftHorizontal - rightHorizontal;
  });
}
export function _expand_structured_kv_candidates(candidates, { page_words, page_width, page_direction }) {
  const expanded = [];
  for (const candidate of candidates || []) {
    const split = _split_structured_kv_block_candidate(candidate, { page_words, page_width, page_direction });
    if (split) {
      expanded.push(...split);
    } else {
      expanded.push(candidate);
    }
  }
  return expanded;
}
export function _geometry_candidate_from_lines(lines, { baseline_tolerance }) {
  const bbox = _combine_bbox(lines.map((line) => line.bbox));
  const styleVotes = new Map();
  for (const line of lines) {
    styleVotes.set(line.style_id, (styleVotes.get(line.style_id) || 0) + 1);
  }
  const dominantStyleId = [...styleVotes.entries()].sort((left, right) => right[1] - left[1])[0][0];

  const styleCoreVotes = new Map();
  for (const line of lines) {
    const key = JSON.stringify(line.style_core);
    const current = styleCoreVotes.get(key);
    styleCoreVotes.set(key, { count: (current?.count || 0) + 1, value: line.style_core });
  }
  const dominantStyleCore = [...styleCoreVotes.values()].sort((left, right) => right.count - left.count)[0].value;

  const columnVotes = new Map();
  for (const line of lines) {
    columnVotes.set(line.column, (columnVotes.get(line.column) || 0) + 1);
  }
  const dominantColumn = [...columnVotes.entries()].sort((left, right) => right[1] - left[1])[0][0];

  return {
    bbox,
    text: _compose_block_text(lines, { baseline_tolerance }),
    style_id: dominantStyleId,
    style_core: dominantStyleCore,
    font_sizes: lines.map((line) => Number(line.font_size)),
    column: Number(dominantColumn),
  };
}
export function _build_geometry_rows({ lines, ordered_indexes, baseline_tolerance, inline_gap_threshold }) {
  if (!Array.isArray(ordered_indexes) || ordered_indexes.length === 0) {
    return [];
  }

  const rows = [];
  let currentLines = [lines[ordered_indexes[0]]];
  for (const idx of ordered_indexes.slice(1)) {
    const current = lines[idx];
    const previous = currentLines[currentLines.length - 1];
    const sameBaseline = _same_baseline(current.bbox, previous.bbox, { tolerance: baseline_tolerance });
    const closeHorizontal = _horizontal_gap(current.bbox, previous.bbox) <= inline_gap_threshold;
    if (
      sameBaseline
      && current.column === previous.column
      && JSON.stringify(current.style_core) === JSON.stringify(previous.style_core)
      && closeHorizontal
    ) {
      currentLines.push(current);
      continue;
    }
    rows.push(_geometry_candidate_from_lines(currentLines, { baseline_tolerance }));
    currentLines = [current];
  }

  rows.push(_geometry_candidate_from_lines(currentLines, { baseline_tolerance }));
  return rows;
}
export function _build_block_candidates_from_rows({ rows, page_width }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const rowHeights = rows.map((row) => Math.max(1.0, Number(row.bbox[3]) - Number(row.bbox[1])));
  const medianHeight = Math.max(1.0, median(rowHeights));
  const paragraphGapThreshold = medianHeight * 1.35;
  const indentThreshold = Number(page_width) * 0.08;
  const baselineTolerance = Math.max(1.0, medianHeight * 0.18);
  const medianFontSize = median(rows.flatMap((row) => row.font_sizes).map((fontSize) => Number(fontSize)));

  const blockCandidates = [];
  let currentRows = [rows[0]];

  function flushBlock() {
    if (!currentRows.length) {
      return;
    }
    const text = currentRows.map((row) => row.text).filter(Boolean).join('\n').trim();
    if (!text) {
      return;
    }
    const bbox = _combine_bbox(currentRows.map((row) => row.bbox));
    const styleVotes = new Map();
    for (const row of currentRows) {
      styleVotes.set(row.style_id, (styleVotes.get(row.style_id) || 0) + 1);
    }
    const dominantStyleId = [...styleVotes.entries()].sort((left, right) => right[1] - left[1])[0][0];
    const fontSizes = currentRows.flatMap((row) => row.font_sizes).map((fontSize) => Number(fontSize));
    blockCandidates.push({
      bbox,
      text,
      style_id: dominantStyleId,
      type: _block_type(fontSizes, { page_median_font_size: medianFontSize }),
    });
  }

  let previous = rows[0];
  for (const current of rows.slice(1)) {
    const sameBaseline = _same_baseline(current.bbox, previous.bbox, { tolerance: baselineTolerance });
    const verticalGap = Number(current.bbox[1]) - Number(previous.bbox[3]);
    const horizontalShift = Math.abs(Number(current.bbox[0]) - Number(previous.bbox[0]));
    const styleBreak = current.style_id !== previous.style_id;
    const startsNewBlock = (
      sameBaseline
      || current.column !== previous.column
      || verticalGap > paragraphGapThreshold
      || (horizontalShift > indentThreshold && verticalGap > medianHeight * 0.4)
      || styleBreak
    );
    if (startsNewBlock) {
      flushBlock();
      currentRows = [current];
    } else {
      currentRows.push(current);
    }
    previous = current;
  }

  flushBlock();
  return blockCandidates;
}
export function _compose_block_text(blockLines, { baseline_tolerance }) {
  if (!Array.isArray(blockLines) || blockLines.length === 0) {
    return '';
  }
  const mergedLines = [];
  let currentParts = [String(blockLines[0].text || '').trim()];
  let previous = blockLines[0];
  for (const current of blockLines.slice(1)) {
    if (_same_baseline(previous.bbox, current.bbox, { tolerance: baseline_tolerance })) {
      currentParts.push(String(current.text || '').trim());
    } else {
      const mergedLine = currentParts.filter(Boolean).join(' ');
      if (mergedLine) {
        mergedLines.push(mergedLine);
      }
      currentParts = [String(current.text || '').trim()];
    }
    previous = current;
  }
  const mergedLine = currentParts.filter(Boolean).join(' ');
  if (mergedLine) {
    mergedLines.push(mergedLine);
  }
  return mergedLines.join('\n').trim();
}
export function _block_type(lineFontSizes, { page_median_font_size }) {
  const blockMedian = median((lineFontSizes || []).map((value) => Number(value)));
  if (blockMedian >= Number(page_median_font_size) * 1.25 && (lineFontSizes || []).length <= 2) {
    return 'title';
  }
  return 'paragraph';
}
export function _extract_image_blocks(page, { page_id }) {
  const blocks = [];
  const seen = new Set();
  if (typeof page?.get_images === 'function' && typeof page?.get_image_rects === 'function') {
    for (const img of page.get_images(true) || []) {
      const xref = img[0];
      for (const rect of page.get_image_rects(xref) || []) {
        if (rect.is_empty || rect.is_infinite) {
          continue;
        }
        const bbox = [Number(rect.x0), Number(rect.y0), Number(rect.x1), Number(rect.y1)];
        const key = JSON.stringify(bbox);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        blocks.push({
          image_id: `img_${page_id}_${blocks.length + 1}`,
          page_id: Number(page_id),
          bbox,
        });
      }
    }
    return blocks;
  }

  for (const bbox of page?.getImageBlocks?.() || []) {
      const numericBbox = bbox.map((value) => Number(value));
      const key = JSON.stringify(numericBbox);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      blocks.push({
        image_id: `img_${page_id}_${blocks.length + 1}`,
        page_id: Number(page_id),
        bbox: numericBbox,
      });
  }
  return blocks;
}
export function _detect_vector_graphic_regions(page, page_id, { text_bboxes = null } = {}) {
  let drawings;
  try {
    drawings = pageGetDrawings(page);
  } catch {
    return [];
  }
  if (!Array.isArray(drawings) || drawings.length === 0) {
    return [];
  }

  const pageWidth = Number(page.rect?.width ?? 0);
  const pageHeight = Number(page.rect?.height ?? 0);
  if (pageWidth <= 0 || pageHeight <= 0) {
    return [];
  }
  if (pageWidth <= 0 || pageHeight <= 0) {
    return [];
  }

  const complexDrawings = [];
  for (const drawing of drawings) {
    const items = drawing?.items || [];
    const hasCurve = items.some((item) => item[0] === 'c');
    if (hasCurve || items.length > 4) {
      complexDrawings.push(drawing);
    }
  }
  if (complexDrawings.length === 0) {
    return [];
  }

  const drawingBboxes = [];
  for (const drawing of complexDrawings) {
    const rect = drawing?.rect;
    if (!rect) {
      continue;
    }
    const bbox = [Number(rect.x0), Number(rect.y0), Number(rect.x1), Number(rect.y1)];
    if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) {
      continue;
    }
    drawingBboxes.push(bbox);
  }
  if (drawingBboxes.length === 0) {
    return [];
  }

  const margin = 8.0;
  const clusters = [];
  const assigned = new Set();
  for (let i = 0; i < drawingBboxes.length; i += 1) {
    if (assigned.has(i)) {
      continue;
    }
    const cluster = [i];
    assigned.add(i);
    const stack = [i];
    while (stack.length) {
      const current = stack.pop();
      const currentBbox = drawingBboxes[current];
      const expanded = [
        currentBbox[0] - margin,
        currentBbox[1] - margin,
        currentBbox[2] + margin,
        currentBbox[3] + margin,
      ];
      for (let j = 0; j < drawingBboxes.length; j += 1) {
        if (assigned.has(j)) {
          continue;
        }
        const bbox = drawingBboxes[j];
        if (
          expanded[0] <= bbox[2]
          && expanded[2] >= bbox[0]
          && expanded[1] <= bbox[3]
          && expanded[3] >= bbox[1]
        ) {
          cluster.push(j);
          assigned.add(j);
          stack.push(j);
        }
      }
    }
    clusters.push(cluster);
  }

  const regions = [];
  for (let clusterIdx = 0; clusterIdx < clusters.length; clusterIdx += 1) {
    const cluster = clusters[clusterIdx];
    if (cluster.length < 3) {
      continue;
    }
    const clusterBboxes = cluster.map((index) => drawingBboxes[index]);
    const combined = _combine_bbox(clusterBboxes);
    const width = combined[2] - combined[0];
    const height = combined[3] - combined[1];
    if (width > pageWidth * 0.3 || height > pageHeight * 0.3) {
      continue;
    }

    if (Array.isArray(text_bboxes) && text_bboxes.length) {
      const combinedArea = _bbox_area(combined);
      if (combinedArea > 0) {
        const textOverlap = text_bboxes.reduce(
          (sum, bbox) => sum + _bbox_intersection_area(combined, bbox),
          0,
        );
        if (textOverlap / combinedArea > 0.3) {
          continue;
        }
      }
    }

    regions.push({
      region_id: `gr_${page_id}_${clusterIdx + 1}`,
      page_id: Number(page_id),
      bbox: combined,
      drawing_count: cluster.length,
    });
  }
  return regions;
}
export function _serialize_line(line) {
  return {
    text: line.text,
    bbox: line.bbox.map((value) => Number(value)),
    style_id: line.style_id,
    font_size: Number(line.font_size),
    direction: line.direction,
    column: Number(line.column),
  };
}
export function _serialize_word(word) {
  return {
    text: word.text,
    bbox: word.bbox.map((value) => Number(value)),
    block_no: Number(word.block_no),
    line_no: Number(word.line_no),
    word_no: Number(word.word_no),
  };
}
export function _serialize_candidate(candidate) {
  return {
    bbox: candidate.bbox.map((value) => Number(value)),
    text: candidate.text,
    style_id: candidate.style_id,
    type: candidate.type,
  };
}
export function _serialize_geometry_row(candidate) {
  return {
    bbox: candidate.bbox.map((value) => Number(value)),
    text: candidate.text,
    style_id: candidate.style_id,
    column: Number(candidate.column),
    font_sizes: (candidate.font_sizes || []).map((value) => Number(value)),
  };
}
export function _extract_digital_page_layout_impl(page, documentId, pageId) {
  const extractionStartedAt = performance.now();
  console.info('[digital-stage-port] page extraction start', {
    documentId,
    pageId: Number(pageId),
  });
  const linesStartedAt = performance.now();
  const [lines, styles, spans] = _extract_lines_and_styles(page);
  console.info('[digital-stage-port] lines/styles ready', {
    documentId,
    pageId: Number(pageId),
    durationMs: Math.round(performance.now() - linesStartedAt),
    rawLineCount: lines.length,
    styleCount: styles.length,
    spanCount: spans.length,
  });
  const tableDebug = [];
  const tablesStartedAt = performance.now();
  const [tableCandidates, tableRegions] = _extract_table_cell_candidates(page, {
    spans,
    lines,
    debug_tables: tableDebug,
  });
  console.info('[digital-stage-port] table candidates ready', {
    documentId,
    pageId: Number(pageId),
    durationMs: Math.round(performance.now() - tablesStartedAt),
    tableCandidateCount: tableCandidates.length,
    tableRegionCount: tableRegions.length,
    detectedTableCount: tableDebug.length,
  });
  const tableCellBboxes = tableCandidates.map((candidate) => candidate.bbox);
  const filteredLines = lines.filter((line) =>
    !_is_line_inside_any_table(line.bbox, tableCellBboxes, { table_regions: tableRegions }),
  );
  const pageSize = [Number(page?.rect?.width || 0), Number(page?.rect?.height || 0)];
  const assetsStartedAt = performance.now();
  const imageBlocks = _extract_image_blocks(page, { page_id: pageId });
  const textBboxesForGraphicFilter = filteredLines.map((line) => line.bbox);
  const graphicRegions = _detect_vector_graphic_regions(page, pageId, {
    text_bboxes: textBboxesForGraphicFilter,
  });
  const pageWords = _extract_page_words(page);
  console.info('[digital-stage-port] page assets ready', {
    documentId,
    pageId: Number(pageId),
    durationMs: Math.round(performance.now() - assetsStartedAt),
    filteredLineCount: filteredLines.length,
    imageCount: imageBlocks.length,
    graphicRegionCount: graphicRegions.length,
    wordCount: pageWords.length,
  });

  if (filteredLines.length === 0 && tableCandidates.length === 0) {
    const emptyLayout = {
      schema_version: SCHEMA_VERSION,
      stage: STAGE_PAGE_LAYOUT,
      document_id: documentId,
      page_id: Number(pageId),
      page_size_pt: pageSize,
      blocks: [],
      styles,
      images: imageBlocks,
      graphic_regions: graphicRegions,
    };
    return [
      emptyLayout,
      {
        page_id: Number(pageId),
        page_size_pt: pageSize,
        raw_lines: lines.map((line) => _serialize_line(line)),
        filtered_lines: [],
        words: pageWords.map((word) => _serialize_word(word)),
        tables: tableDebug,
        geometry_rows: [],
        block_candidates: [],
      },
    ];
  }

  let fullText = filteredLines.map((line) => line.text).join('\n');
  if (!fullText.trim()) {
    fullText = tableCandidates.map((candidate) => candidate.text).join('\n');
  }
  let pageDirection = _infer_direction(fullText);
  if (pageDirection === 'UNKNOWN') {
    pageDirection = 'LTR';
  }

  let orderedIndexes = [];
  if (filteredLines.length) {
    const columnOrder = _assign_columns(filteredLines, pageSize[0], pageDirection);
    orderedIndexes = _ordered_line_indexes(filteredLines, columnOrder, pageDirection);
  }

  let geometryRows = [];
  let blockCandidates = [];
  if (filteredLines.length) {
    const shapingStartedAt = performance.now();
    const lineHeights = filteredLines.map((line) => Number(line.bbox[3]) - Number(line.bbox[1]));
    const medianHeight = Math.max(1.0, median(lineHeights));
    geometryRows = _build_geometry_rows({
      lines: filteredLines,
      ordered_indexes: orderedIndexes,
      baseline_tolerance: Math.max(1.0, medianHeight * 0.18),
      inline_gap_threshold: Math.max(1.0, medianHeight * 0.5),
    });
    blockCandidates = _build_block_candidates_from_rows({
      rows: geometryRows,
      page_width: pageSize[0],
    });
    if (pageWords.length) {
      blockCandidates = _expand_structured_kv_candidates(blockCandidates, {
        page_words: pageWords,
        page_width: pageSize[0],
        page_direction: pageDirection,
      });
    }
    console.info('[digital-stage-port] rows/blocks ready', {
      documentId,
      pageId: Number(pageId),
      durationMs: Math.round(performance.now() - shapingStartedAt),
      geometryRowCount: geometryRows.length,
      blockCandidateCount: blockCandidates.length,
      pageDirection,
    });
  }

  function tableSortKey(candidate) {
    const [x0, y0, x1] = candidate.bbox;
    const horizontal = pageDirection === 'RTL' ? -Number(x1) : Number(x0);
    return [Number(y0), horizontal];
  }

  const orderedCandidates = [...blockCandidates];
  for (const tableCandidate of [...tableCandidates].sort((left, right) => {
    const leftKey = tableSortKey(left);
    const rightKey = tableSortKey(right);
    return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1];
  })) {
    let insertAt = orderedCandidates.length;
    for (let index = 0; index < orderedCandidates.length; index += 1) {
      if (Number(tableCandidate.bbox[1]) < Number(orderedCandidates[index].bbox[1])) {
        insertAt = index;
        break;
      }
    }
    orderedCandidates.splice(insertAt, 0, tableCandidate);
  }

  const blocks = orderedCandidates.map((candidate, index) => ({
    block_id: `p${pageId}_b${index + 1}`,
    page_id: Number(pageId),
    type: candidate.type,
    bbox: candidate.bbox.map((value) => Number(value)),
    text: candidate.text,
    style_id: candidate.style_id,
    reading_order: index + 1,
    source: 'digital',
    confidence: 1.0,
    flattened_line_breaks: false,
    original_text: null,
  }));

  const layout = {
    schema_version: SCHEMA_VERSION,
    stage: STAGE_PAGE_LAYOUT,
    document_id: documentId,
    page_id: Number(pageId),
    page_size_pt: pageSize,
    blocks,
    styles,
    images: imageBlocks,
    graphic_regions: graphicRegions,
  };
  const debugPayload = {
    page_id: Number(pageId),
    page_size_pt: pageSize,
    raw_lines: lines.map((line) => _serialize_line(line)),
    filtered_lines: filteredLines.map((line) => _serialize_line(line)),
    words: pageWords.map((word) => _serialize_word(word)),
    tables: tableDebug,
    geometry_rows: geometryRows.map((row) => _serialize_geometry_row(row)),
    table_candidates: tableCandidates.map((candidate) => _serialize_candidate(candidate)),
    block_candidates: orderedCandidates.map((candidate) => _serialize_candidate(candidate)),
  };
  console.info('[digital-stage-port] page extraction done', {
    documentId,
    pageId: Number(pageId),
    durationMs: Math.round(performance.now() - extractionStartedAt),
    blockCount: blocks.length,
  });
  return [layout, debugPayload];
}
export function extract_digital_page_layout(page, documentId, pageId) {
  const [layout] = _extract_digital_page_layout_impl(page, documentId, pageId);
  return layout;
}

function normalizeRequestedPages(requestedPages) {
  if (requestedPages == null) {
    return null;
  }
  if (requestedPages instanceof Set) {
    return requestedPages;
  }
  return new Set(requestedPages);
}

function makeMissingPageError(unknownIds) {
  return new Error(`requested pages not found in manifest: [${unknownIds.join(', ')}]`);
}

export function build_digital_layouts(
  manifest,
  requestedPages = null,
  includeMixed = true,
  debugSink = null,
  { openDocument = null } = {},
) {
  const buildStartedAt = performance.now();
  const allowedTypes = new Set(['DIGITAL']);
  if (includeMixed) {
    allowedTypes.add('MIXED');
  }

  const requestedPageSet = normalizeRequestedPages(requestedPages);
  const selectedPages = (manifest.pages || []).filter((page) =>
    allowedTypes.has(String(page.type))
    && (requestedPageSet === null || requestedPageSet.has(Number(page.page_id)))
  );

  if (requestedPageSet !== null) {
    const knownIds = new Set((manifest.pages || []).map((page) => Number(page.page_id)));
    const unknownIds = [...requestedPageSet].filter((pageId) => !knownIds.has(Number(pageId))).sort((left, right) => left - right);
    if (unknownIds.length) {
      throw makeMissingPageError(unknownIds);
    }
  }

  const layouts = [];
  const loader = openDocument || (() => {
    throw new Error('build_digital_layouts requires an openDocument loader in digitalStagePort.js');
  });
  const doc = loader(manifest.source_pdf);
  try {
    for (const pageSummary of selectedPages) {
      const pageStartedAt = performance.now();
      console.info('[digital-stage-port] build_digital_layouts page start', {
        documentId: manifest.document_id,
        pageId: Number(pageSummary.page_id),
        pageType: String(pageSummary.type),
      });
      const page = doc.loadPage
        ? doc.loadPage(Number(pageSummary.page_id) - 1)
        : doc[Number(pageSummary.page_id) - 1];
      const [layout, debugPayload] = _extract_digital_page_layout_impl(
        page,
        manifest.document_id,
        Number(pageSummary.page_id),
      );
      layouts.push(layout);
      if (typeof debugSink === 'function') {
        debugSink(Number(pageSummary.page_id), debugPayload);
      }
      console.info('[digital-stage-port] build_digital_layouts page done', {
        documentId: manifest.document_id,
        pageId: Number(pageSummary.page_id),
        durationMs: Math.round(performance.now() - pageStartedAt),
        blockCount: layout.blocks.length,
      });
    }
  } finally {
    if (typeof doc?.close === 'function') {
      doc.close();
    }
  }
  console.info('[digital-stage-port] build_digital_layouts done', {
    documentId: manifest.document_id,
    durationMs: Math.round(performance.now() - buildStartedAt),
    layoutCount: layouts.length,
  });
  return layouts;
}
