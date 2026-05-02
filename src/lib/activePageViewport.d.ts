export type ViewportStageRect = {
  top: number;
  bottom: number;
};

export type ViewportStageVisibility = {
  visibleHeight: number;
  top: number;
};

export function resolveActivePageIdFromViewport(input: {
  pageIds: number[];
  rectByPageId: Record<number, ViewportStageRect>;
  viewportTop: number;
  viewportBottom: number;
  probeY: number;
  fallbackPageId?: number | null;
}): number | null;

export function resolveActivePageIdFromVisibility(input: {
  pageIds: number[];
  visibilityByPageId: Record<number, ViewportStageVisibility>;
  fallbackPageId?: number | null;
}): number | null;
