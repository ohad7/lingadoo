import type {
  PagePayload,
  RenderSnapshotResponse,
  SessionState,
  SnapshotRequest,
} from '../api/types';

export type EditorSessionRuntime = {
  fetchPage: (session: SessionState, pageId: number) => Promise<PagePayload>;
  previewUrl: (session: SessionState, pageId: number, dpi: number, revision: number) => string;
  thumbnailUrl?: (session: SessionState, pageId: number, dpi: number, revision: number) => string;
  textlessBackgroundUrl?: (session: SessionState, pageId: number, dpi: number, revision: number) => string;
  textlessBackgroundRegions?: (session: SessionState, pageId: number) => {
    pageSizePt: number[];
    regions: Array<{
      visual_id: string;
      bbox: number[];
      kind: 'image' | 'graphic_region';
      logo_candidate?: boolean;
    }>;
    horizontalBarriers: Array<{
      barrier_id: string;
      x: number;
      y1: number;
      y2: number;
      score: number;
      kind: 'explicit_line' | 'vertical_edge' | 'hybrid';
    }>;
    verticalBarriers: Array<{
      barrier_id: string;
      y: number;
      x1: number;
      x2: number;
      score: number;
      kind: 'explicit_line' | 'vertical_edge' | 'hybrid';
    }>;
  } | null;
  persistDraftPages?: (session: SessionState, pages: PagePayload[]) => void;
  renderSnapshot: (session: SessionState, payload: SnapshotRequest) => Promise<RenderSnapshotResponse>;
  translateJoinedBlock?: (
    session: SessionState,
    args: { pageId: number; sourceText: string; blockType: string },
  ) => Promise<string | null>;
  downloadPdf?: (session: SessionState) => Promise<{
    url: string;
    fileName?: string;
    revokeAfterUse?: boolean;
  } | null>;
  disposeSession?: (session: SessionState) => void;
};
