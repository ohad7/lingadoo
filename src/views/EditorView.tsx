import { CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

import type {
  PageBlock,
  PagePayload,
  RenderSnapshotResponse,
  SessionState,
  SnapshotRequest,
} from '../api/types';
import PropertiesPanel from '../components/PropertiesPanel';
import type { EditorSessionRuntime } from '../lib/editorSessionRuntime';
import {
  buildJoinedBlockForFit,
  mergeBlockTextParts,
  shouldRetranslateJoinedBlock,
} from '../lib/localBlockMerge';
import { resolveLineBaselinePt, rescaledLineHeightForFontSize } from '../lib/localEditorDrawPlan';
import { fitBlockToWarningPreview, recomputePageWarnings } from '../lib/localEditorWarnings';
import { createUndoStack } from '../lib/editorUndoStack';
import { computeDragSelection } from '../lib/editorSelection';
import {
  measureLinePt,
  truncateLineToWidth,
  wrapTextToWidth,
} from '../lib/textLayoutMetrics.js';
import { inferTextDirection, resolveEffectiveAlignment } from '../lib/textAlignmentPolicy.js';
import { resolveJustifiedLineSpacing } from '../lib/textJustification.js';
import {
  proposeTightTextBBox,
  resolveTightTextBBoxPreview,
} from '../lib/tightTextBBoxProposal.js';
import {
  resolveDebugInspectionsEnabledFromSearch,
  resolveEnableTesseractOcrFromSearch,
  resolveSkipSingleCharBlocksFromSearch,
} from '../lib/browserFeatureFlags.js';
import {
  extractTesseractBoxesByGranularity,
  inflateOcrBBox,
  normalizeTesseractProgressMessage,
  resolveTesseractLanguageSpec,
} from '../lib/tesseractOcr.js';
import { detectRasterLogoCandidatesFromImageUrl } from '../lib/rasterLogoCandidates';
import {
  resolveActivePageIdFromViewport,
  resolveActivePageIdFromVisibility,
} from '../lib/activePageViewport.js';
import {
  buildEditorExtractionNotices,
  buildExtractionWarningSummary,
} from '../lib/pageExtractionWarnings.js';
import { listBrowserTranslationInspectionEntries } from '../lib/browserTranslationInspection.js';
import {
  editorGraphicBboxToSource,
  sourceGraphicBboxToEditor,
} from '../lib/graphicRegionGeometry.js';
import { fitEditableBlockToBBox } from '../lib/pdf-core/fitting.js';
import EditorToolbar, { type ToolMode } from '../components/EditorToolbar';
import {
  isVerticalTextOrientation,
  resolveLogicalTextFrame,
} from '../lib/textOrientation.js';
import { extractDocTextColors, extractDocBgColors } from '../lib/colorUtils';
// @ts-ignore -- plain JS module, no .d.ts
import { detectContinuationGroups, projectContinuationBarriers } from '../lib/sentenceContinuationDetector.js';
// @ts-ignore -- plain JS module, no .d.ts
import { blockInCell, detectTableCells } from '../lib/tableCellDetector.js';

type PreviewSize = {
  width: number;
  height: number;
};

type GraphicBaselineEdit = {
  bbox?: number[];
  flipped?: boolean;
};

type OverlayDrawLine = {
  text: string;
  x_pt: number;
  baseline_pt: number;
};

type OverlayDrawPlan = {
  font_size: number;
  line_height: number;
  font_weight: string;
  truncated: boolean;
  local: true;
  lines: OverlayDrawLine[];
};

type LocalDrawPlanResult = {
  drawPlan: OverlayDrawPlan;
  truncated: boolean;
  overflow: boolean;
  redacted: boolean;
};

type OcrGranularity = 'block' | 'line' | 'grouped' | 'word';

const OCR_GROUPED_PADDING_PT = 1;

type OcrBox = {
  text: string;
  bbox: number[];
  confidence: number | null;
};

type OcrBoxesByGranularity = Record<OcrGranularity, OcrBox[]>;

type EditorViewProps = {
  session: SessionState;
  runtime: EditorSessionRuntime;
  versionSwitcher?: {
    options: Array<{
      id: string;
      label: string;
      recommended: boolean;
    }>;
    activeId: string;
    note: string;
    onSelect: (id: string) => void;
  } | null;
  onBack: () => void;
  onSessionUpdate: (session: SessionState) => void;
};

type ThumbnailLoupeState = {
  pageId: number;
  imageUrl: string;
  clientX: number;
  clientY: number;
  localX: number;
  localY: number;
  imageWidth: number;
  imageHeight: number;
  thumbWidth: number;
  thumbHeight: number;
};

type CanvasBlockLoupeState = {
  pageId: number;
  blockId: string;
  imageUrl: string;
  clientX: number;
  clientY: number;
  sourceXPt: number;
  sourceYPt: number;
  imageWidth: number;
  imageHeight: number;
  pageWidthPt: number;
  pageHeightPt: number;
};

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bboxesDiffer(a: number[] | null, b: number[] | null, epsilon = 0.1): boolean {
  if (!a || !b || a.length !== 4 || b.length !== 4) {
    return false;
  }
  return (
    Math.abs(a[0] - b[0]) > epsilon
    || Math.abs(a[1] - b[1]) > epsilon
    || Math.abs(a[2] - b[2]) > epsilon
    || Math.abs(a[3] - b[3]) > epsilon
  );
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bboxPercentStyle(bbox: number[], pageWidthPt: number, pageHeightPt: number): string {
  const left = (Number(bbox[0]) / pageWidthPt) * 100;
  const top = (Number(bbox[1]) / pageHeightPt) * 100;
  const width = ((Number(bbox[2]) - Number(bbox[0])) / pageWidthPt) * 100;
  const height = ((Number(bbox[3]) - Number(bbox[1])) / pageHeightPt) * 100;
  return [
    `left:${left.toFixed(4)}%`,
    `top:${top.toFixed(4)}%`,
    `width:${Math.max(0.01, width).toFixed(4)}%`,
    `height:${Math.max(0.01, height).toFixed(4)}%`,
  ].join(';');
}

function buildTightBBoxViewerHtml({
  title,
  imageUrl,
  pageWidthPt,
  pageHeightPt,
  boxes,
}: {
  title: string;
  imageUrl: string;
  pageWidthPt: number;
  pageHeightPt: number;
  boxes: Array<{ blockId: string; bbox: number[]; tightened: boolean }>;
}): string {
  const boxMarkup = boxes.map((entry) => (
    `<div class="bbox ${entry.tightened ? 'tightened' : 'regular'}" title="${escapeHtml(entry.blockId)}" style="${bboxPercentStyle(entry.bbox, pageWidthPt, pageHeightPt)}"></div>`
  )).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #edf2f7;
        color: #102033;
      }
      .viewer-header {
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .viewer-title {
        font-size: 16px;
        font-weight: 700;
      }
      .viewer-legend {
        display: flex;
        gap: 16px;
        font-size: 13px;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .legend-chip {
        width: 14px;
        height: 14px;
        border-radius: 3px;
      }
      .legend-chip.regular {
        border: 2px solid rgba(22, 163, 74, 0.95);
        background: rgba(22, 163, 74, 0.08);
      }
      .legend-chip.tightened {
        border: 2px solid rgba(147, 51, 234, 0.95);
        background: rgba(147, 51, 234, 0.08);
      }
      .viewer-page {
        position: relative;
        display: inline-block;
        max-width: min(96vw, 1400px);
        background: white;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
      }
      .viewer-page img {
        display: block;
        width: 100%;
        height: auto;
      }
      .viewer-overlay {
        position: absolute;
        inset: 0;
      }
      .bbox {
        position: absolute;
        box-sizing: border-box;
        pointer-events: auto;
      }
      .bbox.regular {
        border: 2px solid rgba(22, 163, 74, 0.95);
        background: rgba(22, 163, 74, 0.05);
      }
      .bbox.tightened {
        border: 2px solid rgba(147, 51, 234, 0.95);
        background: rgba(147, 51, 234, 0.06);
      }
    </style>
  </head>
  <body>
    <div class="viewer-header">
      <div class="viewer-title">${escapeHtml(title)}</div>
      <div class="viewer-legend">
        <span class="legend-item"><span class="legend-chip regular"></span>Regular bbox</span>
        <span class="legend-item"><span class="legend-chip tightened"></span>Tightened bbox</span>
      </div>
    </div>
    <div class="viewer-page">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />
      <div class="viewer-overlay">${boxMarkup}</div>
    </div>
  </body>
</html>`;
}

function buildStaticImageViewerHtml({
  title,
  imageUrl,
  note,
  pageWidthPt,
  pageHeightPt,
  visualRegions = [],
  horizontalBarrierSegments = [],
  verticalBarrierSegments = [],
  tableCells = [],
}: {
  title: string;
  imageUrl: string;
  note: string;
  pageWidthPt: number;
  pageHeightPt: number;
  visualRegions?: Array<{
    visual_id: string;
    bbox: number[];
    kind: 'image' | 'graphic_region' | 'raster_logo_candidate';
    logo_candidate?: boolean;
    score?: number;
  }>;
  horizontalBarrierSegments?: Array<{
    barrier_id: string;
    x: number;
    y1: number;
    y2: number;
    score: number;
    kind: 'explicit_line' | 'vertical_edge' | 'hybrid';
  }>;
  verticalBarrierSegments?: Array<{
    barrier_id: string;
    y: number;
    x1: number;
    x2: number;
    score: number;
    kind: 'explicit_line' | 'vertical_edge' | 'hybrid';
  }>;
  tableCells?: Array<{
    cellId: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    walls: 3 | 4;
  }>;
}): string {
  const safePageWidth = Math.max(1, Number(pageWidthPt) || 1);
  const safePageHeight = Math.max(1, Number(pageHeightPt) || 1);
  const overlayMarkup = visualRegions.map((region) => {
    const bbox = Array.isArray(region?.bbox) && region.bbox.length === 4
      ? region.bbox.map((value) => Number(value))
      : null;
    if (!bbox || bbox.some((value) => !Number.isFinite(value))) {
      return '';
    }
    const [x0, y0, x1, y1] = bbox;
    const left = Math.max(0, Math.min(100, (x0 / safePageWidth) * 100));
    const top = Math.max(0, Math.min(100, (y0 / safePageHeight) * 100));
    const width = Math.max(0, Math.min(100 - left, ((x1 - x0) / safePageWidth) * 100));
    const height = Math.max(0, Math.min(100 - top, ((y1 - y0) / safePageHeight) * 100));
    const classes = [
      'viewer-region',
      region.kind === 'image'
        ? 'kind-image'
        : (region.kind === 'graphic_region' ? 'kind-graphic' : 'raster-logo-candidate'),
      region.logo_candidate ? 'logo-candidate' : '',
    ].filter(Boolean).join(' ');
    const baseLabel = region.kind === 'image'
      ? 'Image'
      : (region.kind === 'graphic_region' ? 'Graphic' : 'Raster logo');
    const label = region.logo_candidate
      ? `${baseLabel} · logo`
      : (region.kind === 'raster_logo_candidate' && Number.isFinite(Number(region.score))
        ? `${baseLabel} · ${Number(region.score).toFixed(1)}`
        : baseLabel);
    return `<div class="${classes}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%">
      <span class="viewer-region-label">${escapeHtml(label)}</span>
    </div>`;
  }).join('');
  const horizontalBarrierMarkup = horizontalBarrierSegments.map((barrier) => {
    const x = Number(barrier?.x);
    const y1 = Number(barrier?.y1);
    const y2 = Number(barrier?.y2);
    if (!Number.isFinite(x) || !Number.isFinite(y1) || !Number.isFinite(y2) || y2 <= y1) {
      return '';
    }
    const left = Math.max(0, Math.min(100, (x / safePageWidth) * 100));
    const top = Math.max(0, Math.min(100, (y1 / safePageHeight) * 100));
    const height = Math.max(0, Math.min(100 - top, ((y2 - y1) / safePageHeight) * 100));
    const classes = [
      'viewer-hbarrier',
      barrier.kind === 'explicit_line'
        ? 'kind-explicit-line'
        : (barrier.kind === 'vertical_edge' ? 'kind-vertical-edge' : 'kind-hybrid'),
    ].join(' ');
    const titleText = `horizontal barrier · ${barrier.kind} · score ${Number(barrier.score).toFixed(2)}`;
    return `<div class="${classes}" title="${escapeHtml(titleText)}" style="left:${left}%;top:${top}%;height:${height}%"></div>`;
  }).join('');
  const verticalBarrierMarkup = verticalBarrierSegments.map((barrier) => {
    const y = Number(barrier?.y);
    const x1 = Number(barrier?.x1);
    const x2 = Number(barrier?.x2);
    if (!Number.isFinite(y) || !Number.isFinite(x1) || !Number.isFinite(x2) || x2 <= x1) {
      return '';
    }
    const top = Math.max(0, Math.min(100, (y / safePageHeight) * 100));
    const left = Math.max(0, Math.min(100, (x1 / safePageWidth) * 100));
    const width = Math.max(0, Math.min(100 - left, ((x2 - x1) / safePageWidth) * 100));
    const classes = [
      'viewer-vbarrier',
      barrier.kind === 'explicit_line'
        ? 'kind-explicit-line'
        : (barrier.kind === 'vertical_edge' ? 'kind-vertical-edge' : 'kind-hybrid'),
    ].join(' ');
    const titleText = `vertical barrier · ${barrier.kind} · score ${Number(barrier.score).toFixed(2)}`;
    return `<div class="${classes}" title="${escapeHtml(titleText)}" style="top:${top}%;left:${left}%;width:${width}%"></div>`;
  }).join('');
  const tableCellMarkup = tableCells.map((cell) => {
    const x1 = Number(cell?.x1);
    const y1 = Number(cell?.y1);
    const x2 = Number(cell?.x2);
    const y2 = Number(cell?.y2);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2) || x2 <= x1 || y2 <= y1) {
      return '';
    }
    const left = Math.max(0, Math.min(100, (x1 / safePageWidth) * 100));
    const top = Math.max(0, Math.min(100, (y1 / safePageHeight) * 100));
    const width = Math.max(0, Math.min(100 - left, ((x2 - x1) / safePageWidth) * 100));
    const height = Math.max(0, Math.min(100 - top, ((y2 - y1) / safePageHeight) * 100));
    const wallsClass = Number(cell?.walls) === 3 ? ' walls-3' : '';
    const titleText = `Cell ${String(cell?.cellId || '')} (${Number(cell?.walls) || 0} walls)`;
    return `<div class="viewer-table-cell${wallsClass}" title="${escapeHtml(titleText)}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"><span class="viewer-table-cell-label">${escapeHtml(String(cell?.cellId || ''))}</span></div>`;
  }).join('');
  const horizontalBarrierLegend = horizontalBarrierSegments.length > 0
    ? '<span class="legend-item"><span class="legend-chip viewer-hbarrier-chip"></span>Horizontal barrier (vertical line)</span>'
    : '';
  const verticalBarrierLegend = verticalBarrierSegments.length > 0
    ? '<span class="legend-item"><span class="legend-chip viewer-vbarrier-chip"></span>Vertical barrier (horizontal line)</span>'
    : '';
  const tableCellLegend = tableCells.length > 0
    ? [
      '<span class="legend-item"><span class="legend-chip" style="border: 2px solid rgba(99,102,241,0.85); background: rgba(99,102,241,0.10)"></span>Table cell (4 walls)</span>',
      '<span class="legend-item"><span class="legend-chip" style="border: 2px dashed rgba(99,102,241,0.85); background: rgba(99,102,241,0.10)"></span>Table cell (3 walls)</span>',
    ].join('')
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #edf2f7;
        color: #102033;
      }
      .viewer-header {
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .viewer-title {
        font-size: 16px;
        font-weight: 700;
      }
      .viewer-note {
        font-size: 13px;
        color: #516074;
      }
      .viewer-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 12px;
        color: #516074;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .legend-chip {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        border: 2px solid transparent;
        background: transparent;
      }
      .legend-chip.kind-image {
        border-color: rgba(37, 99, 235, 0.95);
        background: rgba(37, 99, 235, 0.12);
      }
      .legend-chip.kind-graphic {
        border-color: rgba(217, 119, 6, 0.95);
        background: rgba(245, 158, 11, 0.12);
      }
      .legend-chip.logo-candidate {
        border-color: rgba(219, 39, 119, 0.95);
        background: rgba(244, 114, 182, 0.18);
      }
      .legend-chip.raster-logo-candidate {
        border-color: rgba(22, 163, 74, 0.98);
        background: rgba(74, 222, 128, 0.18);
      }
      .legend-chip.viewer-hbarrier-chip {
        border-color: rgba(220, 38, 38, 0.98);
        background: rgba(248, 113, 113, 0.2);
      }
      .legend-chip.viewer-vbarrier-chip {
        border-color: rgba(13, 148, 136, 0.98);
        background: rgba(94, 234, 212, 0.2);
      }
      .viewer-page {
        position: relative;
        display: inline-block;
        max-width: min(96vw, 1400px);
        background: white;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
      }
      .viewer-page img {
        display: block;
        width: 100%;
        height: auto;
      }
      .viewer-overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .viewer-region {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid rgba(217, 119, 6, 0.95);
        background: rgba(245, 158, 11, 0.08);
      }
      .viewer-region.kind-image {
        border-color: rgba(37, 99, 235, 0.95);
        background: rgba(37, 99, 235, 0.08);
      }
      .viewer-region.kind-graphic {
        border-color: rgba(217, 119, 6, 0.95);
        background: rgba(245, 158, 11, 0.08);
      }
      .viewer-region.logo-candidate {
        border-color: rgba(219, 39, 119, 0.98);
        box-shadow: 0 0 0 2px rgba(244, 114, 182, 0.4) inset;
      }
      .viewer-region.raster-logo-candidate {
        border: 2px dashed rgba(22, 163, 74, 0.98);
        background: rgba(74, 222, 128, 0.08);
      }
      .viewer-region-label {
        position: absolute;
        top: -1.45rem;
        left: 0;
        padding: 2px 6px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.88);
        color: white;
      }
      .viewer-hbarrier {
        position: absolute;
        width: 0;
        box-sizing: border-box;
        border-left: 2px solid rgba(220, 38, 38, 0.98);
        transform: translateX(-1px);
        filter: drop-shadow(0 0 2px rgba(127, 29, 29, 0.45));
      }
      .viewer-hbarrier.kind-vertical-edge {
        border-left-color: rgba(217, 119, 6, 0.98);
      }
      .viewer-hbarrier.kind-hybrid {
        border-left-color: rgba(168, 85, 247, 0.98);
      }
      .viewer-vbarrier {
        position: absolute;
        height: 0;
        box-sizing: border-box;
        border-top: 2px solid rgba(13, 148, 136, 0.98);
        transform: translateY(-1px);
        filter: drop-shadow(0 0 2px rgba(13, 148, 136, 0.45));
      }
      .viewer-vbarrier.kind-vertical-edge {
        border-top-color: rgba(6, 182, 212, 0.98);
      }
      .viewer-vbarrier.kind-hybrid {
        border-top-color: rgba(99, 102, 241, 0.98);
      }
      .viewer-table-cell {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid rgba(99, 102, 241, 0.85);
        background: rgba(99, 102, 241, 0.1);
      }
      .viewer-table-cell.walls-3 {
        border-style: dashed;
      }
      .viewer-table-cell-label {
        position: absolute;
        top: 2px;
        right: 2px;
        padding: 1px 4px;
        font-size: 10px;
        font-weight: 700;
        background: rgba(99, 102, 241, 0.88);
        color: white;
        border-radius: 3px;
      }
    </style>
  </head>
  <body>
    <div class="viewer-header">
      <div class="viewer-title">${escapeHtml(title)}</div>
      <div class="viewer-note">${escapeHtml(note)}</div>
    </div>
    <div class="viewer-legend">
      ${horizontalBarrierLegend}
      ${verticalBarrierLegend}
      ${tableCellLegend}
    </div>
    <div class="viewer-page">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />
      <div class="viewer-overlay">${overlayMarkup}${horizontalBarrierMarkup}${verticalBarrierMarkup}${tableCellMarkup}</div>
    </div>
  </body>
</html>`;
}

function buildOcrViewerHtml({
  title,
  imageUrl,
  imageWidth,
  imageHeight,
  boxesByGranularity,
  initialGranularity = 'line',
  statusMessage = '',
  errorMessage = '',
  progressFraction = null,
}: {
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  boxesByGranularity: OcrBoxesByGranularity;
  initialGranularity?: OcrGranularity;
  statusMessage?: string;
  errorMessage?: string;
  progressFraction?: number | null;
}): string {
  const safeBoxesByGranularity = {
    block: Array.isArray(boxesByGranularity?.block) ? boxesByGranularity.block : [],
    line: Array.isArray(boxesByGranularity?.line) ? boxesByGranularity.line : [],
    grouped: Array.isArray(boxesByGranularity?.grouped) ? boxesByGranularity.grouped : [],
    word: Array.isArray(boxesByGranularity?.word) ? boxesByGranularity.word : [],
  };
  const initialKey = ['block', 'line', 'grouped', 'word'].includes(String(initialGranularity))
    ? initialGranularity
    : 'line';
  const serializedBoxes = JSON.stringify(
    JSON.stringify(safeBoxesByGranularity).replace(/<\//g, '<\\/'),
  );
  const serializedStatus = JSON.stringify(String(statusMessage || ''));
  const serializedError = JSON.stringify(String(errorMessage || ''));
  const progressPercent = progressFraction == null
    ? null
    : (
      Number.isFinite(Number(progressFraction))
        ? Math.max(0, Math.min(100, Math.round(Number(progressFraction) * 100)))
        : null
    );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #edf2f7;
        color: #102033;
      }
      .viewer-header {
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .viewer-title {
        font-size: 16px;
        font-weight: 700;
      }
      .viewer-legend {
        display: flex;
        gap: 16px;
        font-size: 13px;
        align-items: center;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .legend-chip {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 2px solid rgba(124, 58, 237, 0.95);
        background: rgba(124, 58, 237, 0.08);
      }
      .granularity-toggle {
        display: inline-flex;
        gap: 8px;
      }
      .granularity-toggle.hidden {
        display: none;
      }
      .viewer-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        font-size: 13px;
        color: #334155;
      }
      .viewer-toolbar.hidden {
        display: none;
      }
      .viewer-toolbar-label {
        font-weight: 600;
      }
      .granularity-toggle button {
        border: 1px solid #cbd5e1;
        background: white;
        color: #102033;
        border-radius: 6px;
        padding: 6px 10px;
        font: inherit;
        cursor: pointer;
      }
      .granularity-toggle button.active {
        border-color: rgba(124, 58, 237, 0.95);
        background: rgba(124, 58, 237, 0.08);
      }
      .viewer-status {
        margin-bottom: 12px;
        font-size: 13px;
        color: #334155;
      }
      .viewer-status.error {
        color: #b91c1c;
      }
      .viewer-progress {
        margin-bottom: 12px;
      }
      .viewer-progress.hidden {
        display: none;
      }
      .viewer-progress-track {
        width: min(420px, 100%);
        height: 8px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.22);
        overflow: hidden;
      }
      .viewer-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, rgba(14, 165, 233, 0.9), rgba(59, 130, 246, 0.92));
        transition: width 0.18s ease;
      }
      .viewer-progress-label {
        margin-top: 6px;
        font-size: 12px;
        color: #475569;
      }
      .viewer-page {
        position: relative;
        display: inline-block;
        max-width: min(96vw, 1400px);
        background: white;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
      }
      .viewer-page img {
        display: block;
        width: 100%;
        height: auto;
      }
      .viewer-overlay {
        position: absolute;
        inset: 0;
      }
      .bbox {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid rgba(124, 58, 237, 0.95);
        background: rgba(124, 58, 237, 0.05);
      }
    </style>
  </head>
  <body>
    <div class="viewer-header">
      <div class="viewer-title">${escapeHtml(title)}</div>
      <div class="viewer-legend">
        <span class="legend-item"><span class="legend-chip"></span>OCR detected text</span>
      </div>
    </div>
    <div class="viewer-status${errorMessage ? ' error' : ''}" id="viewer-status"></div>
    <div class="viewer-progress${progressPercent == null ? ' hidden' : ''}" id="viewer-progress">
      <div class="viewer-progress-track">
        <div class="viewer-progress-fill" id="viewer-progress-fill" style="width:${progressPercent == null ? 0 : progressPercent}%"></div>
      </div>
      <div class="viewer-progress-label" id="viewer-progress-label">${progressPercent == null ? '' : `${progressPercent}%`}</div>
    </div>
    <div class="viewer-toolbar${errorMessage || progressPercent != null ? ' hidden' : ''}" id="viewer-toolbar">
      <span class="viewer-toolbar-label">View:</span>
      <div class="granularity-toggle" role="group" aria-label="OCR granularity" id="granularity-toggle">
        <button type="button" data-granularity="block">Blocks</button>
        <button type="button" data-granularity="line">Lines</button>
        <button type="button" data-granularity="grouped">Grouped</button>
        <button type="button" data-granularity="word">Words</button>
      </div>
    </div>
    <div class="viewer-page">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />
      <div class="viewer-overlay" id="viewer-overlay"></div>
    </div>
    <script>
      (() => {
        const imageWidth = ${Number(imageWidth) || 1};
        const imageHeight = ${Number(imageHeight) || 1};
        const boxesByGranularity = JSON.parse(${serializedBoxes});
        const baseStatus = ${serializedStatus};
        const baseError = ${serializedError};
        const progressPercent = ${progressPercent == null ? 'null' : String(progressPercent)};
        const overlayEl = document.getElementById('viewer-overlay');
        const statusEl = document.getElementById('viewer-status');
        const progressEl = document.getElementById('viewer-progress');
        const progressFillEl = document.getElementById('viewer-progress-fill');
        const progressLabelEl = document.getElementById('viewer-progress-label');
        const toolbarEl = document.getElementById('viewer-toolbar');
        const granularityToggleEl = document.getElementById('granularity-toggle');
        const buttons = Array.from(document.querySelectorAll('[data-granularity]'));
        function bboxPercentStyle(bbox) {
          const left = (Number(bbox[0]) / imageWidth) * 100;
          const top = (Number(bbox[1]) / imageHeight) * 100;
          const width = ((Number(bbox[2]) - Number(bbox[0])) / imageWidth) * 100;
          const height = ((Number(bbox[3]) - Number(bbox[1])) / imageHeight) * 100;
          return 'left:' + left.toFixed(4) + '%;top:' + top.toFixed(4) + '%;width:' + Math.max(0.01, width).toFixed(4) + '%;height:' + Math.max(0.01, height).toFixed(4) + '%;';
        }
        function render(granularity) {
          const entries = Array.isArray(boxesByGranularity[granularity]) ? boxesByGranularity[granularity] : [];
          overlayEl.innerHTML = entries.map((entry) => '<div class="bbox" title=\"' + String(entry.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;') + '\" style=\"' + bboxPercentStyle(entry.bbox) + '\"></div>').join('');
          const hasAnyBoxes = Object.values(boxesByGranularity).some((bucket) => Array.isArray(bucket) && bucket.length > 0);
          const detailSuffix = baseStatus && hasAnyBoxes ? ' (' + baseStatus + ')' : '';
          statusEl.textContent = baseError || ((!hasAnyBoxes && baseStatus)
            ? baseStatus
            : (entries.length + ' OCR ' + granularity + (entries.length === 1 ? '' : 's') + ' detected' + detailSuffix));
          statusEl.className = 'viewer-status' + (baseError ? ' error' : '');
          if (progressEl) {
            progressEl.className = 'viewer-progress' + (progressPercent == null ? ' hidden' : '');
          }
          if (progressFillEl && progressPercent != null) {
            progressFillEl.style.width = progressPercent + '%';
          }
          if (progressLabelEl) {
            progressLabelEl.textContent = progressPercent == null ? '' : (progressPercent + '%');
          }
          if (toolbarEl) {
            toolbarEl.className = 'viewer-toolbar' + (baseError || progressPercent != null ? ' hidden' : '');
          }
          if (granularityToggleEl) {
            granularityToggleEl.className = 'granularity-toggle';
          }
          for (const button of buttons) {
            button.classList.toggle('active', button.dataset.granularity === granularity);
          }
        }
        for (const button of buttons) {
          button.addEventListener('click', () => render(button.dataset.granularity || '${initialKey}'));
        }
        render('${initialKey}');
      })();
    </script>
  </body>
</html>`;
}

function buildTranslationInspectionViewerHtml({
  title,
  entries,
}: {
  title: string;
  entries: Array<Record<string, unknown>>;
}): string {
  const rows = entries.length
    ? entries.map((entry) => {
        const status = String(entry.status || 'pending');
        const statusClass = status === 'succeeded'
          ? 'succeeded'
          : (status === 'failed' ? 'failed' : 'pending');
        const requestLabelParts = [];
        if (entry.pageId != null) {
          requestLabelParts.push(`p${entry.pageId}`);
        }
        if (entry.blockId) {
          requestLabelParts.push(String(entry.blockId));
        }
        if (entry.strict) {
          requestLabelParts.push('strict');
        } else {
          requestLabelParts.push('default');
        }
        const requestLabel = requestLabelParts.join(' · ') || 'request';
        return `
          <article class="entry">
            <div class="entry-header">
              <div class="entry-title">${escapeHtml(requestLabel)}</div>
              <div class="entry-meta">
                <span class="status ${statusClass}">${escapeHtml(status)}</span>
                <span>${escapeHtml(String(entry.sourceCode || ''))} → ${escapeHtml(String(entry.targetCode || ''))}</span>
                <span>${escapeHtml(String(entry.blockType || ''))}</span>
                <span>${escapeHtml(String(entry.durationMs == null ? '' : `${entry.durationMs}ms`))}</span>
              </div>
            </div>
            <div class="entry-panels">
              <section class="panel">
                <div class="panel-label">Request</div>
                <pre>${escapeHtml(String(entry.sourceText || ''))}</pre>
              </section>
              <section class="panel">
                <div class="panel-label">Response</div>
                <pre>${escapeHtml(String(entry.status === 'failed' ? (entry.errorMessage || '') : (entry.responseText || '')))}</pre>
              </section>
            </div>
          </article>
        `;
      }).join('')
    : '<p class="empty-state">No Browser Translator API requests have been recorded in this session.</p>';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #edf2f7;
        color: #102033;
      }
      .viewer-header {
        margin-bottom: 12px;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .viewer-title {
        font-size: 16px;
        font-weight: 700;
      }
      .viewer-subtitle {
        font-size: 13px;
        color: #516074;
      }
      .entry-list {
        display: grid;
        gap: 12px;
      }
      .entry {
        border: 1px solid #dbe4ee;
        border-radius: 12px;
        background: white;
        padding: 12px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      }
      .entry-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .entry-title {
        font-size: 13px;
        font-weight: 700;
      }
      .entry-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 12px;
        color: #526173;
      }
      .status {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 2px 8px;
        font-weight: 700;
        text-transform: capitalize;
      }
      .status.succeeded {
        background: rgba(22, 163, 74, 0.12);
        color: #166534;
      }
      .status.failed {
        background: rgba(220, 38, 38, 0.12);
        color: #991b1b;
      }
      .status.pending {
        background: rgba(59, 130, 246, 0.12);
        color: #1d4ed8;
      }
      .entry-panels {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .panel {
        min-width: 0;
      }
      .panel-label {
        margin-bottom: 6px;
        font-size: 12px;
        font-weight: 700;
        color: #526173;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      pre {
        margin: 0;
        padding: 10px;
        border-radius: 10px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
      }
      .empty-state {
        margin: 0;
        padding: 18px;
        border-radius: 12px;
        background: white;
        border: 1px solid #dbe4ee;
        color: #526173;
      }
      @media (max-width: 900px) {
        .entry-panels {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="viewer-header">
      <div class="viewer-title">${escapeHtml(title)}</div>
      <div class="viewer-subtitle">${entries.length} browser translator request${entries.length === 1 ? '' : 's'}</div>
    </div>
    <div class="entry-list">${rows}</div>
  </body>
</html>`;
}

function writeViewerWindow(popup: Window, html: string): void {
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

async function loadImageElement(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load page image for OCR: ${imageUrl}`));
    image.src = imageUrl;
  });
}

function clampMovedBbox(
  bbox: number[],
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
): number[] {
  const x0 = Number(bbox[0]) || 0;
  const y0 = Number(bbox[1]) || 0;
  const x1 = Number(bbox[2]) || x0 + 1;
  const y1 = Number(bbox[3]) || y0 + 1;
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const nextX0 = clamp(x0 + dx, 0, Math.max(0, pageWidth - width));
  const nextY0 = clamp(y0 + dy, 0, Math.max(0, pageHeight - height));
  return [nextX0, nextY0, nextX0 + width, nextY0 + height];
}

function selectUnique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isMultiSelectModifier(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

function wrapTextForOverlay(text: string): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  return lines.length ? lines.join('\n') : '';
}

function clearStoredDrawPlan<T extends Record<string, unknown>>(block: T): T {
  return {
    ...block,
    draw_plan: null,
    drawPlan: null,
  };
}

function supportsFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: fine)').matches;
}

const ENABLE_SIDEBAR_THUMBNAIL_LOUPE = false;

// ---------------------------------------------------------------------------
// Text measurement / draw plan utilities
// ---------------------------------------------------------------------------

const TEXT_PADDING_PT = 1.0;
function lineSpacingForBlock(block: Record<string, unknown>, fontSize: number): number {
  const lineHeight = Number(block.line_height);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 1.2;
  const ratio = lineHeight / fontSize;
  if (!Number.isFinite(ratio) || ratio < 0.8 || ratio > 2.5) return 1.2;
  return ratio;
}

function defaultWrapModeForBlock(block: Record<string, unknown>): 'word' | 'none' {
  return String(block.block_type || '') === 'table_cell' ? 'word' : 'none';
}

function wrapModeForBlock(block: Record<string, unknown>): 'word' | 'none' {
  const candidate = String(block.wrap_mode || defaultWrapModeForBlock(block));
  return candidate === 'word' ? 'word' : 'none';
}

function toolbarAlignmentValue(value: unknown): '' | 'left' | 'center' | 'right' | 'justify' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'left' || normalized === 'center' || normalized === 'right' || normalized === 'justify') return normalized;
  return '';
}

function clipResolvedForBlock(block: Record<string, unknown>): boolean {
  const clipMode = String(block.clip_mode || 'auto');
  const sourceClipDefault = Boolean(block.source_clip_default);
  const bboxEdited = Boolean(block.bbox_edited);
  if (clipMode === 'auto' && bboxEdited) {
    return false;
  }
  return clipMode === 'on' || (clipMode === 'auto' && sourceClipDefault);
}

function effectiveFontWeightForBlock(block: Record<string, unknown>): 'normal' | 'bold' {
  const explicitWeight = String(block.font_weight || 'normal');
  if (explicitWeight === 'bold') return 'bold';
  const policy = String(block.faux_bold_policy || 'semantic');
  const renderMode = Number(block.render_mode || 0);
  if (policy === 'semantic' && renderMode === 2) return 'bold';
  return 'normal';
}

function shouldApplyFauxBoldStrokeForBlock(block: Record<string, unknown>, baseFontSize: number): boolean {
  const policy = String(block.faux_bold_policy || 'semantic');
  const renderMode = Number(block.render_mode || 0);
  return policy === 'stroke' && renderMode === 2 && baseFontSize >= 10;
}

function sourceLineHintForBlock(block: Record<string, unknown>): number {
  if (Boolean(block.bbox_edited)) return 0;
  const hint = Number(block.source_line_count || 0);
  return Number.isFinite(hint) && hint > 0 ? Math.floor(hint) : 0;
}

function localLineX(
  line: string,
  alignment: string,
  fontSize: number,
  fontWeight: string,
  maxWidth: number,
): number {
  const lineWidth = measureLinePt(line, fontSize, fontWeight);
  if (alignment === 'right') {
    return Math.max(TEXT_PADDING_PT, (maxWidth - lineWidth) + TEXT_PADDING_PT);
  }
  if (alignment === 'center') {
    return Math.max(TEXT_PADDING_PT, ((maxWidth - lineWidth) / 2) + TEXT_PADDING_PT);
  }
  return TEXT_PADDING_PT;
}

function rebuildLocalDrawPlan(block: Record<string, unknown>): LocalDrawPlanResult {
  const bbox = Array.isArray(block.bbox) ? block.bbox.map((value) => Number(value)) : [0, 0, 1, 1];
  const width = Math.max(1, (bbox[2] - bbox[0]) - (TEXT_PADDING_PT * 2));
  const height = Math.max(1, (bbox[3] - bbox[1]) - (TEXT_PADDING_PT * 2));
  const fontSize = Math.max(1, Number(block.font_size) || 10);
  const lineHeight = Math.max(1, Number(block.line_height) || (fontSize * 1.2));
  const fontWeight = effectiveFontWeightForBlock(block);
  const clipResolved = clipResolvedForBlock(block);
  const wrapMode = wrapModeForBlock(block);
  const normalizedText = String(block.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const effectiveAlignment = resolveEffectiveAlignment({
    alignment: String(block.alignment || 'left'),
    text: normalizedText,
    textTightness: String(block.text_tightness || ''),
    alignmentEdited: Boolean(block.alignment_edited),
  });

  let lines = normalizedText.split('\n');
  if (lines.length <= 1 && wrapMode === 'word') {
    lines = wrapTextToWidth(String(block.text || ''), width, fontSize, fontWeight);
  }
  if (clipResolved && lines.length <= 1 && wrapMode !== 'word') {
    lines = wrapTextToWidth(String(block.text || ''), width, fontSize, fontWeight);
  }

  let maxLines = Math.max(1, Math.floor((height - fontSize) / lineHeight) + 1);
  const sourceHint = sourceLineHintForBlock(block);
  if (clipResolved && sourceHint > 0) {
    maxLines = Math.min(maxLines, sourceHint);
  }

  let truncated = false;
  if (clipResolved && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
    if (lines.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}...`;
    }
  }

  const plannedLines: OverlayDrawLine[] = [];
  for (const rawLine of lines) {
    const sourceLine = String(rawLine || '');
    let renderedLine = sourceLine;
    if (clipResolved) {
      renderedLine = truncateLineToWidth(sourceLine, width, fontSize, fontWeight);
      if (renderedLine !== sourceLine) truncated = true;
    }
    const xPt = localLineX(
      renderedLine,
      effectiveAlignment,
      fontSize,
      fontWeight,
      width,
    );
    const baselinePt = resolveLineBaselinePt(block, {
      fontSize,
      lineHeight,
      contentHeight: height,
      lineIndex: plannedLines.length,
      lineCount: lines.length,
    });
    plannedLines.push({
      text: renderedLine,
      x_pt: Math.round(xPt * 1000) / 1000,
      baseline_pt: Math.round(baselinePt * 1000) / 1000,
    });
  }

  const maxLineWidth = plannedLines.length
    ? Math.max(...plannedLines.map((item) => measureLinePt(String(item.text || ''), fontSize, fontWeight)))
    : 0;
  const requiredHeight = fontSize + (Math.max(0, plannedLines.length - 1) * lineHeight);
  const widthOverflow = Math.max(0, maxLineWidth - width);
  const heightOverflow = Math.max(0, requiredHeight - height);
  const overflowDetected = widthOverflow > 0.5 || heightOverflow > 0.5;
  const sourceClipDefault = Boolean(block.source_clip_default);
  const clipMode = String(block.clip_mode || 'auto');
  const overflowExpected = Boolean(clipResolved && (sourceClipDefault || clipMode === 'on'));
  const overflowWarning = Boolean(overflowDetected && !overflowExpected);
  const redacted = Boolean(block.collision) || overflowWarning || Boolean(truncated);

  return {
    drawPlan: {
      font_size: Math.round(fontSize * 1000) / 1000,
      line_height: Math.round(lineHeight * 1000) / 1000,
      font_weight: fontWeight,
      truncated: Boolean(truncated),
      local: true,
      lines: plannedLines,
    },
    truncated: Boolean(truncated),
    overflow: overflowWarning,
    redacted,
  };
}

function rgbFromFloatTriplet(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length < 3) return 'rgb(0,0,0)';
  const r = clamp(Math.round((Number(raw[0]) || 0) * 255), 0, 255);
  const g = clamp(Math.round((Number(raw[1]) || 0) * 255), 0, 255);
  const b = clamp(Math.round((Number(raw[2]) || 0) * 255), 0, 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function blockPageIndex(cache: Record<number, PagePayload>): Map<string, number> {
  const index = new Map<string, number>();
  for (const [rawPageId, page] of Object.entries(cache)) {
    const pageId = Number(rawPageId);
    for (const block of page.blocks) {
      if (!index.has(block.source_block_id)) {
        index.set(block.source_block_id, pageId);
      }
    }
  }
  return index;
}

function normalizeSelectionOrder(selection: string[], cache: Record<number, PagePayload>): string[] {
  const validIds = new Set<string>();
  for (const page of Object.values(cache)) {
    for (const block of page.blocks) {
      validIds.add(block.source_block_id);
    }
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const blockId of selection) {
    if (!validIds.has(blockId) || seen.has(blockId)) continue;
    seen.add(blockId);
    normalized.push(blockId);
  }
  return normalized;
}

type SelectedBlockEntry = {
  pageId: number;
  block: PageBlock;
};

function selectedBlockEntries(cache: Record<number, PagePayload>, selection: string[]): SelectedBlockEntry[] {
  const byId = new Map<string, SelectedBlockEntry>();
  for (const [rawPageId, page] of Object.entries(cache)) {
    const pageId = Number(rawPageId);
    for (const block of page.blocks) {
      byId.set(block.source_block_id, { pageId, block });
    }
  }
  const entries: SelectedBlockEntry[] = [];
  for (const blockId of selection) {
    const entry = byId.get(blockId);
    if (entry) entries.push(entry);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// EditorView component
// ---------------------------------------------------------------------------

const NEW_TEXT_BLOCK_PLACEHOLDER = 'Type here';

export default function EditorView({ session, runtime, versionSwitcher = null, onBack, onSessionUpdate }: EditorViewProps) {
  const mirrorEnabled = session.mirror_enabled !== false;
  const sourceUrl = import.meta.env.VITE_SOURCE_URL || '';
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [pageCache, setPageCache] = useState<Record<number, PagePayload>>({});
  const [previewRevision, setPreviewRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [graphicBaselineByPage, setGraphicBaselineByPage] = useState<Record<number, Record<string, GraphicBaselineEdit>>>({});

  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [selectedGraphicRegionId, setSelectedGraphicRegionId] = useState('');
  const [previewSizesByPage, setPreviewSizesByPage] = useState<Record<number, PreviewSize>>({});
  const [inlineEditor, setInlineEditor] = useState<{
    pageId: number;
    blockId: string;
    text: string;
    focusMode?: 'select-all' | 'cursor-end';
  } | null>(null);
  const [dirty, setDirty] = useState(() => Boolean(session.has_unsaved_local_edits));
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [thumbnailLoupe, setThumbnailLoupe] = useState<ThumbnailLoupeState | null>(null);
  const [canvasBlockLoupe, setCanvasBlockLoupe] = useState<CanvasBlockLoupeState | null>(null);
  const [originalPreviewSizesByPage, setOriginalPreviewSizesByPage] = useState<Record<number, PreviewSize>>({});
  const [nudgeOverlay, setNudgeOverlay] = useState(false);
  const [tightBBoxOverlay, setTightBBoxOverlay] = useState(false);
  const [continuationOverlay, setContinuationOverlay] = useState(false);
  const [enableTesseractOcr] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveEnableTesseractOcrFromSearch(window.location.search);
  });
  const [debugInspectionsEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveDebugInspectionsEnabledFromSearch(window.location.search);
  });
  const [skipSingleCharBlocks] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveSkipSingleCharBlocksFromSearch(window.location.search);
  });
  const [undoStack] = useState(() => createUndoStack(50));
  const [undoRevision, setUndoRevision] = useState(0);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [lasso, setLasso] = useState<{
    pageId: number;
    startX: number; startY: number;
    currentX: number; currentY: number;
  } | null>(null);
  const [creationDrag, setCreationDrag] = useState<{
    pageId: number;
    startX: number; startY: number;
    currentX: number; currentY: number;
  } | null>(null);
  const [regionSelection, setRegionSelection] = useState<{
    pageId: number;
    bbox: number[];
  } | null>(null);
  const [regionDrag, setRegionDrag] = useState<{
    pageId: number;
    startX: number; startY: number;
    currentX: number; currentY: number;
  } | null>(null);

  const graphicClickTimesRef = useRef<Record<string, number>>({});
  const thumbRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pageStageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const canvasRef = useRef<HTMLElement | null>(null);
  const viewportSyncFrameRef = useRef<number | null>(null);
  const activePageIdRef = useRef<number | null>(null);
  const visibilityByPageIdRef = useRef<Record<number, { visibleHeight: number; top: number }>>({});
  const tightBBoxViewerRef = useRef<Window | null>(null);
  const originalBackgroundViewerRef = useRef<Window | null>(null);
  const sourceBarrierViewerRef = useRef<Window | null>(null);
  const tableCellViewerRef = useRef<Window | null>(null);
  const ocrViewerRef = useRef<Window | null>(null);
  const translationInspectionViewerRef = useRef<Window | null>(null);
  const ocrBusyRef = useRef(false);
  const inlineEditorTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const loupePresentation = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const activeLoupe = canvasBlockLoupe || thumbnailLoupe;
    if (!activeLoupe) return null;
    const size = 300;
    const zoom = 1;
    const gap = 18;
    const padding = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const topChromeBottom = (() => {
      const appBarBottom = document.querySelector('.app-bar')?.getBoundingClientRect?.().bottom || 0;
      const toolbarBottom = document.querySelector('.editor-toolbar')?.getBoundingClientRect?.().bottom || 0;
      return Math.max(16, appBarBottom, toolbarBottom) + 12;
    })();
    let left = activeLoupe.clientX + gap;
    let top = activeLoupe.clientY - size / 2;
    if (canvasBlockLoupe) {
      const useBottomAnchor = canvasBlockLoupe.clientY < viewportHeight * 0.5;
      left = 184;
      top = useBottomAnchor
        ? Math.max(topChromeBottom, viewportHeight - size - 88)
        : topChromeBottom;
    } else {
      if (left + size + padding > viewportWidth) {
        left = activeLoupe.clientX - size - gap;
      }
      left = clamp(left, padding, Math.max(padding, viewportWidth - size - padding));
      top = clamp(top, topChromeBottom, Math.max(topChromeBottom, viewportHeight - size - padding));
    }
    if (canvasBlockLoupe) {
      const pixelsPerPtX = canvasBlockLoupe.pageWidthPt > 0
        ? canvasBlockLoupe.imageWidth / canvasBlockLoupe.pageWidthPt
        : 1;
      const pixelsPerPtY = canvasBlockLoupe.pageHeightPt > 0
        ? canvasBlockLoupe.imageHeight / canvasBlockLoupe.pageHeightPt
        : 1;
      const sourceX = canvasBlockLoupe.sourceXPt * pixelsPerPtX;
      const sourceY = canvasBlockLoupe.sourceYPt * pixelsPerPtY;
      return {
        pageId: canvasBlockLoupe.pageId,
        imageUrl: canvasBlockLoupe.imageUrl,
        zoom,
        size,
        style: {
          left,
          top,
          width: `${size}px`,
          height: `${size}px`,
          backgroundImage: `url("${canvasBlockLoupe.imageUrl}")`,
          backgroundSize: `${canvasBlockLoupe.imageWidth * zoom}px ${canvasBlockLoupe.imageHeight * zoom}px`,
          backgroundPosition: `${size / 2 - sourceX * zoom}px ${size / 2 - sourceY * zoom}px`,
        } satisfies CSSProperties,
      };
    }
    if (!thumbnailLoupe) return null;
    const scaleX = thumbnailLoupe.thumbWidth > 0
      ? thumbnailLoupe.imageWidth / thumbnailLoupe.thumbWidth
      : 1;
    const scaleY = thumbnailLoupe.thumbHeight > 0
      ? thumbnailLoupe.imageHeight / thumbnailLoupe.thumbHeight
      : 1;
    const sourceX = thumbnailLoupe.localX * scaleX;
    const sourceY = thumbnailLoupe.localY * scaleY;
    return {
      pageId: thumbnailLoupe.pageId,
      imageUrl: thumbnailLoupe.imageUrl,
      zoom,
      size,
      style: {
        left,
        top,
        width: `${size}px`,
        height: `${size}px`,
        backgroundImage: `url("${thumbnailLoupe.imageUrl}")`,
        backgroundSize: `${thumbnailLoupe.imageWidth * zoom}px ${thumbnailLoupe.imageHeight * zoom}px`,
        backgroundPosition: `${size / 2 - sourceX * zoom}px ${size / 2 - sourceY * zoom}px`,
      } satisfies CSSProperties,
    };
  }, [canvasBlockLoupe, thumbnailLoupe]);

  function clearThumbnailLoupe(): void {
    if (!ENABLE_SIDEBAR_THUMBNAIL_LOUPE) {
      return;
    }
    setThumbnailLoupe(null);
  }

  function clearCanvasBlockLoupe(): void {
    setCanvasBlockLoupe(null);
  }

  function updateThumbnailLoupe(
    pageId: number,
    imageUrl: string,
    event: ReactPointerEvent<HTMLImageElement>,
  ): void {
    if (!ENABLE_SIDEBAR_THUMBNAIL_LOUPE || !supportsFinePointer()) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = clamp(event.clientX - rect.left, 0, rect.width);
    const localY = clamp(event.clientY - rect.top, 0, rect.height);
    setThumbnailLoupe({
      pageId,
      imageUrl,
      clientX: event.clientX,
      clientY: event.clientY,
      localX,
      localY,
      imageWidth: event.currentTarget.naturalWidth,
      imageHeight: event.currentTarget.naturalHeight,
      thumbWidth: rect.width,
      thumbHeight: rect.height,
    });
  }

  function updateCanvasBlockLoupe(
    pageId: number,
    block: PageBlock,
    event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>,
  ): void {
    if (!supportsFinePointer()) {
      return;
    }
    const imageUrl = (runtime.thumbnailUrl?.(session, pageId, 144, previewRevision))
      || runtime.previewUrl(session, pageId, 144, previewRevision);
    const imageSize = originalPreviewSizesByPage[pageId];
    if (!imageUrl || !imageSize?.width || !imageSize?.height) {
      return;
    }
    const sourceBboxRaw = Array.isArray(block.source_bbox) && block.source_bbox.length === 4
      ? block.source_bbox
      : block.bbox;
    if (!Array.isArray(sourceBboxRaw) || sourceBboxRaw.length !== 4) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const u = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5;
    const v = rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0.5;
    const x0 = Number(sourceBboxRaw[0]) || 0;
    const y0 = Number(sourceBboxRaw[1]) || 0;
    const x1 = Number(sourceBboxRaw[2]) || x0 + 1;
    const y1 = Number(sourceBboxRaw[3]) || y0 + 1;
    const pageWidthPt = Number(pageCache[pageId]?.page_size_pt?.[0]) || 1;
    const pageHeightPt = Number(pageCache[pageId]?.page_size_pt?.[1]) || 1;
    setThumbnailLoupe(null);
    setCanvasBlockLoupe({
      pageId,
      blockId: block.source_block_id,
      imageUrl,
      clientX: event.clientX,
      clientY: event.clientY,
      sourceXPt: mirrorEnabled ? (x1 - ((x1 - x0) * u)) : (x0 + ((x1 - x0) * u)),
      sourceYPt: y0 + ((y1 - y0) * v),
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      pageWidthPt,
      pageHeightPt,
    });
  }

  function openTightBBoxViewer(): void {
    if (!activePage || activePageId == null) {
      return;
    }
    const pageWidthPt = Number(activePage.page_size_pt?.[0] || 0);
    const pageHeightPt = Number(activePage.page_size_pt?.[1] || 0);
    const imageUrl = (runtime.thumbnailUrl?.(session, activePageId, 144, previewRevision))
      || runtime.previewUrl(session, activePageId, 144, previewRevision);
    if (!imageUrl || pageWidthPt <= 0 || pageHeightPt <= 0) {
      setError('Unable to open the tight bbox viewer for the current page.');
      return;
    }
    const boxes = activePage.blocks.flatMap((block) => {
      const preview = resolveTightTextBBoxPreview(block as PageBlock & Record<string, unknown>);
      if (!preview) {
        return [];
      }
      return [{
        blockId: block.source_block_id,
        bbox: preview.displayBBox,
        tightened: preview.tightened,
      }];
    });
    const popup = window.open('', 'tight-bbox-viewer', 'popup=yes,width=1180,height=920,resizable=yes,scrollbars=yes');
    if (!popup) {
      setError('Popup blocked while opening the tight bbox viewer.');
      return;
    }
    tightBBoxViewerRef.current = popup;
    writeViewerWindow(popup, buildTightBBoxViewerHtml({
      title: `${session.source_pdf_name} · page ${activePageId}`,
      imageUrl,
      pageWidthPt,
      pageHeightPt,
      boxes,
    }));
    popup.focus();
  }

  async function openOcrViewer(): Promise<void> {
    if (!enableTesseractOcr || !activePage || activePageId == null || ocrBusyRef.current) {
      return;
    }
    const imageUrl = (runtime.thumbnailUrl?.(session, activePageId, 144, previewRevision))
      || activePage.preview_url
      || runtime.previewUrl(session, activePageId, 288, previewRevision);
    if (!imageUrl) {
      setError('Unable to open the OCR viewer for the current page.');
      return;
    }
    const popup = window.open('', 'ocr-page-viewer', 'popup=yes,width=1180,height=920,resizable=yes,scrollbars=yes');
    if (!popup) {
      setError('Popup blocked while opening the OCR viewer.');
      return;
    }
    ocrViewerRef.current = popup;
    setStatus('OCR: preparing current page...');
    writeViewerWindow(popup, buildOcrViewerHtml({
      title: `${session.source_pdf_name} · page ${activePageId} · OCR`,
      imageUrl,
      imageWidth: 1,
      imageHeight: 1,
      boxesByGranularity: { block: [], line: [], grouped: [], word: [] },
      initialGranularity: 'line',
      statusMessage: 'Running OCR on the current page...',
      progressFraction: 0,
    }));
    popup.focus();

    ocrBusyRef.current = true;
    try {
      const image = await loadImageElement(imageUrl);
      const imageWidth = image.naturalWidth || image.width || 1;
      const imageHeight = image.naturalHeight || image.height || 1;
      const { createWorker, OEM } = await import('tesseract.js');
      const languageSpec = resolveTesseractLanguageSpec(
        session.source_language_code || 'he',
        session.target_language_code || '',
      );
      let lastProgress = -1;
      let lastStatus = '';
      let ocrResultRendered = false;
      const updateOcrProgress = (statusMessage: string, progressFraction: number | null = null) => {
        if (ocrResultRendered) {
          return;
        }
        setStatus(`OCR: ${statusMessage}`);
        if (!popup.closed) {
          writeViewerWindow(popup, buildOcrViewerHtml({
            title: `${session.source_pdf_name} · page ${activePageId} · OCR`,
            imageUrl,
            imageWidth,
            imageHeight,
            boxesByGranularity: { block: [], line: [], grouped: [], word: [] },
            statusMessage,
            progressFraction,
          }));
        }
      };
      const worker = await createWorker(languageSpec.spec, OEM.LSTM_ONLY, {
        workerPath: tesseractWorkerUrl,
        corePath: tesseractCoreUrl,
        logger: (message) => {
          if (ocrResultRendered) {
            return;
          }
          const next = normalizeTesseractProgressMessage(message);
          if (!next) return;
          const roundedProgress = next.progress == null ? null : Math.round(next.progress * 100) / 100;
          if (next.status === lastStatus && roundedProgress === lastProgress) {
            return;
          }
          lastStatus = next.status;
          lastProgress = roundedProgress == null ? -1 : roundedProgress;
          updateOcrProgress(next.status, next.progress);
        },
      });
      try {
        const result = await worker.recognize(image, {}, { blocks: true });
        const extractedBoxesByGranularity = extractTesseractBoxesByGranularity(result?.data) as Partial<OcrBoxesByGranularity>;
        const pageWidthPt = Number(activePage.page_size_pt?.[0] || 1);
        const pageHeightPt = Number(activePage.page_size_pt?.[1] || 1);
        const groupedPaddingX = OCR_GROUPED_PADDING_PT * (imageWidth / Math.max(1, pageWidthPt));
        const groupedPaddingY = OCR_GROUPED_PADDING_PT * (imageHeight / Math.max(1, pageHeightPt));
        const boxesByGranularity: OcrBoxesByGranularity = {
          block: Array.isArray(extractedBoxesByGranularity?.block) ? extractedBoxesByGranularity.block : [],
          line: Array.isArray(extractedBoxesByGranularity?.line) ? extractedBoxesByGranularity.line : [],
          grouped: Array.isArray(extractedBoxesByGranularity?.grouped)
            ? extractedBoxesByGranularity.grouped.map((box) => ({
              ...box,
              bbox: inflateOcrBBox(box.bbox, {
                paddingX: groupedPaddingX,
                paddingY: groupedPaddingY,
                maxWidth: imageWidth,
                maxHeight: imageHeight,
              }) || box.bbox,
            }))
            : [],
          word: Array.isArray(extractedBoxesByGranularity?.word) ? extractedBoxesByGranularity.word : [],
        };
        const initialBoxes = boxesByGranularity.line;
        ocrResultRendered = true;
        setStatus(`OCR complete: ${initialBoxes.length} line${initialBoxes.length === 1 ? '' : 's'} detected.`);
        writeViewerWindow(popup, buildOcrViewerHtml({
          title: `${session.source_pdf_name} · page ${activePageId} · OCR`,
          imageUrl,
          imageWidth,
          imageHeight,
          boxesByGranularity,
          initialGranularity: 'grouped',
          statusMessage: languageSpec.spec,
        }));
      } finally {
        await worker.terminate();
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      writeViewerWindow(popup, buildOcrViewerHtml({
        title: `${session.source_pdf_name} · page ${activePageId} · OCR`,
        imageUrl,
        imageWidth: 1,
        imageHeight: 1,
        boxesByGranularity: { block: [], line: [], grouped: [], word: [] },
        errorMessage: message,
      }));
      setError(message);
      setStatus('OCR failed.');
    } finally {
      ocrBusyRef.current = false;
    }
  }

  async function openOriginalBackgroundViewer(): Promise<void> {
    if (!activePageId) {
      return;
    }
    const imageUrl = (runtime.textlessBackgroundUrl?.(session, activePageId, 144, previewRevision))
      || (runtime.thumbnailUrl?.(session, activePageId, 144, previewRevision))
      || runtime.previewUrl(session, activePageId, 144, previewRevision);
    const backgroundRegions = runtime.textlessBackgroundRegions?.(session, activePageId) || null;
    if (!imageUrl) {
      setError('Unable to open the textless page background for the current page.');
      return;
    }
    let rasterLogoCandidates: Array<{
      visual_id: string;
      bbox: number[];
      kind: 'raster_logo_candidate';
      score: number;
    }> = [];
    try {
      rasterLogoCandidates = await detectRasterLogoCandidatesFromImageUrl({
        imageUrl,
        pageWidthPt: Number(backgroundRegions?.pageSizePt?.[0] || 1),
        pageHeightPt: Number(backgroundRegions?.pageSizePt?.[1] || 1),
        excludeBboxesPt: (Array.isArray(backgroundRegions?.regions) ? backgroundRegions.regions : [])
          .filter((region) => region && region.kind === 'image' && Array.isArray(region.bbox))
          .map((region) => region.bbox as number[]),
      });
    } catch (detectionError) {
      console.warn('[raster-logo-candidates] failed', detectionError);
    }
    const popup = window.open('', 'original-page-background-viewer', 'popup=yes,width=1180,height=920,resizable=yes,scrollbars=yes');
    if (!popup) {
      setError('Popup blocked while opening the textless page background.');
      return;
    }
    originalBackgroundViewerRef.current = popup;
    writeViewerWindow(popup, buildStaticImageViewerHtml({
      title: `${session.source_pdf_name} · page ${activePageId} · Textless background`,
      imageUrl,
      note: 'Page background without text',
      pageWidthPt: Number(backgroundRegions?.pageSizePt?.[0] || 1),
      pageHeightPt: Number(backgroundRegions?.pageSizePt?.[1] || 1),
      visualRegions: [
        ...(Array.isArray(backgroundRegions?.regions) ? backgroundRegions.regions : []),
        ...rasterLogoCandidates,
      ],
    }));
    popup.focus();
  }

  function openSourceBarrierViewer(): void {
    if (!activePageId) {
      return;
    }
    const imageUrl = (runtime.thumbnailUrl?.(session, activePageId, 144, previewRevision))
      || runtime.previewUrl(session, activePageId, 144, previewRevision);
    const backgroundRegions = runtime.textlessBackgroundRegions?.(session, activePageId) || null;
    if (!imageUrl) {
      setError('Unable to open the original page preview for the current page.');
      return;
    }
    const popup = window.open('', 'source-page-barrier-viewer', 'popup=yes,width=1180,height=920,resizable=yes,scrollbars=yes');
    if (!popup) {
      setError('Popup blocked while opening the source page barrier viewer.');
      return;
    }
    sourceBarrierViewerRef.current = popup;
    writeViewerWindow(popup, buildStaticImageViewerHtml({
      title: `${session.source_pdf_name} · page ${activePageId} · Source barriers`,
      imageUrl,
      note: 'Original page image with barriers detected from the textless source preview',
      pageWidthPt: Number(backgroundRegions?.pageSizePt?.[0] || activePage?.page_size_pt?.[0] || 1),
      pageHeightPt: Number(backgroundRegions?.pageSizePt?.[1] || activePage?.page_size_pt?.[1] || 1),
      horizontalBarrierSegments: Array.isArray(backgroundRegions?.horizontalBarriers) ? backgroundRegions.horizontalBarriers : [],
      verticalBarrierSegments: Array.isArray(backgroundRegions?.verticalBarriers) ? backgroundRegions.verticalBarriers : [],
    }));
    popup.focus();
  }

  function openTableCellViewer(): void {
    if (!activePageId) {
      return;
    }
    const imageUrl = (runtime.thumbnailUrl?.(session, activePageId, 144, previewRevision))
      || runtime.previewUrl(session, activePageId, 144, previewRevision);
    const backgroundRegions = runtime.textlessBackgroundRegions?.(session, activePageId) || null;
    if (!imageUrl) {
      setError('Unable to open the original page preview for the current page.');
      return;
    }
    const horizontalBarriers = Array.isArray(backgroundRegions?.horizontalBarriers) ? backgroundRegions.horizontalBarriers : [];
    const verticalBarriers = Array.isArray(backgroundRegions?.verticalBarriers) ? backgroundRegions.verticalBarriers : [];
    const pageWidthPt = Number(backgroundRegions?.pageSizePt?.[0] || activePage?.page_size_pt?.[0] || 1);
    const pageHeightPt = Number(backgroundRegions?.pageSizePt?.[1] || activePage?.page_size_pt?.[1] || 1);
    const tableCells = detectTableCells(horizontalBarriers, verticalBarriers, pageWidthPt, pageHeightPt);
    const popup = window.open('', 'table-cell-viewer', 'popup=yes,width=1180,height=920,resizable=yes,scrollbars=yes');
    if (!popup) {
      setError('Popup blocked while opening the table cell viewer.');
      return;
    }
    tableCellViewerRef.current = popup;
    writeViewerWindow(popup, buildStaticImageViewerHtml({
      title: `${session.source_pdf_name} · page ${activePageId} · Table cells`,
      imageUrl,
      note: `${tableCells.length} table cell(s) detected from barrier intersections`,
      pageWidthPt,
      pageHeightPt,
      horizontalBarrierSegments: horizontalBarriers,
      verticalBarrierSegments: verticalBarriers,
      tableCells,
    }));
    popup.focus();
  }

  function openTranslationInspectionViewer(): void {
    const popup = window.open('', 'translation-inspection-viewer', 'popup=yes,width=1280,height=920,resizable=yes,scrollbars=yes');
    if (!popup) {
      setError('Popup blocked while opening the translation inspection viewer.');
      return;
    }
    translationInspectionViewerRef.current = popup;
    writeViewerWindow(popup, buildTranslationInspectionViewerHtml({
      title: `${session.source_pdf_name} · Browser Translator Requests`,
      entries: listBrowserTranslationInspectionEntries(),
    }));
    popup.focus();
  }

  // ---- Derived data ----

  const activePage = useMemo(
    () => (activePageId == null ? null : (pageCache[activePageId] || null)),
    [activePageId, pageCache],
  );

  const selectedEntries = useMemo(
    () => selectedBlockEntries(pageCache, selectedBlockIds),
    [pageCache, selectedBlockIds],
  );
  const selectedBlocks = useMemo(
    () => selectedEntries.map((entry) => entry.block),
    [selectedEntries],
  );

  const primarySelectedBlock = selectedBlocks.length ? selectedBlocks[0] : null;
  const selectedBlockPageId = useMemo(() => {
    if (!selectedEntries.length) return null;
    const firstPageId = selectedEntries[0].pageId;
    return selectedEntries.every((entry) => entry.pageId === firstPageId) ? firstPageId : null;
  }, [selectedEntries]);
  const selectedBlockPage = useMemo(
    () => (selectedBlockPageId == null ? null : (pageCache[selectedBlockPageId] || null)),
    [selectedBlockPageId, pageCache],
  );

  const sharedFontSizes = selectUnique(selectedBlocks.map((block) => Number(block.font_size).toFixed(2)));
  const sharedAlignments = selectUnique(selectedBlocks.map((block) => toolbarAlignmentValue(block.alignment || 'left')));
  const sharedWeights = selectUnique(selectedBlocks.map((block) => String(block.font_weight || 'normal')));
  const sharedWrapModes = selectUnique(selectedBlocks.map((block) => wrapModeForBlock(block as unknown as Record<string, unknown>)));
  const hasBlockSelection = selectedBlocks.length > 0;
  const toolbarFontSizeValue = hasBlockSelection && sharedFontSizes.length === 1 ? sharedFontSizes[0] : '';
  const toolbarFontSizePlaceholder = hasBlockSelection
    ? (sharedFontSizes.length === 1 ? 'Size' : 'Mixed')
    : '';
  const toolbarAlignment = hasBlockSelection && sharedAlignments.length === 1 ? sharedAlignments[0] : '';
  const toolbarWeight = hasBlockSelection && sharedWeights.length === 1 ? sharedWeights[0] : '';
  const toolbarWrapMode = hasBlockSelection && sharedWrapModes.length === 1 ? sharedWrapModes[0] : '';

  const docTextColors = useMemo(
    () => extractDocTextColors(Object.values(pageCache)),
    [pageCache],
  );

  const docBgColors = useMemo(
    () => extractDocBgColors(Object.values(pageCache)),
    [pageCache],
  );

  const selectedGraphicPageId = useMemo(() => {
    if (!selectedGraphicRegionId) return activePageId;
    for (const [rawPageId, page] of Object.entries(pageCache)) {
      if (page.graphic_regions.some((region) => region.region_id === selectedGraphicRegionId)) {
        return Number(rawPageId);
      }
    }
    return activePageId;
  }, [selectedGraphicRegionId, activePageId, activePage, pageCache]);

  function syncActivePageFromViewport() {
    const canvas = canvasRef.current;
    if (!canvas || !session.page_ids.length) return;
    const canvasRect = canvas.getBoundingClientRect();
    const probeY = canvasRect.top + Math.min(64, Math.max(24, canvasRect.height * 0.08));
    const rectByPageId: Record<number, { top: number; bottom: number }> = {};
    for (const pageId of session.page_ids) {
      const stage = pageStageRefs.current[pageId];
      if (!stage) continue;
      const rect = stage.getBoundingClientRect();
      rectByPageId[pageId] = { top: rect.top, bottom: rect.bottom };
    }
    const nextPageId = resolveActivePageIdFromViewport({
      pageIds: session.page_ids,
      rectByPageId,
      viewportTop: canvasRect.top,
      viewportBottom: canvasRect.bottom,
      probeY,
      fallbackPageId: activePageIdRef.current,
    });
    if (nextPageId !== activePageIdRef.current) {
      setActivePageId(nextPageId);
    }
  }

  function syncActivePageFromVisibility() {
    const nextPageId = resolveActivePageIdFromVisibility({
      pageIds: session.page_ids,
      visibilityByPageId: visibilityByPageIdRef.current,
      fallbackPageId: activePageIdRef.current,
    });
    if (nextPageId !== activePageIdRef.current) {
      setActivePageId(nextPageId);
    }
  }

  function scheduleViewportSync() {
    if (viewportSyncFrameRef.current != null) {
      return;
    }
    viewportSyncFrameRef.current = window.requestAnimationFrame(() => {
      viewportSyncFrameRef.current = null;
      syncActivePageFromViewport();
    });
  }

  function scrollPageIntoView(pageId: number) {
    setActivePageId(pageId);
    pageStageRefs.current[pageId]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---- Effects ----

  // Set active page when session changes
  useEffect(() => {
    if (!session.page_ids.length) {
      setActivePageId(null);
      setPageCache({});
      setPreviewSizesByPage({});
      setGraphicBaselineByPage({});
      setSelectedBlockIds([]);
      setSelectedGraphicRegionId('');
      setInlineEditor(null);
      setDirty(false);
      return;
    }
    const nextPageId = activePageId && session.page_ids.includes(activePageId)
      ? activePageId
      : session.page_ids[0];
    setActivePageId(nextPageId);
  }, [session, activePageId]);

  // Scroll active thumbnail into view in the sidebar
  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  useEffect(() => {
    if (activePageId != null && thumbRefs.current[activePageId]) {
      thumbRefs.current[activePageId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activePageId]);

  useEffect(() => {
    if (canvasBlockLoupe && canvasBlockLoupe.pageId !== activePageId) {
      setCanvasBlockLoupe(null);
    }
  }, [activePageId, canvasBlockLoupe]);

  useEffect(() => () => {
    if (viewportSyncFrameRef.current != null) {
      window.cancelAnimationFrame(viewportSyncFrameRef.current);
    }
    if (tightBBoxViewerRef.current && !tightBBoxViewerRef.current.closed) {
      tightBBoxViewerRef.current.close();
    }
    tightBBoxViewerRef.current = null;
    if (originalBackgroundViewerRef.current && !originalBackgroundViewerRef.current.closed) {
      originalBackgroundViewerRef.current.close();
    }
    originalBackgroundViewerRef.current = null;
    if (sourceBarrierViewerRef.current && !sourceBarrierViewerRef.current.closed) {
      sourceBarrierViewerRef.current.close();
    }
    sourceBarrierViewerRef.current = null;
    if (tableCellViewerRef.current && !tableCellViewerRef.current.closed) {
      tableCellViewerRef.current.close();
    }
    tableCellViewerRef.current = null;
    if (ocrViewerRef.current && !ocrViewerRef.current.closed) {
      ocrViewerRef.current.close();
    }
    ocrViewerRef.current = null;
    if (translationInspectionViewerRef.current && !translationInspectionViewerRef.current.closed) {
      translationInspectionViewerRef.current.close();
    }
    translationInspectionViewerRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const canvas = canvasRef.current;
    const handleResize = () => scheduleViewportSync();
    window.addEventListener('resize', handleResize);
    canvas?.addEventListener('scroll', scheduleViewportSync, { passive: true });
    scheduleViewportSync();
    return () => {
      window.removeEventListener('resize', handleResize);
      canvas?.removeEventListener('scroll', scheduleViewportSync);
    };
  }, [session.page_ids, pageCache]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    visibilityByPageIdRef.current = {};
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const pageId = Number(target.dataset.pageId || 0);
        if (!pageId) continue;
        const rootTop = entry.rootBounds?.top ?? 0;
        visibilityByPageIdRef.current[pageId] = {
          visibleHeight: entry.intersectionRect.height,
          top: entry.boundingClientRect.top - rootTop,
        };
      }
      syncActivePageFromVisibility();
    }, {
      root: canvas,
      threshold: [0, 0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1],
    });

    for (const pageId of session.page_ids) {
      const stage = pageStageRefs.current[pageId];
      if (stage) {
        observer.observe(stage);
      }
    }
    scheduleViewportSync();
    return () => {
      observer.disconnect();
    };
  }, [session.page_ids, pageCache]);

  // Load missing pages
  useEffect(() => {
    const missingPageIds = session.page_ids.filter((pageId) => !pageCache[pageId]);
    if (!missingPageIds.length) return;
    void (async () => {
      try {
        const loaded = await Promise.all(missingPageIds.map((pageId) => runtime.fetchPage(session, pageId)));
        setPageCache((current) => {
          const next = { ...current };
          for (const page of loaded) {
            next[page.page_id] = page;
          }
          return next;
        });
        for (const page of loaded) {
          captureGraphicBaselineFromPage(page);
        }
      } catch (nextError) {
        setError(String(nextError));
      }
    })();
  }, [session, pageCache]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!runtime.persistDraftPages) {
      return;
    }
    const pages = Object.values(pageCache);
    if (!pages.length) {
      return;
    }
    runtime.persistDraftPages(session, pages);
  }, [runtime, session, pageCache]);

  useEffect(() => {
    if (Boolean(session.has_unsaved_local_edits) === dirty) {
      return;
    }
    onSessionUpdate({
      ...session,
      has_unsaved_local_edits: dirty,
    });
  }, [dirty, onSessionUpdate, session]);

  // Warn before leaving when there are unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Validate selection when page changes
  useEffect(() => {
    if (!session.page_ids.length) {
      setSelectedBlockIds([]);
      setSelectedGraphicRegionId('');
      setInlineEditor(null);
      return;
    }
    const validBlockIds = new Set<string>();
    for (const page of Object.values(pageCache)) {
      for (const block of page.blocks) {
        validBlockIds.add(block.source_block_id);
      }
    }
    setSelectedBlockIds((current) => current.filter((blockId) => validBlockIds.has(blockId)));

    const validRegionIds = new Set<string>();
    for (const page of Object.values(pageCache)) {
      for (const region of page.graphic_regions) {
        validRegionIds.add(String(region.region_id));
      }
    }
    if (!validRegionIds.has(selectedGraphicRegionId)) {
      setSelectedGraphicRegionId('');
    }
  }, [session.page_ids, pageCache, selectedGraphicRegionId]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = String(target?.tagName || '').toLowerCase();
      const typingTarget = tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);
      if (typingTarget) return;
      if (inlineEditor) {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelInlineEditor();
        }
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (mod && event.key === 'z' && event.shiftKey) {
        event.preventDefault();
        handleRedo();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedBlockIds.length > 0) {
        event.preventDefault();
        deleteSelectedBlocks();
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        joinSelectedBlocks();
      }
      // Arrow-key block movement (1pt default, 10pt with Shift)
      if (!mod && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && selectedBlockIds.length > 0 && selectedBlockPage) {
        const step = event.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        event.preventDefault();
        const pageWidthPt = Number(selectedBlockPage.page_size_pt?.[0] || 1);
        const pageHeightPt = Number(selectedBlockPage.page_size_pt?.[1] || 1);
        if (selectedBlockPageId != null) snapshotPageForUndo(selectedBlockPageId);
        const selected = new Set(selectedBlockIds);
        const nextBlocks = selectedBlockPage.blocks.map((block) => {
          if (!selected.has(block.source_block_id)) return block;
          const movedBlock = {
            ...block,
            bbox: clampMovedBbox(block.bbox, dx, dy, pageWidthPt, pageHeightPt),
          } as PageBlock & Record<string, unknown>;
          movedBlock.bbox_edited = true;
          return clearStoredDrawPlan(movedBlock) as PageBlock;
        });
        replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
        setDirty(true);
        return;
      }
      // Cmd+B — toggle bold
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'b' && selectedBlockIds.length > 0 && selectedBlockPage) {
        event.preventDefault();
        const allBold = selectedBlockEntries(pageCache, selectedBlockIds).every(
          (entry) => String((entry.block as unknown as Record<string, unknown>).font_weight || 'normal') === 'bold',
        );
        updateSelectedWeight(allBold ? 'normal' : 'bold');
        return;
      }
      // Cmd+A — select all blocks on active page
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'a' && activePage) {
        event.preventDefault();
        setSelectedBlockIds(activePage.blocks.map((b) => b.source_block_id));
        return;
      }
      // Cmd+Plus/Minus — step font size
      if (mod && !event.shiftKey && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        handleFontSizeStep(1);
        return;
      }
      if (mod && !event.shiftKey && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        handleFontSizeStep(-1);
        return;
      }
      // Escape — deselect all
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedBlockIds([]);
        setSelectedGraphicRegionId('');
        return;
      }
      // Prevent Cmd+Left/Right from triggering browser back/forward navigation
      if (mod && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        return;
      }
      // Page navigation — PageUp/PageDown or Cmd+ArrowUp/ArrowDown
      if (event.key === 'PageUp' || event.key === 'PageDown' || (mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))) {
        const pageIds = session.page_ids;
        if (activePageId != null && pageIds.length > 1) {
          event.preventDefault();
          const currentIndex = pageIds.indexOf(activePageId);
          const direction = (event.key === 'PageUp' || event.key === 'ArrowUp') ? -1 : 1;
          const nextIndex = Math.max(0, Math.min(pageIds.length - 1, currentIndex + direction));
          if (nextIndex !== currentIndex) {
            setSelectedBlockIds([]);
            setSelectedGraphicRegionId('');
            setActivePageId(pageIds[nextIndex]);
          }
        }
        return;
      }
      if (!mod && !event.shiftKey && !inlineEditor) {
        if (event.key === 'v' || event.key === 'V') {
          setToolMode('select');
          event.preventDefault();
          return;
        }
      }
      if (!mod && !event.shiftKey && !inlineEditor) {
        if (!debugInspectionsEnabled) {
          if (event.key === 't' || event.key === 'T') {
            setToolMode('text');
            event.preventDefault();
            return;
          }
          if (event.key === 'i' || event.key === 'I') {
            setToolMode('region');
            event.preventDefault();
            return;
          }
        }
      }
      if (debugInspectionsEnabled) {
        if (event.key === 'q') {
          setNudgeOverlay((prev) => !prev);
        }
        if (event.key === 'w') {
          setTightBBoxOverlay((prev) => !prev);
        }
        if (event.key === 'e') {
          event.preventDefault();
          openTightBBoxViewer();
        }
        if (event.key === 'a') {
          event.preventDefault();
          void openOriginalBackgroundViewer();
        }
        if (event.key === 's') {
          event.preventDefault();
          openSourceBarrierViewer();
        }
        if (event.key === 'u') {
          event.preventDefault();
          openTableCellViewer();
        }
        if (event.key === 'i') {
          event.preventDefault();
          void openOcrViewer();
        }
        if (event.key === 't') {
          event.preventDefault();
          openTranslationInspectionViewer();
        }
        if (event.key === 'd') {
          setContinuationOverlay((prev) => !prev);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [debugInspectionsEnabled, enableTesseractOcr, inlineEditor, selectedBlockIds, activePage, activePageId, previewRevision, runtime, session, pageCache, continuationOverlay]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Helper functions ----

  function captureGraphicBaselineFromPage(page: PagePayload) {
    const byRegion: Record<string, GraphicBaselineEdit> = {};
    for (const region of page.graphic_regions) {
      const entry: GraphicBaselineEdit = {};
      if (Boolean(region.flipped)) {
        entry.flipped = true;
      }
      if (Array.isArray(region.moved_bbox) && region.moved_bbox.length === 4) {
        entry.bbox = region.moved_bbox.map((value) => Number(value));
      }
      if (entry.flipped || entry.bbox) {
        byRegion[String(region.region_id)] = entry;
      }
    }
    setGraphicBaselineByPage((current) => ({
      ...current,
      [page.page_id]: byRegion,
    }));
  }

  async function ensurePageLoaded(pageId: number): Promise<PagePayload> {
    const cached = pageCache[pageId];
    if (cached) return cached;
    const loaded = await runtime.fetchPage(session, pageId);
    setPageCache((current) => ({ ...current, [pageId]: loaded }));
    captureGraphicBaselineFromPage(loaded);
    return loaded;
  }

  function replacePageBlocks(pageId: number, nextBlocks: PageBlock[], { recomputeWarnings = false }: { recomputeWarnings?: boolean } = {}) {
    const page = pageCache[pageId];
    if (!page) return;
    const nextPageBase: PagePayload = { ...page, blocks: nextBlocks };
    const nextPage = recomputeWarnings ? recomputePageWarnings(nextPageBase) : nextPageBase;
    setPageCache((current) => {
      const nextCache = { ...current, [nextPage.page_id]: nextPage };
      setSelectedBlockIds((selection) => normalizeSelectionOrder(selection, nextCache));
      return nextCache;
    });
  }

  function clearSelection() {
    setSelectedBlockIds([]);
    setSelectedGraphicRegionId('');
  }

  function snapshotPageForUndo(pageId: number) {
    const page = pageCache[pageId];
    if (!page) return;
    undoStack.push({
      pageId,
      blocks: structuredClone(page.blocks),
      graphicRegions: structuredClone(page.graphic_regions),
    });
  }

  function handleUndo() {
    const entry = undoStack.undo();
    if (!entry) return;
    setPageCache((current) => {
      const page = current[entry.pageId];
      if (!page) return current;
      const restored = { ...page, blocks: entry.blocks as PageBlock[], graphic_regions: entry.graphicRegions as any[] };
      recomputePageWarnings(restored, { recomputeAllDrawPlans: true });
      return { ...current, [entry.pageId]: restored };
    });
    setSelectedBlockIds([]);
    setSelectedGraphicRegionId('');
    setDirty(true);
    setUndoRevision((r) => r + 1);
  }

  function handleRedo() {
    const entry = undoStack.redo();
    if (!entry) return;
    setPageCache((current) => {
      const page = current[entry.pageId];
      if (!page) return current;
      const restored = { ...page, blocks: entry.blocks as PageBlock[], graphic_regions: entry.graphicRegions as any[] };
      recomputePageWarnings(restored, { recomputeAllDrawPlans: true });
      return { ...current, [entry.pageId]: restored };
    });
    setSelectedBlockIds([]);
    setSelectedGraphicRegionId('');
    setDirty(true);
    setUndoRevision((r) => r + 1);
  }

  function handleFontSizeStep(delta: number) {
    if (!selectedBlockPage || !selectedBlockIds.length) return;
    if (selectedBlockPageId != null) snapshotPageForUndo(selectedBlockPageId);
    const selected = new Set(selectedBlockIds);
    let changed = false;
    const nextBlocks = selectedBlockPage.blocks.map((block) => {
      if (!selected.has(block.source_block_id)) return block;
      const nextFontSize = Math.max(1, Math.round((block.font_size + delta) * 100) / 100);
      if (Math.abs(nextFontSize - Number(block.font_size || 0)) <= 0.001) {
        return block;
      }
      changed = true;
      return clearStoredDrawPlan({
        ...block,
        font_size: nextFontSize,
        line_height: rescaledLineHeightForFontSize(block, nextFontSize),
      }) as PageBlock;
    });
    if (!changed) return;
    replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
    setDirty(true);
  }

  function handleFontSizeCommit(nextValue: number) {
    const rounded = Math.round(Number(nextValue) * 100) / 100;
    if (!Number.isFinite(rounded) || rounded <= 0) return;
    updateSelectedBlocks({ font_size: rounded });
  }

  function handleToolbarAlignmentChange(nextAlignment: 'left' | 'center' | 'right' | 'justify') {
    updateSelectedBlocks({
      alignment: nextAlignment,
      alignment_edited: true,
    });
  }

  function handleAutoFit() {
    if (!selectedBlockPage || !selectedBlockIds.length) return;
    if (selectedBlockPageId != null) snapshotPageForUndo(selectedBlockPageId);
    const selected = new Set(selectedBlockIds);
    let changed = false;
    const nextBlocks = selectedBlockPage.blocks.map((block) => {
      if (!selected.has(block.source_block_id)) return block;
      const fittedBlock = fitBlockToWarningPreview(block, {
        blocks: selectedBlockPage.blocks,
        pageSize: selectedBlockPage.page_size_pt,
      }) as PageBlock & Record<string, unknown>;
      const nextFontSize = Math.round(Number(fittedBlock.font_size || 0) * 100) / 100;
      const nextLineHeight = Math.round(Number(fittedBlock.line_height || 0) * 100) / 100;
      if (!Number.isFinite(nextFontSize) || nextFontSize <= 0) return block;
      if (
        Math.abs(nextFontSize - Number(block.font_size || 0)) <= 0.001
        && Math.abs(nextLineHeight - Number(block.line_height || 0)) <= 0.001
      ) {
        return block;
      }
      changed = true;
      return clearStoredDrawPlan({
        ...block,
        font_size: nextFontSize,
        line_height: nextLineHeight,
        overflow: Boolean(fittedBlock.overflow),
        truncated: Boolean(fittedBlock.truncated),
      }) as PageBlock;
    });
    if (!changed) return;
    replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
    setDirty(true);
  }

  function updateSelectedBlocks(patch: Partial<PageBlock>): boolean {
    if (!selectedBlockPage || !selectedBlockIds.length) return false;
    if (selectedBlockPageId != null) snapshotPageForUndo(selectedBlockPageId);
    const selected = new Set(selectedBlockIds);
    let changed = false;
    const nextBlocks = selectedBlockPage.blocks.map((block) => {
      if (!selected.has(block.source_block_id)) return block;
      const next = { ...block } as PageBlock & Record<string, unknown>;
      let blockChanged = false;
      for (const [key, value] of Object.entries(patch)) {
        const typedKey = key as keyof PageBlock;
        if (next[typedKey] !== value) {
          next[typedKey] = value as never;
          blockChanged = true;
          changed = true;
        }
      }
      if (blockChanged && Object.prototype.hasOwnProperty.call(patch, 'font_size') && !Object.prototype.hasOwnProperty.call(patch, 'line_height')) {
        const nextFontSize = Number(next.font_size);
        if (Number.isFinite(nextFontSize) && nextFontSize > 0) {
          next.line_height = rescaledLineHeightForFontSize(block, nextFontSize);
        }
      }
      if (blockChanged) {
        return clearStoredDrawPlan(next) as PageBlock;
      }
      return next as PageBlock;
    });
    if (!changed) return false;
    replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
    setDirty(true);
    return true;
  }

  function updateSelectedWrapMode(nextMode: 'none' | 'word'): boolean {
    if (!selectedBlockPage || !selectedBlockIds.length) return false;
    if (selectedBlockPageId != null) snapshotPageForUndo(selectedBlockPageId);
    const selected = new Set(selectedBlockIds);
    let changed = false;
    const nextBlocks = selectedBlockPage.blocks.map((block) => {
      if (!selected.has(block.source_block_id)) return block;
      const next = { ...block } as PageBlock & Record<string, unknown>;
      const currentMode = wrapModeForBlock(next);
      if (currentMode === nextMode) {
        return block;
      }
      next.wrap_mode = nextMode;
      changed = true;
      return clearStoredDrawPlan(next) as PageBlock;
    });
    if (!changed) return false;
    replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
    setDirty(true);
    return true;
  }

  function updateSelectedWeight(nextWeight: 'normal' | 'bold'): boolean {
    if (!selectedBlockPage || !selectedBlockIds.length) return false;
    if (selectedBlockPageId != null) snapshotPageForUndo(selectedBlockPageId);
    const selected = new Set(selectedBlockIds);
    let changed = false;
    const nextBlocks = selectedBlockPage.blocks.map((block) => {
      if (!selected.has(block.source_block_id)) return block;
      const next = { ...block } as PageBlock & Record<string, unknown>;
      const currentWeight = String(next.font_weight || 'normal');
      const policy = String(next.faux_bold_policy || 'semantic');
      const renderMode = Number(next.render_mode || 0);
      const shouldDisableFaux = nextWeight === 'normal' && policy === 'semantic' && renderMode === 2;
      if (currentWeight === nextWeight && !shouldDisableFaux) {
        return block;
      }
      next.font_weight = nextWeight;
      if (shouldDisableFaux) {
        next.render_mode = 0;
        next.stroke_width = 0.0;
        next.effective_font_weight = 'normal';
      } else if (nextWeight === 'bold') {
        next.effective_font_weight = 'bold';
      }
      changed = true;
      return clearStoredDrawPlan(next) as PageBlock;
    });
    if (!changed) return false;
    replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
    setDirty(true);
    return true;
  }

  function deleteSelectedBlocks() {
    if (!selectedBlockPage || !selectedBlockIds.length) return;
    if (selectedBlockPageId != null) snapshotPageForUndo(selectedBlockPageId);
    if (inlineEditor) {
      commitInlineEditor();
    }
    const selected = new Set(selectedBlockIds);
    const nextBlocks = selectedBlockPage.blocks.filter((block) => !selected.has(block.source_block_id));
    if (nextBlocks.length === selectedBlockPage.blocks.length) return;
    replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
    setSelectedBlockIds([]);
    setInlineEditor(null);
    setDirty(true);
    setStatus('Deleted selected blocks.');
  }

  async function joinSelectedBlocks() {
    if (selectedBlockIds.length < 2) return;
    if (inlineEditor) {
      commitInlineEditor();
    }
    const selected = selectedBlockEntries(pageCache, selectedBlockIds);
    if (selected.length < 2) return;
    const pageId = selected[0].pageId;
    if (selected.some((item) => item.pageId !== pageId)) {
      setStatus('Join requires all selected blocks to be on the same page.');
      setError('Join requires all selected blocks to be on the same page.');
      return;
    }
    const page = pageCache[pageId];
    if (!page) return;
    snapshotPageForUndo(pageId);

    const anchor = selected[0].block;
    const anchorId = anchor.source_block_id;
    let text = mergeBlockTextParts(selected.map((item) => item.block), 'text') || String(anchor.text || '');
    const sourceText = mergeBlockTextParts(selected.map((item) => item.block), 'source_text') || String(anchor.source_text || '');
    let retranslated = false;
    if (
      runtime.translateJoinedBlock
      && shouldRetranslateJoinedBlock({
        mergedText: text,
        mergedSourceText: sourceText,
        sourceLanguageCode: session.source_language_code,
        targetLanguageCode: session.target_language_code,
      })
    ) {
      try {
        const nextTranslatedText = await runtime.translateJoinedBlock(session, {
          pageId,
          sourceText,
          blockType: String(anchor.block_type || 'paragraph'),
        });
        if (nextTranslatedText) {
          text = nextTranslatedText;
          retranslated = true;
        }
      } catch (error) {
        console.warn('[editor] join block re-translation failed', {
          sessionId: session.session_id,
          pageId,
          blockId: anchorId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    let sourceX0 = Number.POSITIVE_INFINITY;
    let sourceY0 = Number.POSITIVE_INFINITY;
    let sourceX1 = Number.NEGATIVE_INFINITY;
    let sourceY1 = Number.NEGATIVE_INFINITY;
    for (const item of selected) {
      x0 = Math.min(x0, Number(item.block.bbox[0]) || 0);
      y0 = Math.min(y0, Number(item.block.bbox[1]) || 0);
      x1 = Math.max(x1, Number(item.block.bbox[2]) || 0);
      y1 = Math.max(y1, Number(item.block.bbox[3]) || 0);
      const sourceBboxRaw = Array.isArray(item.block.source_bbox) && item.block.source_bbox.length === 4
        ? item.block.source_bbox
        : item.block.bbox;
      sourceX0 = Math.min(sourceX0, Number(sourceBboxRaw[0]) || 0);
      sourceY0 = Math.min(sourceY0, Number(sourceBboxRaw[1]) || 0);
      sourceX1 = Math.max(sourceX1, Number(sourceBboxRaw[2]) || 0);
      sourceY1 = Math.max(sourceY1, Number(sourceBboxRaw[3]) || 0);
    }

    const removeIds = new Set(selected.slice(1).map((item) => item.block.source_block_id));
    const nextBlocks = page.blocks
      .filter((block) => !removeIds.has(block.source_block_id))
      .map((block) => {
        if (block.source_block_id !== anchorId) return block;
        const nextBlock = buildJoinedBlockForFit(block, selected.map((item) => item.block), {
          text,
          sourceText,
          bbox: [x0, y0, x1, y1],
          sourceBBox: [sourceX0, sourceY0, sourceX1, sourceY1],
        }) as PageBlock & Record<string, unknown>;
        const fittedBlock = fitBlockToWarningPreview(nextBlock, {
          blocks: page.blocks.filter((b) => !removeIds.has(b.source_block_id)),
          pageSize: page.page_size_pt,
        }) as PageBlock & Record<string, unknown>;
        const nextFontSize = Math.round(Number(fittedBlock.font_size || 0) * 100) / 100;
        const nextLineHeight = Math.round(Number(fittedBlock.line_height || 0) * 100) / 100;
        if (Number.isFinite(nextFontSize) && nextFontSize > 0) {
          nextBlock.font_size = nextFontSize;
          nextBlock.line_height = nextLineHeight;
          nextBlock.overflow = Boolean(fittedBlock.overflow);
          nextBlock.truncated = Boolean(fittedBlock.truncated);
        }
        return clearStoredDrawPlan(nextBlock) as PageBlock;
      });

    setPageCache((current) => {
      const currentPage = current[pageId] || page;
      const nextPage = recomputePageWarnings({
        ...currentPage,
        blocks: nextBlocks,
      });
      return {
        ...current,
        [pageId]: nextPage,
      };
    });
    setSelectedBlockIds([anchorId]);
    setDirty(true);
    setStatus(retranslated ? 'Joined selected blocks and retranslated.' : 'Joined selected blocks.');
    setError('');
  }

  function previewScaleForPage(pageId: number, page: PagePayload): number {
    const previewSize = previewSizesByPage[pageId];
    const width = Number(page.page_size_pt?.[0]) || 1;
    if (!previewSize || previewSize.width <= 0 || width <= 0) return 1;
    return previewSize.width / width;
  }

  function handleOverlayPointerDown(event: React.PointerEvent<HTMLDivElement>, pageId: number) {
    if (event.button !== 0) return;

    // ── Text tool: draw rectangle to create new block ──
    if (toolMode === 'text') {
      event.preventDefault();
      const stageEl = pageStageRefs.current[pageId];
      if (!stageEl) return;
      const rect = stageEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setCreationDrag({ pageId, startX: x, startY: y, currentX: x, currentY: y });

      const handleMove = (e: PointerEvent) => {
        setCreationDrag((prev) => prev ? { ...prev, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top } : null);
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        setCreationDrag((current) => {
          if (!current) return null;
          const page = pageCache[current.pageId];
          if (!page) return null;
          const scale = previewScaleForPage(current.pageId, page);
          const x0 = Math.min(current.startX, current.currentX) / scale;
          const y0 = Math.min(current.startY, current.currentY) / scale;
          const x1 = Math.max(current.startX, current.currentX) / scale;
          const y1 = Math.max(current.startY, current.currentY) / scale;
          // Minimum size check (20x10 pt)
          if ((x1 - x0) < 20 || (y1 - y0) < 10) return null;

          const blockId = `user-block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const newBlock: PageBlock = {
            source_block_id: blockId,
            text: NEW_TEXT_BLOCK_PLACEHOLDER,
            bbox: [x0, y0, x1, y1],
            font_size: 12,
            alignment: 'left',
            font_family: 'sans-serif',
            font_weight: 'normal',
            wrap_mode: 'word',
            clip_mode: 'off',
            overflow: false,
            collision: false,
            redacted: false,
            block_type: 'paragraph',
            bbox_edited: true,
          };

          snapshotPageForUndo(current.pageId);
          setPageCache((cache) => {
            const p = cache[current.pageId];
            if (!p) return cache;
            const nextPage = { ...p, blocks: [...p.blocks, newBlock] };
            recomputePageWarnings(nextPage);
            return { ...cache, [current.pageId]: nextPage };
          });
          setSelectedBlockIds([blockId]);
          setSelectedGraphicRegionId('');
          setActivePageId(current.pageId);
          setInlineEditor({
            pageId: current.pageId,
            blockId,
            text: NEW_TEXT_BLOCK_PLACEHOLDER,
            focusMode: 'select-all',
          });
          setDirty(true);
          setToolMode('select');
          return null;
        });
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      return;
    }

    // ── Region tool: draw rectangle to select region for flipping ──
    if (toolMode === 'region') {
      event.preventDefault();
      setRegionSelection(null);
      const stageEl = pageStageRefs.current[pageId];
      if (!stageEl) return;
      const rect = stageEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setRegionDrag({ pageId, startX: x, startY: y, currentX: x, currentY: y });

      const handleMove = (e: PointerEvent) => {
        setRegionDrag((prev) => prev ? { ...prev, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top } : null);
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        setRegionDrag((current) => {
          if (!current) return null;
          const page = pageCache[current.pageId];
          if (!page) return null;
          const scale = previewScaleForPage(current.pageId, page);
          const x0 = Math.min(current.startX, current.currentX) / scale;
          const y0 = Math.min(current.startY, current.currentY) / scale;
          const x1 = Math.max(current.startX, current.currentX) / scale;
          const y1 = Math.max(current.startY, current.currentY) / scale;
          if ((x1 - x0) < 10 || (y1 - y0) < 10) return null;
          setRegionSelection({ pageId: current.pageId, bbox: [x0, y0, x1, y1] });
          return null;
        });
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      return;
    }

    // ── Select tool: lasso selection ──
    if (toolMode !== 'select') return;
    if (inlineEditor) commitInlineEditor();
    event.preventDefault();

    const stageEl = pageStageRefs.current[pageId];
    if (!stageEl) { clearSelection(); return; }
    const rect = stageEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setLasso({ pageId, startX: x, startY: y, currentX: x, currentY: y });
    clearSelection();
    setActivePageId(pageId);

    const handleMove = (e: PointerEvent) => {
      setLasso((prev) => prev ? { ...prev, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top } : null);
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setLasso((current) => {
        if (!current) return null;
        const page = pageCache[current.pageId];
        if (!page) return null;
        const scale = previewScaleForPage(current.pageId, page);
        const lx0 = Math.min(current.startX, current.currentX) / scale;
        const ly0 = Math.min(current.startY, current.currentY) / scale;
        const lx1 = Math.max(current.startX, current.currentX) / scale;
        const ly1 = Math.max(current.startY, current.currentY) / scale;
        if ((lx1 - lx0) * scale > 5 && (ly1 - ly0) * scale > 5) {
          const intersecting = page.blocks
            .filter((b) => {
              const [bx0, by0, bx1, by1] = b.bbox;
              return bx0 < lx1 && bx1 > lx0 && by0 < ly1 && by1 > ly0;
            })
            .map((b) => b.source_block_id);
          if (intersecting.length > 0) {
            setSelectedBlockIds(intersecting);
          }
        }
        return null;
      });
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function handleRegionFlip() {
    if (!regionSelection) return;
    const { pageId, bbox } = regionSelection;
    const page = pageCache[pageId];
    if (!page) return;
    const pageWidth = Number(page.page_size_pt?.[0]) || 0;
    const sourceBbox = editorGraphicBboxToSource(pageWidth, bbox, mirrorEnabled);
    if (!sourceBbox) return;
    snapshotPageForUndo(pageId);
    const regionId = `user-region-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPageCache((current) => {
      const currentPage = current[pageId];
      if (!currentPage) return current;
      const newRegion = {
        region_id: regionId,
        flipped: true,
        bbox: sourceBbox,
      };
      return { ...current, [pageId]: { ...currentPage, graphic_regions: [...currentPage.graphic_regions, newRegion] } };
    });
    setRegionSelection(null);
    setToolMode('select');
    setSelectedGraphicRegionId(regionId);
    setDirty(true);
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>, pageId: number, blockId: string) {
    if (toolMode !== 'select') return;
    const page = pageCache[pageId];
    if (!page) return;
    if (event.button !== 0) return;
    if (inlineEditor) {
      commitInlineEditor();
    }
    event.preventDefault();
    event.stopPropagation();
    setActivePageId(pageId);
    snapshotPageForUndo(pageId);
    const localPageWidth = Number(page.page_size_pt?.[0]) || 1;
    const localPageHeight = Number(page.page_size_pt?.[1]) || 1;
    const localPreviewScale = previewScaleForPage(pageId, page);

    const pageIndex = blockPageIndex(pageCache);
    const blockPageId = pageIndex.get(blockId) ?? pageId;
    const multi = isMultiSelectModifier(event);
    const nextSelection = computeDragSelection(selectedBlockIds, blockId, multi, blockPageId, pageIndex);
    setSelectedBlockIds(nextSelection);
    setSelectedGraphicRegionId('');

    const selectedSet = new Set(nextSelection);
    const originById = new Map<string, number[]>();
    for (const block of page.blocks) {
      if (selectedSet.has(block.source_block_id)) {
        originById.set(block.source_block_id, [...block.bbox]);
      }
    }

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    let moved = false;

    const handleMove = (nextEvent: PointerEvent) => {
      const dx = (nextEvent.clientX - startClientX) / Math.max(0.001, localPreviewScale);
      const dy = (nextEvent.clientY - startClientY) / Math.max(0.001, localPreviewScale);
      if (!moved && (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25)) {
        moved = true;
      }
      setPageCache((current) => {
        const currentPage = current[pageId];
        if (!currentPage) return current;
        const nextBlocks = currentPage.blocks.map((block) => {
          const origin = originById.get(block.source_block_id);
          if (!origin) return block;
          const movedBlock = {
            ...block,
            bbox: clampMovedBbox(origin, dx, dy, localPageWidth, localPageHeight),
          } as PageBlock & Record<string, unknown>;
          movedBlock.bbox_edited = true;
          return clearStoredDrawPlan(movedBlock) as PageBlock;
        });
        return { ...current, [pageId]: { ...currentPage, blocks: nextBlocks } };
      });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      if (moved) {
        setPageCache((current) => {
          const currentPage = current[pageId];
          if (!currentPage) return current;
          return {
            ...current,
            [pageId]: recomputePageWarnings(currentPage),
          };
        });
        setDirty(true);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>, pageId: number, blockId: string, corner: 'tl' | 'tr' | 'bl' | 'br' = 'br') {
    if (toolMode !== 'select') return;
    const page = pageCache[pageId];
    if (!page) return;
    if (event.button !== 0) return;
    if (inlineEditor) {
      commitInlineEditor();
    }
    event.preventDefault();
    event.stopPropagation();
    setActivePageId(pageId);
    snapshotPageForUndo(pageId);
    setSelectedBlockIds([blockId]);
    setSelectedGraphicRegionId('');
    const localPageWidth = Number(page.page_size_pt?.[0]) || 1;
    const localPageHeight = Number(page.page_size_pt?.[1]) || 1;
    const localPreviewScale = previewScaleForPage(pageId, page);

    const block = page.blocks.find((item) => item.source_block_id === blockId);
    if (!block) return;
    const origin = [...block.bbox];
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    let moved = false;

    const handleMove = (nextEvent: PointerEvent) => {
      const dx = (nextEvent.clientX - startClientX) / Math.max(0.001, localPreviewScale);
      const dy = (nextEvent.clientY - startClientY) / Math.max(0.001, localPreviewScale);
      if (!moved && (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25)) {
        moved = true;
      }
      setPageCache((current) => {
        const currentPage = current[pageId];
        if (!currentPage) return current;
        const nextBlocks = currentPage.blocks.map((item) => {
          if (item.source_block_id !== blockId) return item;
          const minSize = 10;
          let nx0 = Number(origin[0]) || 0;
          let ny0 = Number(origin[1]) || 0;
          let nx1 = Number(origin[2]) || nx0 + 1;
          let ny1 = Number(origin[3]) || ny0 + 1;
          if (corner === 'br') {
            nx1 = clamp(nx1 + dx, nx0 + minSize, localPageWidth);
            ny1 = clamp(ny1 + dy, ny0 + minSize, localPageHeight);
          } else if (corner === 'tl') {
            nx0 = clamp(nx0 + dx, 0, nx1 - minSize);
            ny0 = clamp(ny0 + dy, 0, ny1 - minSize);
          } else if (corner === 'tr') {
            nx1 = clamp(nx1 + dx, nx0 + minSize, localPageWidth);
            ny0 = clamp(ny0 + dy, 0, ny1 - minSize);
          } else if (corner === 'bl') {
            nx0 = clamp(nx0 + dx, 0, nx1 - minSize);
            ny1 = clamp(ny1 + dy, ny0 + minSize, localPageHeight);
          }
          const resizedBlock = {
            ...item,
            bbox: [nx0, ny0, nx1, ny1],
          } as PageBlock & Record<string, unknown>;
          resizedBlock.bbox_edited = true;
          return clearStoredDrawPlan(resizedBlock) as PageBlock;
        });
        return { ...current, [pageId]: { ...currentPage, blocks: nextBlocks } };
      });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      if (moved) {
        setPageCache((current) => {
          const currentPage = current[pageId];
          if (!currentPage) return current;
          const nextBlocks = currentPage.blocks.map((item) => {
            if (item.source_block_id !== blockId) return item;
            const nextBlock = { ...item } as PageBlock & Record<string, unknown>;
            const fit = fitEditableBlockToBBox(nextBlock, {
              maxFontSize: Number(nextBlock.font_size) || null,
            });
            if (Number.isFinite(fit.fontSize) && fit.fontSize > 0) {
              nextBlock.font_size = Math.round(fit.fontSize * 100) / 100;
              nextBlock.line_height = Math.round(fit.lineHeight * 100) / 100;
              nextBlock.overflow = Boolean(fit.overflow);
            }
            return clearStoredDrawPlan(nextBlock) as PageBlock;
          });
          return {
            ...current,
            [pageId]: recomputePageWarnings({
              ...currentPage,
              blocks: nextBlocks,
            }),
          };
        });
        setDirty(true);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function startGraphicDrag(event: React.PointerEvent<HTMLDivElement>, pageId: number, regionId: string) {
    const page = pageCache[pageId];
    if (!page) return;
    if (event.button !== 0) return;
    if (inlineEditor) {
      commitInlineEditor();
    }
    event.preventDefault();
    event.stopPropagation();
    setActivePageId(pageId);
    setSelectedGraphicRegionId(regionId);
    setSelectedBlockIds([]);
    setInlineEditor(null);
    const localPageWidth = Number(page.page_size_pt?.[0]) || 1;
    const localPageHeight = Number(page.page_size_pt?.[1]) || 1;
    const localPreviewScale = previewScaleForPage(pageId, page);

    const region = page.graphic_regions.find((item) => item.region_id === regionId);
    if (!region) return;
    const sourceBbox = Array.isArray(region.bbox) ? region.bbox.map((value) => Number(value)) : [];
    const mirrored = sourceBbox.length === 4
      ? (sourceGraphicBboxToEditor(localPageWidth, sourceBbox, mirrorEnabled) || [])
      : [];
    const base = Array.isArray(region.moved_bbox) ? [...region.moved_bbox] : mirrored;
    if (base.length !== 4) return;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    let moved = false;

    const handleMove = (nextEvent: PointerEvent) => {
      const dx = (nextEvent.clientX - startClientX) / Math.max(0.001, localPreviewScale);
      const dy = (nextEvent.clientY - startClientY) / Math.max(0.001, localPreviewScale);
      if (!moved && (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25)) {
        moved = true;
      }
      setPageCache((current) => {
        const currentPage = current[pageId];
        if (!currentPage) return current;
        const nextRegions = currentPage.graphic_regions.map((item) => {
          if (item.region_id !== regionId) return item;
          const movedBbox = clampMovedBbox(base, dx, dy, localPageWidth, localPageHeight);
          return { ...item, moved_bbox: movedBbox };
        });
        return { ...current, [pageId]: { ...currentPage, graphic_regions: nextRegions } };
      });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      if (moved) {
        setDirty(true);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function onGraphicPointerDown(event: React.PointerEvent<HTMLDivElement>, pageId: number, regionId: string) {
    const page = pageCache[pageId];
    if (!page) return;
    if (event.button !== 0) return;
    if (inlineEditor) {
      commitInlineEditor();
    }
    event.preventDefault();
    event.stopPropagation();
    setActivePageId(pageId);
    setSelectedBlockIds([]);
    setInlineEditor(null);
    setSelectedGraphicRegionId(regionId);

    const now = Date.now();
    const lastClick = graphicClickTimesRef.current[regionId] || 0;
    graphicClickTimesRef.current[regionId] = now;
    if (now - lastClick < 400) {
      setPageCache((current) => {
        const currentPage = current[pageId];
        if (!currentPage) return current;
        const nextRegions = currentPage.graphic_regions.map((region) => (
          region.region_id === regionId
            ? { ...region, flipped: !Boolean(region.flipped) }
            : region
        ));
        return { ...current, [pageId]: { ...currentPage, graphic_regions: nextRegions } };
      });
      setSelectedGraphicRegionId('');
      setDirty(true);
      return;
    }

    startGraphicDrag(event, pageId, regionId);
  }

  function toggleGraphicFlip(regionId: string, pageId: number) {
    const page = pageCache[pageId];
    if (!page) return;
    snapshotPageForUndo(pageId);
    const nextRegions = page.graphic_regions.map((region) => {
      if (region.region_id !== regionId) return region;
      return { ...region, flipped: !Boolean(region.flipped) };
    });
    setPageCache((current) => ({
      ...current,
      [pageId]: { ...page, graphic_regions: nextRegions },
    }));
    setActivePageId(pageId);
    setSelectedGraphicRegionId(regionId);
    setDirty(true);
  }

  function resetGraphicMove(regionId: string, pageId: number) {
    const page = pageCache[pageId];
    if (!page) return;
    snapshotPageForUndo(pageId);
    const nextRegions = page.graphic_regions.map((region) => {
      if (region.region_id !== regionId) return region;
      const next = { ...region };
      delete next.moved_bbox;
      return next;
    });
    setPageCache((current) => ({
      ...current,
      [pageId]: { ...page, graphic_regions: nextRegions },
    }));
    setActivePageId(pageId);
    setDirty(true);
  }

  function openInlineEditor(pageId: number, blockId: string) {
    const page = pageCache[pageId];
    if (!page) return;
    const block = page.blocks.find((item) => item.source_block_id === blockId);
    if (!block) return;
    setActivePageId(pageId);
    setSelectedBlockIds([blockId]);
    setSelectedGraphicRegionId('');
    const nextText = String(block.text || '');
    setInlineEditor({
      pageId,
      blockId,
      text: nextText,
      focusMode: nextText === NEW_TEXT_BLOCK_PLACEHOLDER ? 'select-all' : 'cursor-end',
    });
  }

  function commitInlineEditor() {
    if (!inlineEditor) return;
    const page = pageCache[inlineEditor.pageId];
    if (!page) return;
    const block = page.blocks.find((item) => item.source_block_id === inlineEditor.blockId);
    if (!block) {
      setInlineEditor(null);
      return;
    }
    if (String(block.text || '') !== inlineEditor.text) {
      snapshotPageForUndo(inlineEditor.pageId);
      const nextBlocks = page.blocks.map((item) => (
        item.source_block_id === inlineEditor.blockId
          ? (clearStoredDrawPlan({ ...item, text: inlineEditor.text }) as PageBlock)
          : item
      ));
      replacePageBlocks(page.page_id, nextBlocks, { recomputeWarnings: true });
      setDirty(true);
    }
    setInlineEditor(null);
  }

  function cancelInlineEditor() {
    setInlineEditor(null);
  }

  useLayoutEffect(() => {
    if (!inlineEditor?.focusMode) return;
    let frame = 0;
    let timeout = 0;
    const applyFocus = () => {
      const textarea = inlineEditorTextareaRef.current;
      if (!textarea) return false;
      textarea.focus({ preventScroll: true });
      const textLength = textarea.value.length;
      if (inlineEditor.focusMode === 'select-all') {
        textarea.setSelectionRange(0, textLength);
      } else {
        textarea.setSelectionRange(textLength, textLength);
      }
      return document.activeElement === textarea;
    };
    const finalize = () => {
      setInlineEditor((current) => {
        if (!current) return current;
        if (current.pageId !== inlineEditor.pageId || current.blockId !== inlineEditor.blockId) {
          return current;
        }
        return { ...current, focusMode: undefined };
      });
    };
    frame = window.requestAnimationFrame(() => {
      if (applyFocus()) {
        finalize();
        return;
      }
      timeout = window.setTimeout(() => {
        applyFocus();
        finalize();
      }, 30);
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [inlineEditor]);

  function buildSnapshotPayload(pages: PagePayload[], documentId: string): SnapshotRequest {
    return {
      document_id: documentId,
      version: 1,
      pages: pages.map((page) => ({
        page_id: page.page_id,
          blocks: page.blocks.map((block) => ({
            source_block_id: String(block.source_block_id || ''),
            text: String(block.text || ''),
            bbox: (Array.isArray(block.bbox) ? block.bbox : [0, 0, 1, 1]).map((value) => Number(value)),
            font_size: Number(block.font_size) || 10,
            line_height: Number(block.line_height) || undefined,
            alignment: String(block.alignment || 'left'),
            alignment_edited: Boolean(block.alignment_edited),
            font_family: String(block.font_family || 'sans-serif'),
            font_weight: String(block.font_weight || 'normal'),
            wrap_mode: wrapModeForBlock(block as unknown as Record<string, unknown>),
            clip_mode: String(block.clip_mode || 'auto'),
        })),
        graphic_regions: page.graphic_regions.map((region) => {
          const sourceBbox = Array.isArray(region.bbox) && region.bbox.length === 4
            ? region.bbox.map((value) => Number(value))
            : undefined;
          const entry: { region_id: string; flipped?: boolean; bbox?: number[]; source_bbox?: number[] } = {
            region_id: String(region.region_id || ''),
          };
          if (region.flipped) entry.flipped = true;
          if (sourceBbox) entry.source_bbox = sourceBbox;
          if (Array.isArray(region.moved_bbox) && region.moved_bbox.length === 4) {
            entry.bbox = region.moved_bbox.map((value) => Number(value));
          }
          return entry;
        }).filter((region) => Boolean(region.flipped) || Array.isArray(region.bbox) || Array.isArray(region.source_bbox)),
      })),
    };
  }

  function applyCanonicalPages(payload: RenderSnapshotResponse) {
    if (!Array.isArray(payload.pages)) return;
    const nextCache: Record<number, PagePayload> = {};
    const nextBaselineByPage: Record<number, Record<string, GraphicBaselineEdit>> = {};
    for (const page of payload.pages) {
      nextCache[page.page_id] = page;
      const byRegion: Record<string, GraphicBaselineEdit> = {};
      for (const region of page.graphic_regions) {
        const entry: GraphicBaselineEdit = {};
        if (Boolean(region.flipped)) {
          entry.flipped = true;
        }
        if (Array.isArray(region.moved_bbox) && region.moved_bbox.length === 4) {
          entry.bbox = region.moved_bbox.map((value) => Number(value));
        }
        if (entry.flipped || entry.bbox) {
          byRegion[String(region.region_id)] = entry;
        }
      }
      nextBaselineByPage[page.page_id] = byRegion;
    }
    setPageCache(nextCache);
    setSelectedBlockIds((current) => normalizeSelectionOrder(current, nextCache));
    setGraphicBaselineByPage((current) => ({ ...current, ...nextBaselineByPage }));
    onSessionUpdate({
      ...session,
      has_unsaved_local_edits: false,
      edited_pdf_url: payload.edited_pdf_url,
      validation_report: payload.validation_report,
    });
  }

  async function onRenderSnapshot(): Promise<RenderSnapshotResponse | null> {
    if (inlineEditor) {
      commitInlineEditor();
    }
    if (!dirty) {
      setStatus('No local edits to render.');
      return null;
    }

    setBusy(true);
    setError('');
    setStatus('Rendering snapshot...');
    try {
      const pages = await Promise.all(
        session.page_ids.map((pageId) => ensurePageLoaded(pageId)),
      );
      const snapshot = buildSnapshotPayload(pages, session.document_id);
      const result = await runtime.renderSnapshot(session, snapshot);
      applyCanonicalPages(result);
      setDirty(false);
      setPreviewRevision((value) => value + 1);
      setStatus('Snapshot rendered.');
      return result;
    } catch (nextError) {
      setError(String(nextError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function triggerBrowserDownload(url: string, fileName?: string) {
    const anchor = document.createElement('a');
    anchor.href = url;
    if (fileName) {
      anchor.download = fileName;
    }
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function onRenderAndDownload() {
    if (!dirty) {
      if (runtime.downloadPdf) {
        try {
          const download = await runtime.downloadPdf(session);
          if (download?.url) {
            triggerBrowserDownload(download.url, download.fileName);
            setStatus('PDF downloaded.');
          } else {
            setStatus('PDF download is not available for browser-local sessions yet.');
          }
        } catch (nextError) {
          setError(String(nextError));
        }
      } else {
        setStatus('PDF download is not available for browser-local sessions yet.');
      }
      return;
    }
    const result = await onRenderSnapshot();
    if (runtime.downloadPdf) {
      try {
        const download = await runtime.downloadPdf(session);
        if (download?.url) {
          triggerBrowserDownload(download.url, download.fileName);
          setStatus('PDF downloaded.');
        } else {
          setStatus('PDF download is not available for browser-local sessions yet.');
        }
      } catch (nextError) {
        setError(String(nextError));
      }
      return;
    }
    void result;
    setStatus('PDF download is not available for browser-local sessions yet.');
  }

  async function onReloadPage() {
    setBusy(true);
    setError('');
    setStatus('Reloading canvas...');
    try {
      const payloads = await Promise.all(
        session.page_ids.map((pageId) => runtime.fetchPage(session, pageId)),
      );
      setPageCache((current) => {
        const next = { ...current };
        for (const payload of payloads) {
          next[payload.page_id] = payload;
        }
        return next;
      });
      for (const payload of payloads) {
        captureGraphicBaselineFromPage(payload);
      }
      setPreviewRevision((value) => value + 1);
      setStatus('Canvas reloaded.');
      setSelectedBlockIds([]);
      setSelectedGraphicRegionId('');
      setInlineEditor(null);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  }

  // ---- Render ----

  const hasSelection = selectedBlockIds.length > 0 || !!selectedGraphicRegionId;
  const activeExtractionWarning = activePage?.extraction_warning || null;
  const openingNotice = String(session.opening_notice || '').trim();
  const editorNotices = buildEditorExtractionNotices({
    openingNotice,
    activePageId,
    activeExtractionWarning,
  });
  const handleVersionSelect = (nextVersionId: string) => {
    if (!versionSwitcher || nextVersionId === versionSwitcher.activeId) {
      return;
    }
    if (inlineEditor) {
      commitInlineEditor();
    }
    versionSwitcher.onSelect(nextVersionId);
  };

  return (
    <div className="editor-view">
      <header className={`app-bar${versionSwitcher ? ' app-bar--with-versions' : ''}`}>
        <button className="btn-ghost" type="button" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{marginRight: 4}}><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Home
        </button>
        <span className="app-bar-brand">Lingadoo</span>
        <div className="app-bar-center">
          <span className="app-bar-title">{session.source_pdf_name}</span>
          {versionSwitcher ? (
            <div className="editor-version-switcher">
              <div className="editor-version-tabs" role="tablist" aria-label="Document versions">
                {versionSwitcher.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={option.id === versionSwitcher.activeId}
                    className={`editor-version-tab${option.id === versionSwitcher.activeId ? ' editor-version-tab--active' : ''}`}
                    onClick={() => handleVersionSelect(option.id)}
                  >
                    <span>{option.label}</span>
                    {option.recommended ? <span className="editor-version-badge">Recommended</span> : null}
                  </button>
                ))}
              </div>
              {versionSwitcher.note ? (
                <span className="editor-version-note">{versionSwitcher.note}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="app-bar-actions">
          {sourceUrl ? (
            <a className="app-bar-source-link" href={sourceUrl} target="_blank" rel="noreferrer">Source</a>
          ) : null}
          <button
            className="btn-primary"
            type="button"
            onClick={() => void onRenderAndDownload()}
            disabled={busy || !runtime.downloadPdf}
            title={runtime.downloadPdf ? undefined : 'PDF download is not available for browser-local sessions yet.'}
          >
            Download PDF
          </button>
        </div>
      </header>
      <EditorToolbar
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        canUndo={undoStack.canUndo()}
        canRedo={undoStack.canRedo()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        hasTextSelection={hasBlockSelection}
        fontSizeValue={toolbarFontSizeValue}
        fontSizePlaceholder={toolbarFontSizePlaceholder}
        onFontSizeStep={handleFontSizeStep}
        onFontSizeCommit={handleFontSizeCommit}
        onAutoFit={handleAutoFit}
        selectedWeight={toolbarWeight === 'bold' || toolbarWeight === 'normal' ? toolbarWeight : ''}
        onWeightChange={updateSelectedWeight}
        selectedAlignment={toolbarAlignment}
        onAlignmentChange={handleToolbarAlignmentChange}
        selectedWrapMode={toolbarWrapMode === 'word' || toolbarWrapMode === 'none' ? toolbarWrapMode : ''}
        onWrapModeChange={updateSelectedWrapMode}
      />
      <div className="editor-body">
        <aside className="editor-sidebar">
          <div className="sidebar-header">Pages · {session.page_ids.length}</div>
          {session.page_ids.map((pageId) => {
            const thumbSrc = (runtime.thumbnailUrl?.(session, pageId, 144, previewRevision))
              || runtime.previewUrl(session, pageId, 144, previewRevision);
            const pageWarning = Boolean(pageCache[pageId]?.extraction_warning?.suspicious);
            return (
              <button
                key={pageId}
                ref={el => { thumbRefs.current[pageId] = el; }}
                className={`page-thumb${pageId === activePageId ? ' active' : ''}${pageWarning ? ' warning' : ''}`}
                onClick={() => scrollPageIntoView(pageId)}
                type="button"
                title={pageWarning ? buildExtractionWarningSummary(pageId, pageCache[pageId]?.extraction_warning || null) : `Page ${pageId}`}
              >
                <img
                  src={thumbSrc}
                  alt={`Page ${pageId}`}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setOriginalPreviewSizesByPage((current) => ({
                      ...current,
                      [pageId]: {
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      },
                    }));
                  }}
                  onPointerEnter={(event) => updateThumbnailLoupe(pageId, thumbSrc, event)}
                  onPointerMove={(event) => updateThumbnailLoupe(pageId, thumbSrc, event)}
                  onPointerLeave={clearThumbnailLoupe}
                />
                <span className="page-thumb-number">{pageId}</span>
                {pageWarning ? (
                  <span className="page-thumb-warning" aria-hidden="true">!</span>
                ) : null}
              </button>
            );
          })}
        </aside>

        <div className="editor-main">
          {editorNotices.length ? (
            <div className="editor-notices" role="status" aria-live="polite">
              {editorNotices.map((notice) => (
                <div key={notice.key} className={`editor-notice ${notice.tone}`}>
                  {notice.message}
                </div>
              ))}
            </div>
          ) : null}

          <main
            ref={canvasRef}
            className={`editor-canvas${toolMode !== 'select' ? ' cursor-crosshair' : ''}`}
            onScroll={() => scheduleViewportSync()}
            onPointerDown={(event) => {
              clearCanvasBlockLoupe();
              if (event.target === event.currentTarget) {
                if (inlineEditor) {
                  commitInlineEditor();
                }
                clearSelection();
              }
            }}
          >
            {error ? <p style={{ color: 'var(--danger)', padding: '8px' }}>{error}</p> : null}

            <div
              className="preview-pages"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  if (inlineEditor) {
                    commitInlineEditor();
                  }
                  clearSelection();
                }
              }}
            >
              {session.page_ids.map((pageId) => {
                const page = pageCache[pageId] || null;
                if (!page) {
                  return (
                    <div
                      key={`page-loading-${pageId}`}
                      ref={(el) => { pageStageRefs.current[pageId] = el; }}
                      className="preview-stage preview-loading"
                    >
                      <p style={{ color: 'var(--ink-muted)' }}>Loading page {pageId}...</p>
                    </div>
                  );
                }

                const pageWidthPt = Number(page.page_size_pt?.[0]) || 1;
                const pageScale = previewScaleForPage(pageId, page);
                const pageBaseline = graphicBaselineByPage[page.page_id] || {};
                const previewSrc = runtime.previewUrl(session, pageId, 144, previewRevision);
                const previewSize = previewSizesByPage[pageId] || { width: 0, height: 0 };
                const inlineBlock = inlineEditor?.pageId === pageId
                  ? page.blocks.find((item) => item.source_block_id === inlineEditor.blockId)
                  : null;
                const pageTightBBoxOverlayEntries = tightBBoxOverlay && page.page_id === activePageId
                  ? page.blocks.flatMap((block) => {
                      const proposal = proposeTightTextBBox(block as PageBlock & Record<string, unknown>);
                      if (!proposal || !bboxesDiffer(block.bbox as number[], proposal)) {
                        return [];
                      }
                      return [{
                        blockId: block.source_block_id,
                        original: block.bbox.map((value) => Number(value)),
                        proposal,
                      }];
                    })
                  : [];
                const graphicPreviewLayers = page.graphic_regions.flatMap((region) => {
                const regionId = String(region.region_id || '');
                const sourceBbox = Array.isArray(region.bbox) && region.bbox.length === 4
                  ? region.bbox.map((value) => Number(value))
                  : null;
                if (!sourceBbox) return [];
                const mirroredBbox = sourceGraphicBboxToEditor(pageWidthPt, sourceBbox, mirrorEnabled) || sourceBbox;
                const baseline = pageBaseline[regionId] || {};
                const currentBbox = Array.isArray(region.moved_bbox) && region.moved_bbox.length === 4
                  ? region.moved_bbox.map((value) => Number(value))
                  : mirroredBbox;
                const bakedBbox = Array.isArray(baseline.bbox) && baseline.bbox.length === 4
                  ? baseline.bbox.map((value) => Number(value))
                  : mirroredBbox;
                const needsMove = (
                  Math.abs(bakedBbox[0] - currentBbox[0]) > 0.01
                  || Math.abs(bakedBbox[1] - currentBbox[1]) > 0.01
                  || Math.abs(bakedBbox[2] - currentBbox[2]) > 0.01
                  || Math.abs(bakedBbox[3] - currentBbox[3]) > 0.01
                );
                const currentFlipped = Boolean(region.flipped);
                const bakedFlipped = Boolean(baseline.flipped);
                const needsFlip = currentFlipped !== bakedFlipped;
                if (!needsMove && !needsFlip) return [];
                const left = currentBbox[0] * pageScale;
                const top = currentBbox[1] * pageScale;
                const width = Math.max(1, (currentBbox[2] - currentBbox[0]) * pageScale);
                const height = Math.max(1, (currentBbox[3] - currentBbox[1]) * pageScale);
                const sourceLeft = bakedBbox[0] * pageScale;
                const sourceTop = bakedBbox[1] * pageScale;
                const cover = needsMove
                  ? {
                      left: bakedBbox[0] * pageScale,
                      top: bakedBbox[1] * pageScale,
                      width: Math.max(1, (bakedBbox[2] - bakedBbox[0]) * pageScale),
                      height: Math.max(1, (bakedBbox[3] - bakedBbox[1]) * pageScale),
                    }
                  : null;
                return [{
                  regionId,
                  left,
                  top,
                  width,
                  height,
                  sourceLeft,
                  sourceTop,
                  flipped: needsFlip,
                  cover,
                }];
              });

                return (
                  <div
                    key={`page-stage-${pageId}`}
                    ref={(el) => { pageStageRefs.current[pageId] = el; }}
                    data-page-id={pageId}
                    className={`preview-stage${pageId === activePageId ? ' active-page' : ''}`}
                  >
                  <img
                    className="preview-image"
                    src={previewSrc}
                    alt={`Canvas preview page ${pageId}`}
                    onLoad={(event) => {
                      const img = event.currentTarget;
                      setPreviewSizesByPage((current) => ({
                      ...current,
                      [pageId]: {
                        width: img.clientWidth,
                        height: img.clientHeight,
                      },
                    }));
                  }}
                />
                <div
                  className="overlay-layer"
                  style={{ width: '100%', height: '100%' }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                      handleOverlayPointerDown(event, pageId);
                    }
                  }}
                >
                  {graphicPreviewLayers.map((entry) => (
                    <div key={`graphic-preview-${pageId}-${entry.regionId}`}>
                      {entry.cover ? (
                        <div
                          className="graphic-preview-cover"
                          style={{
                            left: entry.cover.left,
                            top: entry.cover.top,
                            width: entry.cover.width,
                            height: entry.cover.height,
                          }}
                        />
                      ) : null}
                      <div
                        className={`graphic-preview${entry.flipped ? ' flipped' : ''}`}
                        style={{
                          left: entry.left,
                          top: entry.top,
                          width: entry.width,
                          height: entry.height,
                          backgroundImage: `url("${previewSrc}")`,
                          backgroundSize: `${previewSize.width}px ${previewSize.height}px`,
                          backgroundPosition: `-${entry.sourceLeft}px -${entry.sourceTop}px`,
                        }}
                      />
                    </div>
                  ))}

                  {(page.tables as Array<Record<string, unknown>>).map((component) => {
                    const componentId = String(component.component_id || '');
                    const cells = Array.isArray(component.cells) ? component.cells : [];
                    const borders = Array.isArray(component.borders) ? component.borders : [];
                    return (
                      <div key={`table-${pageId}-${componentId}`} className="table-layer">
                        {cells.map((rawCell, index) => {
                          const cell = rawCell as Record<string, unknown>;
                          if (!Boolean(cell.fill_enabled)) return null;
                          const bbox = Array.isArray(cell.bbox) ? cell.bbox.map((part) => Number(part)) : null;
                          if (!bbox || bbox.length !== 4) return null;
                          const x0 = Number(bbox[0]) || 0;
                          const y0 = Number(bbox[1]) || 0;
                          const x1 = Number(bbox[2]) || x0 + 1;
                          const y1 = Number(bbox[3]) || y0 + 1;
                          return (
                            <div
                              key={`cell-${pageId}-${componentId}-${index}`}
                              className="table-cell-fill"
                              style={{
                                left: x0 * pageScale,
                                top: y0 * pageScale,
                                width: Math.max(0, (x1 - x0) * pageScale),
                                height: Math.max(0, (y1 - y0) * pageScale),
                                background: rgbFromFloatTriplet(cell.fill_color),
                              }}
                            />
                          );
                        })}

                        {borders.map((rawBorder, index) => {
                          const border = rawBorder as Record<string, unknown>;
                          const start = Array.isArray(border.start) ? border.start.map((part) => Number(part)) : null;
                          const end = Array.isArray(border.end) ? border.end.map((part) => Number(part)) : null;
                          if (!start || !end || start.length < 2 || end.length < 2) return null;
                          const x0 = start[0];
                          const y0 = start[1];
                          const x1 = end[0];
                          const y1 = end[1];
                          const widthPt = Math.max(0.35, Number(border.width) || 0.6);
                          const scaledStroke = Math.max(1, widthPt * pageScale);
                          const orientation = String(border.orientation || 'horizontal');
                          const style: CSSProperties = {
                            background: rgbFromFloatTriplet(border.color),
                          };
                          if (orientation === 'vertical') {
                            const top = Math.min(y0, y1);
                            const height = Math.max(0.5, Math.abs(y1 - y0));
                            style.left = (x0 * pageScale) - (scaledStroke / 2);
                            style.top = top * pageScale;
                            style.width = scaledStroke;
                            style.height = height * pageScale;
                          } else {
                            const left = Math.min(x0, x1);
                            const width = Math.max(0.5, Math.abs(x1 - x0));
                            style.left = left * pageScale;
                            style.top = (y0 * pageScale) - (scaledStroke / 2);
                            style.width = width * pageScale;
                            style.height = scaledStroke;
                          }
                          return (
                            <div
                              key={`border-${pageId}-${componentId}-${index}`}
                              className="table-border-line"
                              style={style}
                            />
                          );
                        })}
                      </div>
                    );
                  })}

                  {page.graphic_regions.map((region) => {
                    const sourceBbox = Array.isArray(region.bbox) && region.bbox.length === 4
                      ? region.bbox.map((value) => Number(value))
                      : null;
                    if (!sourceBbox) return null;
                    const mirroredBbox = sourceGraphicBboxToEditor(pageWidthPt, sourceBbox, mirrorEnabled) || sourceBbox;
                    const bboxRaw = Array.isArray(region.moved_bbox) && region.moved_bbox.length === 4
                      ? region.moved_bbox
                      : mirroredBbox;
                    if (!Array.isArray(bboxRaw) || bboxRaw.length !== 4) return null;
                    const x0 = Number(bboxRaw[0]) || 0;
                    const y0 = Number(bboxRaw[1]) || 0;
                    const x1 = Number(bboxRaw[2]) || x0 + 1;
                    const y1 = Number(bboxRaw[3]) || y0 + 1;
                    return (
                      <div
                        key={`graphic-${pageId}-${region.region_id}`}
                        className={`graphic-region${region.flipped ? ' flipped' : ''}${selectedGraphicRegionId === region.region_id ? ' selected' : ''}`}
                        style={{
                          left: x0 * pageScale,
                          top: y0 * pageScale,
                          width: Math.max(1, (x1 - x0) * pageScale),
                          height: Math.max(1, (y1 - y0) * pageScale),
                        }}
                        title={`${region.region_id}${region.flipped ? ' (flipped)' : ''}`}
                        onPointerDown={(event) => onGraphicPointerDown(event, pageId, region.region_id)}
                      />
                    );
                  })}

                  {nudgeOverlay && (page.logo_regions || []).map((region) => {
                    const bboxRaw = Array.isArray(region.bbox) && region.bbox.length === 4
                      ? region.bbox
                      : null;
                    if (!bboxRaw) return null;
                    const x0 = Number(bboxRaw[0]) || 0;
                    const y0 = Number(bboxRaw[1]) || 0;
                    const x1 = Number(bboxRaw[2]) || x0 + 1;
                    const y1 = Number(bboxRaw[3]) || y0 + 1;
                    return (
                      <div
                        key={`logo-debug-${pageId}-${region.logo_id}`}
                        className="logo-debug-region"
                        style={{
                          left: x0 * pageScale,
                          top: y0 * pageScale,
                          width: Math.max(1, (x1 - x0) * pageScale),
                          height: Math.max(1, (y1 - y0) * pageScale),
                        }}
                        title={`${region.logo_id}${region.source_kind ? ` (${region.source_kind})` : ''}`}
                      />
                    );
                  })}

                  {page.blocks.map((block) => {
                    if (skipSingleCharBlocks && String(block.text || '').length <= 1) {
                      return null;
                    }
                    const selected = selectedBlockIds.includes(block.source_block_id);
                    const blockAny = block as PageBlock & Record<string, unknown>;
                    const drawPlan = (blockAny.draw_plan && typeof blockAny.draw_plan === 'object')
                      ? blockAny.draw_plan as Record<string, unknown>
                      : ((blockAny.drawPlan && typeof blockAny.drawPlan === 'object')
                        ? blockAny.drawPlan as Record<string, unknown>
                        : null);
                    const localDraw = drawPlan ? null : rebuildLocalDrawPlan(blockAny);
                    const effectiveDrawPlan = drawPlan || localDraw?.drawPlan || null;
                    const drawLines = Array.isArray(effectiveDrawPlan?.lines)
                      ? effectiveDrawPlan.lines as Array<Record<string, unknown>>
                      : [];
                    const drawFontSize = Number(effectiveDrawPlan?.font_size);
                    const drawLineHeight = Number(effectiveDrawPlan?.line_height);
                    const blockFontSize = Number(block.font_size);
                    const baseFontSize = Number.isFinite(drawFontSize)
                      ? drawFontSize
                      : (Number.isFinite(blockFontSize) ? blockFontSize : 10);
                    const scaledFontSize = Math.max(6, baseFontSize * pageScale);
                    const baseLineHeight = Number.isFinite(drawLineHeight)
                      ? drawLineHeight
                      : Number(blockAny.line_height);
                    const scaledLineHeight = Number.isFinite(baseLineHeight)
                      ? Math.max(7, baseLineHeight * pageScale)
                      : Math.max(7, scaledFontSize * 1.2);
                    const x0 = Number(block.bbox[0]) || 0;
                    const y0 = Number(block.bbox[1]) || 0;
                    const x1 = Number(block.bbox[2]) || x0 + 1;
                    const y1 = Number(block.bbox[3]) || y0 + 1;
                    const effectiveDrawLines = drawLines;
                    const textColor = String(blockAny.text_color || '#122333');
                    const rawStrokeWidth = Number(blockAny.stroke_width);
                    const strokeWidth = Number.isFinite(rawStrokeWidth) && rawStrokeWidth > 0
                      ? Math.min(rawStrokeWidth, 0.02)
                      : 0.02;
                    const effectiveFontWeight = effectiveFontWeightForBlock(blockAny);
                    const fauxBoldEnabled = shouldApplyFauxBoldStrokeForBlock(blockAny, baseFontSize);
                    const clipMode = String(block.clip_mode || 'auto');
                    const sourceClipDefault = Boolean(blockAny.source_clip_default);
                    const clipResolved = clipMode === 'on' || (clipMode === 'auto' && sourceClipDefault);
                    const style = {
                      left: x0 * pageScale,
                      top: y0 * pageScale,
                      width: Math.max(1, (x1 - x0) * pageScale),
                      height: Math.max(1, (y1 - y0) * pageScale),
                      overflow: clipResolved ? 'hidden' : 'visible',
                    };
                    const collisionFromSkippedOnly = skipSingleCharBlocks
                      && Boolean(block.collision)
                      && Array.isArray(blockAny.collides_with)
                      && (blockAny.collides_with as string[]).length > 0
                      && (blockAny.collides_with as string[]).every((id) => {
                        const collidee = page.blocks.find((b) => b.source_block_id === id);
                        return String((collidee as PageBlock & Record<string, unknown>)?.text || '').length <= 1;
                      });
                    const effectiveCollision = block.collision && !collisionFromSkippedOnly;
                    const warning = Boolean(
                      block.overflow
                      || effectiveCollision
                      || (block.redacted && (block.overflow || effectiveCollision || block.truncated))
                      || localDraw?.overflow
                      || localDraw?.redacted
                      || localDraw?.truncated
                    );
                    const alignment = resolveEffectiveAlignment({
                      alignment: String(block.alignment || 'left'),
                      text: String(block.text || blockAny.source_text || ''),
                      textTightness: String(blockAny.text_tightness || ''),
                      alignmentEdited: Boolean(blockAny.alignment_edited),
                    });
                    const textAlignValue: CSSProperties['textAlign'] = (
                      alignment === 'left'
                      || alignment === 'center'
                      || alignment === 'right'
                      || alignment === 'justify'
                      || alignment === 'start'
                      || alignment === 'end'
                        ? alignment
                        : 'left'
                    );
                    const labelStyle: CSSProperties = {
                      fontSize: `${scaledFontSize}px`,
                      lineHeight: `${scaledLineHeight}px`,
                      fontFamily: "'LingadooPreview', sans-serif",
                      fontWeight: effectiveFontWeight === 'bold' ? 700 : 400,
                      color: textColor,
                      textAlign: effectiveDrawLines.length ? 'left' : textAlignValue,
                      direction: inferTextDirection(String(block.text || blockAny.source_text || '')),
                      unicodeBidi: 'plaintext',
                      overflow: clipResolved ? 'hidden' : 'visible',
                    };
                    const textOrientation = String(drawPlan?.text_orientation || blockAny.source_text_orientation || 'horizontal');
                    const textRotationDeg = Number(blockAny.text_rotation_deg || 0);
                    const textFrame = resolveLogicalTextFrame(block.bbox, {
                      orientation: textOrientation,
                      paddingPt: Number(drawPlan?.text_padding_pt ?? (isVerticalTextOrientation(textOrientation) ? 0 : 1)),
                    });
                    if (isVerticalTextOrientation(textOrientation)) {
                      labelStyle.width = `${Math.max(1, textFrame.logicalWidth * pageScale)}px`;
                      labelStyle.height = `${Math.max(1, textFrame.logicalHeight * pageScale)}px`;
                      labelStyle.padding = '0';
                      labelStyle.transformOrigin = 'top left';
                      if (textRotationDeg === 90) {
                        labelStyle.transform = `translateX(${Math.max(1, (x1 - x0) * pageScale)}px) rotate(90deg)`;
                      } else if (textRotationDeg === -90) {
                        labelStyle.transform = `translateY(${Math.max(1, (y1 - y0) * pageScale)}px) rotate(-90deg)`;
                      }
                    }
                    const preFit = Array.isArray(blockAny.pre_fit_bbox) && blockAny.pre_fit_bbox.length === 4
                      ? blockAny.pre_fit_bbox as number[]
                      : null;
                    const wasNudged = nudgeOverlay && preFit != null && (
                      Math.abs(preFit[0] - x0) > 0.1
                      || Math.abs(preFit[1] - y0) > 0.1
                      || Math.abs(preFit[2] - x1) > 0.1
                      || Math.abs(preFit[3] - y1) > 0.1
                    );
                    const showMixedBidiReconstructedDebug = nudgeOverlay && Boolean(blockAny.mixed_bidi_reconstructed);
                    return (
                      <div
                        key={`block-${pageId}-${block.source_block_id}`}
                        className={`overlay-block${selected ? ' selected' : ''}${warning ? ' redacted' : ''}${wasNudged ? ' nudged' : ''}${showMixedBidiReconstructedDebug ? ' bidi-reconstructed-debug' : ''}`}
                        style={style}
                        title={`${block.source_block_id} (${block.block_type})`}
                        onPointerDown={(event) => startDrag(event, pageId, block.source_block_id)}
                        onClick={(event) => {
                          updateCanvasBlockLoupe(pageId, block, event);
                        }}
                        onPointerMove={(event) => {
                          if (canvasBlockLoupe?.blockId === block.source_block_id) {
                            updateCanvasBlockLoupe(pageId, block, event);
                          }
                        }}
                        onPointerLeave={() => {
                          if (canvasBlockLoupe?.blockId === block.source_block_id) {
                            clearCanvasBlockLoupe();
                          }
                        }}
                        onDoubleClick={(event) => {
                          if (toolMode !== 'select') return;
                          event.stopPropagation();
                          openInlineEditor(pageId, block.source_block_id);
                        }}
                      >
                        {Boolean(blockAny.background_fill_enabled) && Array.isArray(blockAny.background_fill_color) ? (
                          <div
                            className="overlay-block-fill"
                            style={{
                              background: rgbFromFloatTriplet(blockAny.background_fill_color),
                            }}
                          />
                        ) : null}
                        <div className="overlay-label" style={labelStyle}>
                          {effectiveDrawLines.length ? effectiveDrawLines.map((linePlan, index) => {
                            const xPt = Number(linePlan.x_pt) || 0;
                            const baselinePt = Number(linePlan.baseline_pt) || 0;
                            const topPt = Math.max(0, baselinePt - baseFontSize);
                            const lineStyle: CSSProperties & { WebkitTextStroke?: string } = {
                              left: `${xPt * pageScale}px`,
                              top: `${topPt * pageScale}px`,
                              fontSize: `${scaledFontSize}px`,
                              lineHeight: `${scaledLineHeight}px`,
                              fontFamily: "'LingadooPreview', sans-serif",
                              fontWeight: labelStyle.fontWeight,
                              direction: inferTextDirection(String(linePlan.text || '')),
                              unicodeBidi: 'plaintext',
                            };
                            if (!isVerticalTextOrientation(textOrientation) && alignment === 'justify' && index < (effectiveDrawLines.length - 1)) {
                              const justifySpacing = resolveJustifiedLineSpacing(String(linePlan.text || ''), {
                                targetWidthPt: textFrame.contentWidth,
                                fontSize: baseFontSize,
                                fontWeight: effectiveFontWeight === 'bold' ? 'bold' : 'normal',
                              });
                              lineStyle.width = `${Math.max(1, textFrame.contentWidth * pageScale)}px`;
                              lineStyle.wordSpacing = `${justifySpacing.extraWordSpacingPt * pageScale}px`;
                            }
                            if (fauxBoldEnabled) {
                              lineStyle.WebkitTextStroke = `${Math.max(0.02, strokeWidth * pageScale).toFixed(2)}px ${textColor}`;
                            }
                            return (
                              <div key={`${pageId}-${block.source_block_id}-line-${index}`} className="overlay-line" style={lineStyle}>
                                {String(linePlan.text || '')}
                              </div>
                            );
                          }) : wrapTextForOverlay(String(block.text || ''))}
                        </div>
                        <div
                          className="resize-handle"
                          onPointerDown={(event) => startResize(event, pageId, block.source_block_id, 'br')}
                        />
                        {selected ? (
                          <>
                            <div className="resize-handle resize-handle--tl"
                              onPointerDown={(event) => { event.stopPropagation(); startResize(event, pageId, block.source_block_id, 'tl'); }} />
                            <div className="resize-handle resize-handle--tr"
                              onPointerDown={(event) => { event.stopPropagation(); startResize(event, pageId, block.source_block_id, 'tr'); }} />
                            <div className="resize-handle resize-handle--bl"
                              onPointerDown={(event) => { event.stopPropagation(); startResize(event, pageId, block.source_block_id, 'bl'); }} />
                          </>
                        ) : null}
                      </div>
                    );
                  })}

                  {nudgeOverlay && page.blocks.map((block) => {
                    const blockAny = block as PageBlock & Record<string, unknown>;
                    const preFit = Array.isArray(blockAny.pre_fit_bbox) && (blockAny.pre_fit_bbox as number[]).length === 4
                      ? blockAny.pre_fit_bbox as number[]
                      : null;
                    if (!preFit) return null;
                    const bx0 = Number(block.bbox[0]) || 0;
                    const by0 = Number(block.bbox[1]) || 0;
                    const bx1 = Number(block.bbox[2]) || bx0 + 1;
                    const by1 = Number(block.bbox[3]) || by0 + 1;
                    if (
                      Math.abs(preFit[0] - bx0) <= 0.1
                      && Math.abs(preFit[1] - by0) <= 0.1
                      && Math.abs(preFit[2] - bx1) <= 0.1
                      && Math.abs(preFit[3] - by1) <= 0.1
                    ) return null;
                    return (
                      <div
                        key={`nudge-ghost-${pageId}-${block.source_block_id}`}
                        className="nudge-ghost"
                        style={{
                          left: preFit[0] * pageScale,
                          top: preFit[1] * pageScale,
                          width: Math.max(1, (preFit[2] - preFit[0]) * pageScale),
                          height: Math.max(1, (preFit[3] - preFit[1]) * pageScale),
                        }}
                      />
                    );
                  })}

                  {continuationOverlay && (() => {
                    const bgRegions = runtime.textlessBackgroundRegions?.(session, pageId) || null;
                    const pageWidthPt = Number(bgRegions?.pageSizePt?.[0] || page.page_size_pt?.[0] || 0);
                    const pageHeightPt = Number(bgRegions?.pageSizePt?.[1] || page.page_size_pt?.[1] || 0);
                    const projectedBarriers = projectContinuationBarriers({
                      horizontalBarriers: Array.isArray(bgRegions?.horizontalBarriers) ? bgRegions.horizontalBarriers : [],
                      verticalBarriers: Array.isArray(bgRegions?.verticalBarriers) ? bgRegions.verticalBarriers : [],
                      pageWidthPt,
                      mirrorEnabled,
                    });
                    const pageHorizontalBarriers = projectedBarriers.horizontalBarriers;
                    const pageVerticalBarriers = projectedBarriers.verticalBarriers;
                    const groups = detectContinuationGroups(page.blocks, { horizontalBarriers: pageHorizontalBarriers, verticalBarriers: pageVerticalBarriers });
                    const tableCells = detectTableCells(pageHorizontalBarriers, pageVerticalBarriers, pageWidthPt, pageHeightPt);
                    const blockById = new Map<string, PageBlock>(page.blocks.map((block) => [String(block.source_block_id), block]));
                    const sharedCellIdByGroupIndex = new Map<number, string>();
                    groups.forEach((group: { blockIds: string[] }, groupIndex: number) => {
                      const groupBlocks = group.blockIds
                        .map((blockId: string) => blockById.get(String(blockId)))
                        .filter((block: PageBlock | undefined): block is PageBlock => Boolean(block));
                      if (groupBlocks.length === 0) {
                        return;
                      }
                      const sharedCell = tableCells.find((cell: { cellId: string; x1: number; y1: number; x2: number; y2: number }) => groupBlocks.every((block: PageBlock) => blockInCell(block.bbox, cell)));
                      if (sharedCell) {
                        sharedCellIdByGroupIndex.set(groupIndex, sharedCell.cellId);
                      }
                    });
                    if (debugInspectionsEnabled) {
                      (window as any).__LINGADOO_CONTINUATION_DEBUG__ = {
                        blocks: page.blocks,
                        horizontalBarriers: pageHorizontalBarriers,
                        verticalBarriers: pageVerticalBarriers,
                        groups,
                        tableCells,
                      };
                    }
                    const COLORS = [
                      'rgba(255, 107, 107, 0.25)',
                      'rgba(78, 205, 196, 0.25)',
                      'rgba(255, 195, 0, 0.25)',
                      'rgba(136, 84, 208, 0.25)',
                      'rgba(0, 168, 255, 0.25)',
                      'rgba(255, 159, 67, 0.25)',
                      'rgba(46, 213, 115, 0.25)',
                      'rgba(232, 67, 147, 0.25)',
                    ];
                    const BORDER_COLORS = [
                      'rgba(255, 107, 107, 0.7)',
                      'rgba(78, 205, 196, 0.7)',
                      'rgba(255, 195, 0, 0.7)',
                      'rgba(136, 84, 208, 0.7)',
                      'rgba(0, 168, 255, 0.7)',
                      'rgba(255, 159, 67, 0.7)',
                      'rgba(46, 213, 115, 0.7)',
                      'rgba(232, 67, 147, 0.7)',
                    ];
                    // Build a map from blockId → group color index
                    const blockColorMap = new Map<string, number>();
                    for (let gi = 0; gi < groups.length; gi++) {
                      for (const bid of groups[gi].blockIds) {
                        blockColorMap.set(bid, gi);
                      }
                    }
                    // Render a colored highlight on each member block's own bbox
                    return page.blocks
                      .filter((blk: any) => blockColorMap.has(blk.source_block_id))
                      .map((blk: any) => {
                        const gi = blockColorMap.get(blk.source_block_id)!;
                        const sharedCellId = sharedCellIdByGroupIndex.get(gi) || null;
                        const [bx0, by0, bx1, by1] = blk.bbox;
                        return (
                          <div
                            key={`cont-hi-${pageId}-${blk.source_block_id}`}
                            style={{
                              position: 'absolute',
                              left: bx0 * pageScale,
                              top: by0 * pageScale,
                              width: (bx1 - bx0) * pageScale,
                              height: (by1 - by0) * pageScale,
                              backgroundColor: COLORS[gi % COLORS.length],
                              border: `${sharedCellId ? 3 : 2}px ${sharedCellId ? 'double' : 'solid'} ${BORDER_COLORS[gi % BORDER_COLORS.length]}`,
                              borderRadius: '2px',
                              pointerEvents: 'none',
                              zIndex: 5,
                            }}
                            title={`Continuation group: ${groups[gi].blockIds.join(', ')}${sharedCellId ? ` (cell ${sharedCellId})` : ''}`}
                          />
                        );
                      });
                  })()}

                  {pageTightBBoxOverlayEntries.flatMap((entry) => ([
                    <div
                      key={`tight-bbox-source-${pageId}-${entry.blockId}`}
                      className="tight-bbox-source"
                      style={{
                        left: entry.original[0] * pageScale,
                        top: entry.original[1] * pageScale,
                        width: Math.max(1, (entry.original[2] - entry.original[0]) * pageScale),
                        height: Math.max(1, (entry.original[3] - entry.original[1]) * pageScale),
                      }}
                    />,
                    <div
                      key={`tight-bbox-proposal-${pageId}-${entry.blockId}`}
                      className="tight-bbox-proposed"
                      style={{
                        left: entry.proposal[0] * pageScale,
                        top: entry.proposal[1] * pageScale,
                        width: Math.max(1, (entry.proposal[2] - entry.proposal[0]) * pageScale),
                        height: Math.max(1, (entry.proposal[3] - entry.proposal[1]) * pageScale),
                      }}
                    />,
                  ]))}

                  {inlineEditor && inlineBlock ? (() => {
                    const x0 = Number(inlineBlock.bbox[0]) || 0;
                    const y0 = Number(inlineBlock.bbox[1]) || 0;
                    const x1 = Number(inlineBlock.bbox[2]) || x0 + 1;
                    const y1 = Number(inlineBlock.bbox[3]) || y0 + 1;
                    const scaledFontSize = Math.max(8, Number(inlineBlock.font_size || 10) * pageScale);
                    const editorStyle: CSSProperties = {
                      left: x0 * pageScale,
                      top: y0 * pageScale,
                      width: Math.max(24, (x1 - x0) * pageScale + 4),
                      height: Math.max(24, (y1 - y0) * pageScale + 4),
                      fontSize: `${scaledFontSize}px`,
                      lineHeight: `${scaledFontSize * 1.2}px`,
                      fontFamily: "'LingadooPreview', sans-serif",
                      fontWeight: effectiveFontWeightForBlock(inlineBlock as unknown as Record<string, unknown>) === 'bold' ? 700 : 400,
                      textAlign: resolveEffectiveAlignment({
                        alignment: String(inlineBlock.alignment || 'left'),
                        text: String(inlineEditor.text || inlineBlock.text || inlineBlock.source_text || ''),
                        textTightness: String(inlineBlock.text_tightness || ''),
                        alignmentEdited: Boolean(inlineBlock.alignment_edited),
                      }) as CSSProperties['textAlign'],
                      direction: inferTextDirection(String(inlineEditor.text || inlineBlock.text || inlineBlock.source_text || '')),
                      unicodeBidi: 'plaintext',
                    };
                    return (
                      <textarea
                        className="overlay-inline-editor"
                        ref={inlineEditorTextareaRef}
                        style={editorStyle}
                        value={inlineEditor.text}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={(event) => setInlineEditor({ ...inlineEditor, text: event.target.value })}
                        data-page-id={pageId}
                        onBlur={() => commitInlineEditor()}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelInlineEditor();
                            return;
                          }
                          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            commitInlineEditor();
                          }
                        }}
                        autoFocus
                      />
                    );
                  })() : null}

                  {lasso && lasso.pageId === pageId ? (
                    <div className="lasso-rect" style={{
                      left: Math.min(lasso.startX, lasso.currentX),
                      top: Math.min(lasso.startY, lasso.currentY),
                      width: Math.abs(lasso.currentX - lasso.startX),
                      height: Math.abs(lasso.currentY - lasso.startY),
                    }} />
                  ) : null}
                  {creationDrag && creationDrag.pageId === pageId ? (
                    <div className="creation-rect" style={{
                      left: Math.min(creationDrag.startX, creationDrag.currentX),
                      top: Math.min(creationDrag.startY, creationDrag.currentY),
                      width: Math.abs(creationDrag.currentX - creationDrag.startX),
                      height: Math.abs(creationDrag.currentY - creationDrag.startY),
                    }} />
                  ) : null}

                  {regionDrag && regionDrag.pageId === pageId ? (
                    <div className="region-drag-rect" style={{
                      left: Math.min(regionDrag.startX, regionDrag.currentX),
                      top: Math.min(regionDrag.startY, regionDrag.currentY),
                      width: Math.abs(regionDrag.currentX - regionDrag.startX),
                      height: Math.abs(regionDrag.currentY - regionDrag.startY),
                    }} />
                  ) : null}

                  {regionSelection && regionSelection.pageId === pageId ? (() => {
                    const page = pageCache[pageId];
                    if (!page) return null;
                    const scale = previewScaleForPage(pageId, page);
                    const [rx0, ry0, rx1, ry1] = regionSelection.bbox;
                    return (
                      <div className="region-selection" style={{
                        left: rx0 * scale, top: ry0 * scale,
                        width: (rx1 - rx0) * scale, height: (ry1 - ry0) * scale,
                      }}>
                        <div className="region-selection-actions">
                          <button type="button" className="btn-primary btn-sm" onClick={handleRegionFlip}>Flip</button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setRegionSelection(null); setToolMode('select'); }}>Cancel</button>
                        </div>
                      </div>
                    );
                  })() : null}
                </div>
              </div>
                );
              })}
            </div>
          </main>
        </div>

        <aside className="editor-properties">
          {hasSelection ? (
            <PropertiesPanel
              selectedBlocks={selectedBlocks}
              selectedGraphicRegionId={selectedGraphicRegionId}
              onUpdateOrientation={(orientation) => {
                updateSelectedBlocks({
                  source_text_orientation: orientation,
                  text_rotation_deg: orientation === 'vertical_ttb' ? 90 : 0,
                } as any);
              }}
              onUpdateTextColor={(color) => {
                updateSelectedBlocks({ text_color: color });
              }}
              onUpdateBackgroundFill={(enabled, color) => {
                const patch: Partial<PageBlock> = { background_fill_enabled: enabled } as any;
                if (color) (patch as any).background_fill_color = color;
                updateSelectedBlocks(patch);
              }}
              onUpdateText={(blockId, text) => {
                if (!selectedBlockPage) return;
                const nextBlocks = selectedBlockPage.blocks.map((item) => (
                  item.source_block_id === blockId
                    ? (clearStoredDrawPlan({ ...item, text }) as PageBlock)
                    : item
                ));
                replacePageBlocks(selectedBlockPage.page_id, nextBlocks, { recomputeWarnings: true });
                setDirty(true);
              }}
              onDelete={deleteSelectedBlocks}
              onJoin={joinSelectedBlocks}
              onToggleFlip={() => {
                if (selectedGraphicPageId != null) {
                  toggleGraphicFlip(selectedGraphicRegionId, selectedGraphicPageId);
                }
              }}
              onResetPosition={() => {
                if (selectedGraphicPageId != null) {
                  resetGraphicMove(selectedGraphicRegionId, selectedGraphicPageId);
                }
              }}
              busy={busy}
              docTextColors={docTextColors}
              docBgColors={docBgColors}
            />
          ) : (
            <div className="prop-empty-state">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"/>
                <path d="M16 12v8m-4-4h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p>Click a text block to edit its translation</p>
            </div>
          )}
        </aside>
      </div>

      {loupePresentation ? (
        <div
          className="original-thumb-loupe"
          aria-hidden="true"
          style={loupePresentation.style}
        >
          <div className="original-thumb-loupe-label">Original</div>
        </div>
      ) : null}

      <footer className="status-bar">
        <span className={dirty ? 'status-dirty' : 'status-clean'}>
          {dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <span className="status-meta">
          {status ? <span className="status-message">{status}</span> : null}
          <span>Page {activePageId} of {session.page_ids.length}</span>
        </span>
      </footer>
    </div>
  );
}
