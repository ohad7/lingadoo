import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalEditorSession } from '../../src/lib/localEditorSession.ts';
import { BrowserPipelineClient } from '../../src/lib/pdf-core/browserPipelineClient.js';

function buildSessionArgs(documentId = 'doc-1') {
  const sourceLayout = {
    document_id: documentId,
    page_id: 1,
    page_size_pt: [100, 120],
    styles: [],
    blocks: [],
    graphic_regions: [],
  };
  return {
    sourcePdfName: 'test.pdf',
    sourcePdfBytes: new Uint8Array([1, 2, 3]),
    manifest: {
      document_id: documentId,
      pages: [{ page_id: 1 }],
    },
    pageArtifactsById: new Map([
      [1, {
        sourceLayout,
        layout: sourceLayout,
        fitted: { blocks: [] },
      }],
    ]),
    renderedPages: [{
      pageId: 1,
      widthPt: 100,
      heightPt: 120,
      pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
      tables: [],
    }],
    originalPagePreviewUrlsById: new Map([[1, 'blob:test-preview']]),
  };
}

test('createLocalEditorSession produces unique session ids for the same document', () => {
  const first = createLocalEditorSession(buildSessionArgs('shared-doc'));
  const second = createLocalEditorSession(buildSessionArgs('shared-doc'));

  assert.notEqual(first.session.session_id, second.session.session_id);

  first.runtime.disposeSession?.(first.session);
  second.runtime.disposeSession?.(second.session);
});

test('local editor runtime persists draft pages per session', async () => {
  const { session, runtime } = createLocalEditorSession(buildSessionArgs('draft-doc'));
  const page = await runtime.fetchPage(session, 1);
  const updatedPage = {
    ...page,
    preview_url: 'blob:updated-preview',
  };

  runtime.persistDraftPages?.(session, [updatedPage]);

  const reloaded = await runtime.fetchPage(session, 1);
  assert.equal(reloaded.preview_url, 'blob:updated-preview');

  runtime.disposeSession?.(session);
});

test('local editor runtime exposes textless background previews when provided', () => {
  const { session, runtime } = createLocalEditorSession({
    ...buildSessionArgs('textless-doc'),
    textlessPagePreviewUrlsById: new Map([[1, 'blob:textless-preview']]),
  });

  assert.equal(runtime.textlessBackgroundUrl?.(session, 1, 144, 0), 'blob:textless-preview');

  runtime.disposeSession?.(session);
});

test('local editor runtime exposes detected source page barriers when provided', () => {
  const { session, runtime } = createLocalEditorSession({
    ...buildSessionArgs('barrier-doc'),
    textlessPageBarriersById: new Map([[1, {
      horizontalBarriers: [{
        barrier_id: 'barrier_1',
        x: 42,
        y1: 10,
        y2: 95,
        score: 0.91,
        kind: 'hybrid',
      }],
      verticalBarriers: [],
    }]]),
  });

  assert.deepEqual(runtime.textlessBackgroundRegions?.(session, 1), {
    pageSizePt: [100, 120],
    regions: [],
    horizontalBarriers: [{
      barrier_id: 'barrier_1',
      x: 42,
      y1: 10,
      y2: 95,
      score: 0.91,
      kind: 'hybrid',
    }],
    verticalBarriers: [],
  });

  runtime.disposeSession?.(session);
});

test('local editor page payload includes source visual background regions and logo markers', async () => {
  const sourceLayout = {
    document_id: 'visual-doc',
    page_id: 1,
    page_size_pt: [120, 140],
    styles: [],
    blocks: [],
    images: [{
      image_id: 'img_1_1',
      page_id: 1,
      bbox: [5, 6, 25, 30],
    }],
    graphic_regions: [{
      region_id: 'gr_1_1',
      bbox: [60, 12, 90, 28],
      drawing_count: 8,
      flipped: true,
      source_kind: 'graphic_region',
      auto_protected: true,
    }],
    logo_regions: [{
      logo_id: 'logo_1',
      bbox: [60, 12, 90, 28],
      source_kind: 'graphic_region',
      source_id: 'gr_1_1',
    }],
  };

  const { session, runtime } = createLocalEditorSession({
    sourcePdfName: 'visual-doc.pdf',
    sourcePdfBytes: new Uint8Array([1, 2, 3]),
    manifest: {
      document_id: 'visual-doc',
      pages: [{ page_id: 1 }],
    },
    pageArtifactsById: new Map([
      [1, {
        sourceLayout,
        layout: sourceLayout,
        fitted: { blocks: [] },
      }],
    ]),
    renderedPages: [{
      pageId: 1,
      widthPt: 120,
      heightPt: 140,
      pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
      tables: [],
    }],
    originalPagePreviewUrlsById: new Map([[1, 'blob:test-preview']]),
  });

  const page = await runtime.fetchPage(session, 1);
  assert.deepEqual(page.graphic_regions, [{
    region_id: 'gr_1_1',
    bbox: [60, 12, 90, 28],
    flipped: true,
    source_kind: 'graphic_region',
    auto_protected: true,
    score: undefined,
    drawing_count: 8,
  }]);
  assert.deepEqual(page.background_visual_regions, [
    {
      visual_id: 'img_1_1',
      bbox: [5, 6, 25, 30],
      kind: 'image',
      logo_candidate: false,
    },
    {
      visual_id: 'gr_1_1',
      bbox: [60, 12, 90, 28],
      kind: 'graphic_region',
      logo_candidate: true,
    },
  ]);
  assert.deepEqual(runtime.textlessBackgroundRegions?.(session, 1), {
    pageSizePt: [120, 140],
    regions: [
      {
        visual_id: 'img_1_1',
        bbox: [5, 6, 25, 30],
        kind: 'image',
        logo_candidate: false,
      },
      {
        visual_id: 'gr_1_1',
        bbox: [60, 12, 90, 28],
        kind: 'graphic_region',
        logo_candidate: true,
      },
    ],
    horizontalBarriers: [],
    verticalBarriers: [],
  });

  runtime.disposeSession?.(session);
});

test('local editor snapshot render preserves image orientation restore setting', async () => {
  let capturedPayload = null;
  const originalWorker = globalThis.Worker;
  const originalRenderCanvasPreview = BrowserPipelineClient.prototype.renderCanvasPreview;
  const originalDestroy = BrowserPipelineClient.prototype.destroy;

  class WorkerStub {
    addEventListener() {}
    terminate() {}
    postMessage() {}
  }

  globalThis.Worker = WorkerStub;
  BrowserPipelineClient.prototype.renderCanvasPreview = async function renderCanvasPreview(payload) {
    capturedPayload = payload;
    return {
      pages: [{
        pageId: 1,
        pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
      }],
    };
  };
  BrowserPipelineClient.prototype.destroy = function destroy() {};

  try {
    const { session, runtime } = createLocalEditorSession({
      ...buildSessionArgs('ocr-mirrored-doc'),
      mirrorEnabled: true,
      restoreImageOrientationsEnabled: false,
      previewMode: 'detected-text-editor',
    });

    await runtime.renderSnapshot(session, {
      document_id: session.document_id,
      version: 1,
      pages: [{
        page_id: 1,
        blocks: [],
        graphic_regions: [],
      }],
    });

    assert.equal(capturedPayload?.restoreImageOrientations, false);
    runtime.disposeSession?.(session);
  } finally {
    BrowserPipelineClient.prototype.renderCanvasPreview = originalRenderCanvasPreview;
    BrowserPipelineClient.prototype.destroy = originalDestroy;
    globalThis.Worker = originalWorker;
  }
});

test('local editor session preserves mixed bidi reconstruction markers on page blocks', async () => {
  const sourceLayout = {
    document_id: 'bidi-doc',
    page_id: 1,
    page_size_pt: [120, 140],
    styles: [{
      style_id: 's1',
      font_family: 'Test',
      font_size: 10,
      weight: 'normal',
      italic: false,
      color: '#000000',
      alignment: 'right',
      line_spacing: 1.2,
      render_mode: 0,
      stroke_width: 0,
    }],
    blocks: [{
      block_id: 'p1_b57',
      page_id: 1,
      type: 'text_line',
      bbox: [10, 20, 70, 32],
      text: 'השירותים העיקריים שלך למנוי: 03-5377563',
      style_id: 's1',
      reading_order: 1,
      source: 'detected_text',
      confidence: 1,
      flattened_line_breaks: false,
      text_tightness: 'tight',
      source_text_orientation: 'horizontal',
      mixed_bidi_reconstructed: true,
    }],
    graphic_regions: [],
  };

  const { session, runtime } = createLocalEditorSession({
    sourcePdfName: 'bidi-doc.pdf',
    sourcePdfBytes: new Uint8Array([1, 2, 3]),
    manifest: {
      document_id: 'bidi-doc',
      pages: [{ page_id: 1 }],
    },
    pageArtifactsById: new Map([
      [1, {
        sourceLayout,
        layout: sourceLayout,
        fitted: {
          blocks: [{
            block_id: 'p1_f1',
            source_block_id: 'p1_b57',
            page_id: 1,
            style_id: 's1',
            bbox: [10, 20, 70, 32],
            pre_fit_bbox: [10, 20, 70, 32],
            translated_text: 'Your main subscriber services: 03-5377563',
            lines: ['Your main subscriber services: 03-5377563'],
            font_size: 8,
            line_height: 9.6,
            overflow: false,
            text_tightness: 'tight',
            collision: false,
            collides_with: [],
          }],
        },
      }],
    ]),
    renderedPages: [{
      pageId: 1,
      widthPt: 120,
      heightPt: 140,
      pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
      tables: [],
    }],
    originalPagePreviewUrlsById: new Map([[1, 'blob:test-preview']]),
  });

  const page = await runtime.fetchPage(session, 1);
  assert.equal(page.blocks.length, 1);
  assert.equal(page.blocks[0]?.mixed_bidi_reconstructed, true);

  runtime.disposeSession?.(session);
});

test('local editor snapshot render preserves source bbox for mirrored flipped graphic regions created in the current draft', async () => {
  let capturedPayload = null;
  const originalWorker = globalThis.Worker;
  const originalRenderCanvasPreview = BrowserPipelineClient.prototype.renderCanvasPreview;
  const originalDestroy = BrowserPipelineClient.prototype.destroy;

  class WorkerStub {
    addEventListener() {}
    terminate() {}
    postMessage() {}
  }

  globalThis.Worker = WorkerStub;
  BrowserPipelineClient.prototype.renderCanvasPreview = async function renderCanvasPreview(payload) {
    capturedPayload = payload;
    return {
      pages: [{
        pageId: 1,
        pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
      }],
    };
  };
  BrowserPipelineClient.prototype.destroy = function destroy() {};

  try {
    const { session, runtime } = createLocalEditorSession({
      ...buildSessionArgs('graphic-region-doc'),
      mirrorEnabled: true,
      previewMode: 'detected-text-editor',
    });

    await runtime.renderSnapshot(session, {
      document_id: session.document_id,
      version: 1,
      pages: [{
        page_id: 1,
        blocks: [],
        graphic_regions: [{
          region_id: 'user-region-1',
          flipped: true,
          source_bbox: [70, 20, 90, 40],
        }],
      }],
    });

    assert.deepEqual(capturedPayload?.graphicRegionEditsByPage?.[1], [{
      op: 'flip_graphic',
      block_id: 'user-region-1',
      source_value: [70, 20, 90, 40],
    }]);

    runtime.disposeSession?.(session);
  } finally {
    BrowserPipelineClient.prototype.renderCanvasPreview = originalRenderCanvasPreview;
    BrowserPipelineClient.prototype.destroy = originalDestroy;
    globalThis.Worker = originalWorker;
  }
});
