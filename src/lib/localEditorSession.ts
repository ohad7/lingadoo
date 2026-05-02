import type {
  PageBlock,
  PagePayload,
  RenderSnapshotResponse,
  SessionState,
  SnapshotPageInput,
  SnapshotRequest,
} from '../api/types';
import type { EditorSessionRuntime } from './editorSessionRuntime';
import type { DetectedHorizontalBarrier, DetectedVerticalBarrier } from './pageBarrierDetection.ts';
import { BrowserPipelineClient } from './pdf-core/browserPipelineClient.js';
import { resolveSkipSingleCharBlocksFromSearch } from './browserFeatureFlags.js';
import {
  buildStoredDrawPlanForFittedBlock,
  rebuildLocalDrawPlan,
  sourceClipDefaultsForLayout,
} from './localEditorDrawPlan.js';
import { finalizeEditorPageWarnings } from './localEditorWarnings.js';
import { applyTightTextBBoxToEditorBlock } from './tightTextBBoxProposal.js';
import { editorGraphicBboxToSource, sourceGraphicBboxToEditor } from './graphicRegionGeometry.js';

type LocalPageArtifacts = {
  sourceLayout?: Record<string, any>;
  layout: Record<string, any>;
  fitted: Record<string, any>;
};

type LocalRenderedPreviewPage = {
  pageId: number;
  widthPt: number;
  heightPt: number;
  pngBytes: ArrayBuffer;
  tables?: unknown[];
};

type LocalPreviewMode = 'textless-source' | 'text-only' | 'detected-text-editor';

type CreateLocalEditorSessionArgs = {
  sourcePdfName: string;
  sourcePdfBytes: Uint8Array;
  manifest: Record<string, any>;
  pageArtifactsById: Map<number, LocalPageArtifacts>;
  renderedPages: LocalRenderedPreviewPage[];
  originalPagePreviewUrlsById?: Map<number, string>;
  textlessPagePreviewUrlsById?: Map<number, string>;
  textlessPageBarriersById?: Map<number, {
    horizontalBarriers: DetectedHorizontalBarrier[];
    verticalBarriers: DetectedVerticalBarrier[];
  }>;
  translationEngine?: string;
  sourceLanguageCode?: string;
  targetLanguageCode?: string;
  mirrorEnabled?: boolean;
  restoreImageOrientationsEnabled?: boolean;
  autoNudgeEnabled?: boolean;
  useBarrierDetectionEnabled?: boolean;
  strictAutoNudgeBBoxCollisionEnabled?: boolean;
  repairVerticalOverflowEnabled?: boolean;
  preserveVerticalSourceAnchorEnabled?: boolean;
  useTightTextBBoxEnabled?: boolean;
  openingNotice?: string;
  previewMode?: LocalPreviewMode;
};

type LocalSessionRecord = {
  session: SessionState;
  sourcePdfBytes: Uint8Array;
  manifest: Record<string, any>;
  mirrorEnabled: boolean;
  restoreImageOrientationsEnabled: boolean;
  previewMode: LocalPreviewMode;
  pageArtifactsById: Map<number, LocalPageArtifacts>;
  pagePayloadsById: Map<number, PagePayload>;
  previewUrlsByPageId: Map<number, string>;
  thumbnailUrlsByPageId: Map<number, string>;
  textlessPreviewUrlsByPageId: Map<number, string>;
  textlessBackgroundRegionsByPageId: Map<number, {
    pageSizePt: number[];
    regions: Array<{
      visual_id: string;
      bbox: number[];
      kind: 'image' | 'graphic_region';
      logo_candidate?: boolean;
    }>;
    horizontalBarriers: DetectedHorizontalBarrier[];
    verticalBarriers: DetectedVerticalBarrier[];
  }>;
  previewPngBytesByPageId: Map<number, ArrayBuffer>;
  exportedPdfUrl: string;
};

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildGraphicRegionsPayload(layout: Record<string, any>) {
  return (layout.graphic_regions || []).map((region: Record<string, any>) => ({
    region_id: String(region.region_id || ''),
    bbox: Array.isArray(region.bbox) ? region.bbox.map((value: unknown) => Number(value)) : undefined,
    flipped: Boolean(region.flipped),
    source_kind: (
      String(region.source_kind || '') === 'raster_logo_candidate'
        ? 'raster_logo_candidate'
        : (String(region.source_kind || '') === 'graphic_region' ? 'graphic_region' : undefined)
    ),
    auto_protected: Boolean(region.auto_protected),
    score: Number.isFinite(Number(region.score)) ? Number(region.score) : undefined,
    drawing_count: Number(region.drawing_count || 0),
  }));
}

function buildLogoRegionsPayload(layout: Record<string, any>, mirrorEnabled: boolean) {
  const pageWidth = Number(layout?.page_size_pt?.[0] || 0);
  return (layout.logo_regions || []).map((region: Record<string, any>) => {
    const sourceBbox = Array.isArray(region.bbox) ? region.bbox.map((value: unknown) => Number(value)) : null;
    const mirroredBbox = sourceBbox
      ? (sourceGraphicBboxToEditor(pageWidth, sourceBbox, mirrorEnabled) || sourceBbox)
      : null;
    return {
      logo_id: String(region.logo_id || ''),
      bbox: mirroredBbox || [0, 0, 1, 1],
      source_kind: String(region.source_kind || '') || undefined,
      source_id: String(region.source_id || '') || undefined,
    };
  });
}

function normalizedBBoxOrNull(bbox: unknown): number[] | null {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return null;
  }
  const normalized = bbox.map((value) => Number(value));
  return normalized.every((value) => Number.isFinite(value)) ? normalized : null;
}

function buildBackgroundVisualRegionsPayload(layout: Record<string, any>) {
  const logoKeys = new Set(
    (layout.logo_regions || [])
      .map((region: Record<string, any>) => {
        const sourceKind = String(region?.source_kind || '').trim();
        const sourceId = String(region?.source_id || '').trim();
        if (!sourceKind || !sourceId) {
          return '';
        }
        return `${sourceKind}:${sourceId}`;
      })
      .filter(Boolean),
  );
  const logoBboxes: Array<number[] | null> = (layout.logo_regions || [])
    .map((region: Record<string, any>) => normalizedBBoxOrNull(region?.bbox));
  const logoBBoxKeys = new Set(
    logoBboxes
      .filter((bbox): bbox is number[] => Boolean(bbox))
      .map((bbox) => JSON.stringify(bbox)),
  );
  const imageRegions = (layout.images || []).map((image: Record<string, any>) => {
    const bbox = normalizedBBoxOrNull(image?.bbox);
    if (!bbox) {
      return null;
    }
    const sourceId = String(image?.image_id || '');
    const key = `image:${sourceId}`;
    return {
      visual_id: sourceId || `image:${JSON.stringify(bbox)}`,
      bbox,
      kind: 'image' as const,
      logo_candidate: logoKeys.has(key) || logoBBoxKeys.has(JSON.stringify(bbox)),
    };
  }).filter(Boolean);
  const graphicRegions = (layout.graphic_regions || []).map((region: Record<string, any>) => {
    const bbox = normalizedBBoxOrNull(region?.bbox);
    if (!bbox) {
      return null;
    }
    const sourceId = String(region?.region_id || '');
    const key = `graphic_region:${sourceId}`;
    return {
      visual_id: sourceId || `graphic_region:${JSON.stringify(bbox)}`,
      bbox,
      kind: 'graphic_region' as const,
      logo_candidate: logoKeys.has(key) || logoBBoxKeys.has(JSON.stringify(bbox)),
    };
  }).filter(Boolean);
  return [...imageRegions, ...graphicRegions];
}

function buildLocalPagePayload({
  session,
  artifacts,
  previewUrl,
  tables,
  preserveVerticalSourceAnchorEnabled = false,
  useTightTextBBoxEnabled = false,
}: {
  session: SessionState;
  artifacts: LocalPageArtifacts;
  previewUrl: string;
  tables: unknown[];
  preserveVerticalSourceAnchorEnabled?: boolean;
  useTightTextBBoxEnabled?: boolean;
}): PagePayload {
  const layout = artifacts.layout;
  const sourceLayout = artifacts.sourceLayout || artifacts.layout;
  const fitted = artifacts.fitted;
  const stylesById = new Map<string, Record<string, any>>((layout.styles || []).map((style: Record<string, any>) => [String(style.style_id), style]));
  const sourceBlocksById = new Map<string, Record<string, any>>((sourceLayout.blocks || []).map((block: Record<string, any>) => [String(block.block_id), block]));
  const sourceClipDefaultsById = sourceClipDefaultsForLayout(layout);
  const blocks = [...(fitted.blocks || [])]
    .sort((left: Record<string, any>, right: Record<string, any>) => {
      const leftBlock = sourceBlocksById.get(String(left.source_block_id)) || null;
      const rightBlock = sourceBlocksById.get(String(right.source_block_id)) || null;
      const leftOrder = Number(leftBlock?.reading_order ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = Number(rightBlock?.reading_order ?? Number.MAX_SAFE_INTEGER);
      return leftOrder - rightOrder;
    })
    .map((fittedBlock: Record<string, any>): PageBlock => {
      const sourceBlock = sourceBlocksById.get(String(fittedBlock.source_block_id)) || {};
      const style = stylesById.get(String(fittedBlock.style_id)) || {};
      const built = buildStoredDrawPlanForFittedBlock({
        fittedBlock,
        sourceBlock,
        style,
        sourceClipDefault: Boolean(sourceClipDefaultsById[String(sourceBlock.block_id || fittedBlock.source_block_id)]),
        clipMode: 'auto',
        bboxEdited: false,
        fauxBoldPolicy: 'semantic',
        preserveVerticalSourceAnchor: preserveVerticalSourceAnchorEnabled,
        mirrorEnabled: Boolean(session.mirror_enabled),
      }).block as PageBlock;
      const nextBlock = {
        ...built,
        source_font_size: Number(style.font_size) || Number(built.font_size) || 10,
        source_bbox: Array.isArray(sourceBlock.bbox)
          ? sourceBlock.bbox.map((value: unknown) => Number(value))
          : undefined,
        source_line_bbox: Array.isArray(sourceBlock.source_line_bbox)
          ? sourceBlock.source_line_bbox.map((value: unknown) => Number(value))
          : undefined,
        source_bottom_inset_ratio: Number.isFinite(Number(sourceBlock.source_bottom_inset_ratio))
          ? Number(sourceBlock.source_bottom_inset_ratio)
          : undefined,
        source_text_orientation: String(sourceBlock.source_text_orientation || built.source_text_orientation || 'horizontal'),
        mixed_bidi_reconstructed: Boolean(sourceBlock.mixed_bidi_reconstructed),
        preserve_vertical_source_anchor: Boolean(preserveVerticalSourceAnchorEnabled),
        alignment_edited: Boolean(sourceBlock.alignment_edited || fittedBlock.alignment_edited || built.alignment_edited),
        pre_fit_bbox: Array.isArray(fittedBlock.pre_fit_bbox)
          ? fittedBlock.pre_fit_bbox.map((value: unknown) => Number(value))
          : undefined,
        background_fill_enabled: Boolean(sourceBlock.background_fill_enabled),
        background_fill_color: Array.isArray(sourceBlock.background_fill_color)
          ? sourceBlock.background_fill_color.map((value: unknown) => Number(value))
          : undefined,
      };
      return useTightTextBBoxEnabled
        ? applyTightTextBBoxToEditorBlock(nextBlock) as PageBlock
        : nextBlock;
    });

  return {
    session_id: session.session_id,
    document_id: session.document_id,
    page_id: Number(layout.page_id),
    page_size_pt: (Array.isArray(layout.page_size_pt) ? layout.page_size_pt : [1, 1]).map((value: unknown) => Number(value)),
    preview_url: previewUrl,
    extraction_warning: sourceLayout.extraction_warning || layout.extraction_warning || null,
    blocks,
    tables: clone(Array.isArray(tables) ? tables : []),
    graphic_regions: buildGraphicRegionsPayload(layout),
    logo_regions: buildLogoRegionsPayload(sourceLayout, Boolean(session.mirror_enabled)),
    background_visual_regions: buildBackgroundVisualRegionsPayload(sourceLayout),
  };
}

function previewBlobUrlFromPngBytes(pngBytes: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([pngBytes], { type: 'image/png' }));
}

async function blankPreviewPngBytes(widthPt: number, heightPt: number, dpi = 144): Promise<ArrayBuffer> {
  const scale = dpi / 72;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(widthPt * scale)),
    Math.max(1, Math.round(heightPt * scale)),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create blank preview canvas.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

function mergeSnapshotPage(currentPage: PagePayload, snapshotPage: SnapshotPageInput): PagePayload {
  const currentBlocksById = new Map(currentPage.blocks.map((block) => [block.source_block_id, block]));
  const nextBlocks = snapshotPage.blocks.map((block): PageBlock => {
    const current = currentBlocksById.get(String(block.source_block_id || ''));
    const nextBlock = {
      ...(current || {}),
      source_block_id: String(block.source_block_id || ''),
      text: String(block.text || ''),
      bbox: (Array.isArray(block.bbox) ? block.bbox : [0, 0, 1, 1]).map((value) => Number(value)),
      font_size: Number(block.font_size) || current?.font_size || 10,
      line_height: Number(block.line_height) || current?.line_height || undefined,
      source_font_size: Number(current?.source_font_size) || undefined,
      alignment: String(block.alignment || current?.alignment || 'left'),
      alignment_edited: Boolean(block.alignment_edited ?? current?.alignment_edited),
      font_family: String(block.font_family || current?.font_family || 'sans-serif'),
      font_weight: String(block.font_weight || current?.font_weight || 'normal'),
      wrap_mode: String(block.wrap_mode || current?.wrap_mode || 'none'),
      clip_mode: String(block.clip_mode || current?.clip_mode || 'auto'),
      text_tightness: String(current?.text_tightness || ''),
      source_line_bbox: Array.isArray(current?.source_line_bbox)
        ? current.source_line_bbox.map((value) => Number(value))
        : undefined,
      source_bottom_inset_ratio: Number.isFinite(Number(current?.source_bottom_inset_ratio))
        ? Number(current?.source_bottom_inset_ratio)
        : undefined,
      source_text_orientation: String(current?.source_text_orientation || 'horizontal'),
      mixed_bidi_reconstructed: Boolean(current?.mixed_bidi_reconstructed),
      text_rotation_deg: Number.isFinite(Number(current?.text_rotation_deg))
        ? Number(current?.text_rotation_deg)
        : undefined,
      preserve_vertical_source_anchor: Boolean(current?.preserve_vertical_source_anchor),
      bbox_edited: true,
      overflow: Boolean(current?.overflow),
      collision: Boolean(current?.collision),
      redacted: Boolean(current?.redacted),
      block_type: String(current?.block_type || 'paragraph'),
    };
    const drawMetrics = rebuildLocalDrawPlan(nextBlock);
    return {
      ...nextBlock,
      draw_plan: drawMetrics.drawPlan,
      overflow: drawMetrics.overflow,
      redacted: drawMetrics.redacted,
      truncated: drawMetrics.truncated,
    } as PageBlock;
  });
  const snapshotRegionsById = new Map(
    (snapshotPage.graphic_regions || []).map((region) => [String(region.region_id || ''), region]),
  );
  const nextGraphicRegions = currentPage.graphic_regions.map((region) => {
    const snapshot = snapshotRegionsById.get(String(region.region_id || ''));
    return {
      ...region,
      flipped: snapshot ? Boolean(snapshot?.flipped) : Boolean(region.flipped),
      moved_bbox: Array.isArray(snapshot?.bbox) && snapshot.bbox.length === 4
        ? snapshot.bbox.map((value) => Number(value))
        : region.moved_bbox,
    };
  });
  for (const snapshot of snapshotPage.graphic_regions || []) {
    const regionId = String(snapshot.region_id || '');
    if (!regionId || nextGraphicRegions.some((region) => String(region.region_id || '') === regionId)) {
      continue;
    }
    nextGraphicRegions.push({
      region_id: regionId,
      flipped: Boolean(snapshot.flipped),
      bbox: Array.isArray(snapshot.source_bbox) && snapshot.source_bbox.length === 4
        ? snapshot.source_bbox.map((value) => Number(value))
        : undefined,
      moved_bbox: Array.isArray(snapshot.bbox) && snapshot.bbox.length === 4
        ? snapshot.bbox.map((value) => Number(value))
        : undefined,
    });
  }
  return {
    ...currentPage,
    blocks: nextBlocks,
    graphic_regions: nextGraphicRegions,
  };
}

const localSessionRecords = new Map<string, LocalSessionRecord>();

const localEditorSessionRuntime: EditorSessionRuntime = {
  async fetchPage(session, pageId) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      throw new Error(`Unknown local session: ${session.session_id}`);
    }
    const page = record.pagePayloadsById.get(pageId);
    if (!page) {
      throw new Error(`Unknown local page: ${pageId}`);
    }
    return clone(page);
  },
  previewUrl(session, pageId) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      return '';
    }
    return record.previewUrlsByPageId.get(pageId) || '';
  },
  thumbnailUrl(session, pageId) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      return '';
    }
    return record.thumbnailUrlsByPageId.get(pageId) || record.previewUrlsByPageId.get(pageId) || '';
  },
  textlessBackgroundUrl(session, pageId) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      return '';
    }
    return record.textlessPreviewUrlsByPageId.get(pageId)
      || record.thumbnailUrlsByPageId.get(pageId)
      || record.previewUrlsByPageId.get(pageId)
      || '';
  },
  textlessBackgroundRegions(session, pageId) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      return null;
    }
    const regions = record.textlessBackgroundRegionsByPageId.get(pageId);
    return regions ? clone(regions) : null;
  },
  persistDraftPages(session, pages) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      return;
    }
    for (const page of Array.isArray(pages) ? pages : []) {
      const pageId = Number(page?.page_id);
      if (!Number.isInteger(pageId) || pageId <= 0) {
        continue;
      }
      record.pagePayloadsById.set(pageId, clone(page));
    }
  },
  async renderSnapshot(session, payload) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      throw new Error(`Unknown local session: ${session.session_id}`);
    }
    if (record.exportedPdfUrl) {
      URL.revokeObjectURL(record.exportedPdfUrl);
      record.exportedPdfUrl = '';
    }

    const nextPagePayloadsById = new Map(record.pagePayloadsById);
    for (const snapshotPage of payload.pages || []) {
      const pageId = Number(snapshotPage.page_id);
      const currentPage = nextPagePayloadsById.get(pageId);
      if (!currentPage) {
        continue;
      }
      nextPagePayloadsById.set(pageId, mergeSnapshotPage(currentPage, snapshotPage));
    }

    const graphicRegionEditsByPage = Object.fromEntries(
      (payload.pages || []).map((snapshotPage) => {
        const pageId = Number(snapshotPage.page_id);
        const currentPage = nextPagePayloadsById.get(pageId);
        const pageWidth = Number(currentPage?.page_size_pt?.[0] || 0);
        const sourceRegionById = new Map(
          (currentPage?.graphic_regions || []).map((region) => [String(region.region_id || ''), region]),
        );
        const edits = (snapshotPage.graphic_regions || []).map((region) => {
          const regionId = String(region.region_id || '');
          const currentRegion = sourceRegionById.get(regionId) || null;
          const sourceBbox = Array.isArray(currentRegion?.bbox) && currentRegion.bbox.length === 4
            ? currentRegion.bbox.map((value) => Number(value))
            : null;
          const movedBbox = Array.isArray(region.bbox) && region.bbox.length === 4
            ? editorGraphicBboxToSource(
                pageWidth,
                region.bbox.map((value) => Number(value)),
                Boolean(record.mirrorEnabled),
              )
            : null;
          const entry: Record<string, any> = {
            op: region.flipped ? 'flip_graphic' : 'move_graphic',
            block_id: regionId,
          };
          if (sourceBbox) {
            entry.source_value = sourceBbox;
          }
          if (movedBbox) {
            entry.value = movedBbox;
          }
          if (region.flipped) {
            return entry;
          }
          if (movedBbox) {
            return entry;
          }
          return null;
        }).filter(Boolean);
        return [pageId, edits];
      }),
    );

    if (record.previewMode === 'text-only') {
      for (const [pageId, currentUrl] of record.previewUrlsByPageId.entries()) {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        const pagePayload = nextPagePayloadsById.get(pageId);
        if (!pagePayload) {
          continue;
        }
        const pngBytes = await blankPreviewPngBytes(
          Number(pagePayload.page_size_pt?.[0] || 1),
          Number(pagePayload.page_size_pt?.[1] || 1),
        );
        record.previewPngBytesByPageId.set(pageId, pngBytes.slice(0));
        record.previewUrlsByPageId.set(pageId, previewBlobUrlFromPngBytes(pngBytes));
      }
    } else {
      const client = new BrowserPipelineClient();
      try {
        const previewResult = await client.renderCanvasPreview({
          documentBytes: record.sourcePdfBytes.slice().buffer,
          manifest: record.manifest,
          pageArtifacts: [...record.pageArtifactsById.entries()].map(([pageId, artifacts]) => ({
            pageId,
            layout: artifacts.layout,
            fitted: artifacts.fitted,
          })),
          requestedPages: session.page_ids,
          renderDpi: 144,
        clearTableRegionsFromFitted: true,
        redrawTableBordersFromFitted: false,
        mirrorEnabled: record.mirrorEnabled,
        mirrorTableBboxes: false,
        restoreImageOrientations: record.restoreImageOrientationsEnabled,
        graphicRegionEditsByPage,
      });

        for (const [pageId, currentUrl] of record.previewUrlsByPageId.entries()) {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          const nextPage = previewResult.pages.find((page: { pageId: number; pngBytes: ArrayBuffer }) => Number(page.pageId) === Number(pageId));
          if (nextPage) {
            record.previewPngBytesByPageId.set(pageId, nextPage.pngBytes.slice(0));
            record.previewUrlsByPageId.set(pageId, previewBlobUrlFromPngBytes(nextPage.pngBytes));
          }
        }
      } finally {
        client.destroy();
      }
    }

    record.pagePayloadsById = nextPagePayloadsById;
    return {
      session_id: session.session_id,
      document_id: session.document_id,
      edited_pdf_url: '',
      validation_report: null,
      pages: session.page_ids
        .map((pageId) => nextPagePayloadsById.get(pageId))
        .filter((page): page is PagePayload => Boolean(page))
        .map((page) => clone(page)),
    };
  },
  async translateJoinedBlock(session, { pageId, sourceText, blockType }) {
    const normalizedSourceText = String(sourceText || '').trim();
    if (!normalizedSourceText) {
      return null;
    }
    const client = new BrowserPipelineClient();
    try {
      const result = await client.translateLayouts({
        layouts: [{
          schema_version: '1.0',
          stage: 'layout_extraction',
          document_id: session.document_id,
          page_id: Number(pageId) || 1,
          page_size_pt: [1, 1],
          blocks: [{
            block_id: 'joined-block-preview',
            page_id: Number(pageId) || 1,
            type: String(blockType || 'paragraph'),
            bbox: [0, 0, 1, 1],
            text: normalizedSourceText,
            style_id: 'joined-style',
            reading_order: 1,
          }],
          styles: [{
            style_id: 'joined-style',
            font_family: 'sans-serif',
            font_size: 10,
            weight: 'normal',
            italic: false,
            color: '#000000',
            alignment: 'left',
            line_spacing: 1.2,
            render_mode: 0,
            stroke_width: 0,
          }],
          images: [],
          graphic_regions: [],
          tables: [],
        }],
        sourceCode: String(session.source_language_code || 'he'),
        targetCode: String(session.target_language_code || 'en'),
      });
      const translatedText = String(result?.translations?.[0]?.blocks?.[0]?.translated_text || '').trim();
      return translatedText || null;
    } finally {
      client.destroy();
    }
  },
  async downloadPdf(session) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      throw new Error(`Unknown local session: ${session.session_id}`);
    }
    if (record.exportedPdfUrl) {
      URL.revokeObjectURL(record.exportedPdfUrl);
      record.exportedPdfUrl = '';
    }

    const skipSingleCharBlocks = resolveSkipSingleCharBlocksFromSearch(
      typeof window !== 'undefined' ? window.location.search : '',
    );
    const pages = session.page_ids.map((pageId) => {
      const page = record.pagePayloadsById.get(pageId);
      const previewPngBytes = record.previewPngBytesByPageId.get(pageId);
      if (!page || !previewPngBytes) {
        throw new Error(`Missing local PDF export state for page ${pageId}`);
      }
      const blocks = clone(page.blocks) as PageBlock[];
      const filteredBlocks = skipSingleCharBlocks
        ? blocks.filter((b) => String((b as PageBlock & Record<string, unknown>).text || '').length > 1)
        : blocks;
      return {
        page_id: page.page_id,
        page_size_pt: page.page_size_pt,
        blocks: filteredBlocks,
        tables: clone(page.tables),
        previewPngBytes: previewPngBytes.slice(0),
      };
    });

    const client = new BrowserPipelineClient();
    try {
      const result = await client.exportEditedPdf({ pages });
      const pdfBytes = result?.pdfBytes;
      if (!(pdfBytes instanceof Uint8Array)) {
        throw new Error('browser PDF export returned invalid bytes');
      }
      const pdfCopy = new Uint8Array(pdfBytes.byteLength);
      pdfCopy.set(pdfBytes);
      record.exportedPdfUrl = URL.createObjectURL(new Blob([pdfCopy], { type: 'application/pdf' }));
      return {
        url: record.exportedPdfUrl,
        fileName: session.source_pdf_name.replace(/\.pdf$/i, '') + '_translated.pdf',
        revokeAfterUse: false,
      };
    } finally {
      client.destroy();
    }
  },
  disposeSession(session) {
    const record = localSessionRecords.get(session.session_id);
    if (!record) {
      return;
    }
    for (const previewUrl of record.previewUrlsByPageId.values()) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    }
    if (record.exportedPdfUrl) {
      URL.revokeObjectURL(record.exportedPdfUrl);
    }
    localSessionRecords.delete(session.session_id);
  },
};

export function createLocalEditorSession(args: CreateLocalEditorSessionArgs): {
  session: SessionState;
  runtime: EditorSessionRuntime;
} {
  const sessionNonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const sessionId = `local-${args.manifest.document_id}-${sessionNonce}`;
  const pageIds = [...args.pageArtifactsById.keys()].sort((left, right) => left - right);
  const session: SessionState = {
    session_id: sessionId,
    document_id: String(args.manifest.document_id || sessionId),
    translation_engine: String(args.translationEngine || 'browser-local'),
    source_language_code: String(args.sourceLanguageCode || 'he'),
    target_language_code: String(args.targetLanguageCode || 'en'),
    mirror_enabled: args.mirrorEnabled !== false,
    opening_notice: String(args.openingNotice || ''),
    has_unsaved_local_edits: false,
    page_ids: pageIds,
    page_count: pageIds.length,
    source_pdf_name: args.sourcePdfName,
    canvas_pdf_url: '',
    initial_pdf_url: '',
    edited_pdf_url: '',
    validation_report: null,
    vlm_critic: {
      status: 'idle',
      error: '',
      generated_at: '',
      suggestion_count: 0,
    },
  };

  const previewUrlsByPageId = new Map<number, string>();
  const thumbnailUrlsByPageId = new Map<number, string>();
  const textlessPreviewUrlsByPageId = new Map<number, string>();
  const textlessBackgroundRegionsByPageId = new Map<number, {
    pageSizePt: number[];
    regions: Array<{
      visual_id: string;
      bbox: number[];
      kind: 'image' | 'graphic_region';
      logo_candidate?: boolean;
    }>;
    horizontalBarriers: DetectedHorizontalBarrier[];
    verticalBarriers: DetectedVerticalBarrier[];
  }>();
  const previewPngBytesByPageId = new Map<number, ArrayBuffer>();
  const pagePayloadsById = new Map<number, PagePayload>();
  const renderedPagesById = new Map(args.renderedPages.map((page) => [Number(page.pageId), page]));
  for (const pageId of pageIds) {
    const artifacts = args.pageArtifactsById.get(pageId);
    const renderedPage = renderedPagesById.get(pageId);
    if (!artifacts || !renderedPage) {
      throw new Error(`Missing local editor artifacts for page ${pageId}`);
    }
    const previewUrl = previewBlobUrlFromPngBytes(renderedPage.pngBytes);
    previewUrlsByPageId.set(pageId, previewUrl);
    thumbnailUrlsByPageId.set(pageId, args.originalPagePreviewUrlsById?.get(pageId) || previewUrl);
    textlessPreviewUrlsByPageId.set(
      pageId,
      args.textlessPagePreviewUrlsById?.get(pageId)
        || args.originalPagePreviewUrlsById?.get(pageId)
        || previewUrl,
    );
    const pageBarrierData = args.textlessPageBarriersById?.get(pageId);
    textlessBackgroundRegionsByPageId.set(pageId, {
      pageSizePt: Array.isArray(artifacts.sourceLayout?.page_size_pt)
        ? artifacts.sourceLayout.page_size_pt.map((value: unknown) => Number(value))
        : [Number(renderedPage.widthPt || 1), Number(renderedPage.heightPt || 1)],
      regions: buildBackgroundVisualRegionsPayload(artifacts.sourceLayout || artifacts.layout),
      horizontalBarriers: Array.isArray(pageBarrierData?.horizontalBarriers)
        ? clone(pageBarrierData.horizontalBarriers)
        : [],
      verticalBarriers: Array.isArray(pageBarrierData?.verticalBarriers)
        ? clone(pageBarrierData.verticalBarriers)
        : [],
    });
    previewPngBytesByPageId.set(pageId, renderedPage.pngBytes.slice(0));
    const rawPage = buildLocalPagePayload({
      session,
      artifacts,
      previewUrl,
      tables: Array.isArray(renderedPage.tables) ? renderedPage.tables : [],
      preserveVerticalSourceAnchorEnabled: args.preserveVerticalSourceAnchorEnabled === true,
      useTightTextBBoxEnabled: args.useTightTextBBoxEnabled === true,
    });
    let pageBarriers: Array<{ x: number; y1: number; y2: number }> = [];
    if (args.useBarrierDetectionEnabled) {
      const rawBarriers = args.textlessPageBarriersById?.get(pageId)?.horizontalBarriers;
      if (Array.isArray(rawBarriers) && rawBarriers.length > 0) {
        if (args.mirrorEnabled !== false) {
          const pageWidth = Array.isArray(artifacts.sourceLayout?.page_size_pt)
            ? Number(artifacts.sourceLayout.page_size_pt[0])
            : Number(renderedPage.widthPt || 1);
          pageBarriers = rawBarriers.map((b: any) => ({
            x: pageWidth - Number(b.x),
            y1: Number(b.y1),
            y2: Number(b.y2),
          }));
        } else {
          pageBarriers = rawBarriers.map((b: any) => ({
            x: Number(b.x),
            y1: Number(b.y1),
            y2: Number(b.y2),
          }));
        }
      }
    }
    pagePayloadsById.set(pageId, finalizeEditorPageWarnings(rawPage, {
      autoNudgeEnabled: args.autoNudgeEnabled !== false,
      repairVerticalOverflowEnabled: args.repairVerticalOverflowEnabled === true,
      horizontalBarriers: pageBarriers,
      strictAutoNudgeBBoxCollisionEnabled: args.strictAutoNudgeBBoxCollisionEnabled !== false,
    }));
  }

  localSessionRecords.set(sessionId, {
    session,
    sourcePdfBytes: args.sourcePdfBytes,
    manifest: clone(args.manifest),
    mirrorEnabled: args.mirrorEnabled !== false,
    restoreImageOrientationsEnabled: args.restoreImageOrientationsEnabled !== false,
    previewMode: args.previewMode || 'textless-source',
    pageArtifactsById: new Map([...args.pageArtifactsById.entries()].map(([pageId, artifacts]) => [pageId, clone(artifacts)])),
    pagePayloadsById,
    previewUrlsByPageId,
    thumbnailUrlsByPageId,
    textlessPreviewUrlsByPageId,
    textlessBackgroundRegionsByPageId,
    previewPngBytesByPageId,
    exportedPdfUrl: '',
  });

  return {
    session,
    runtime: localEditorSessionRuntime,
  };
}
