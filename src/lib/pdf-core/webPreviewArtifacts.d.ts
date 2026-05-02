export function buildPassthroughTranslations(layout: Record<string, any>): Record<string, any>;
export function sourceWrapDefaultsForLayout(layout: Record<string, any>): Record<string, string>;
export function buildWebPreviewArtifacts(layout: Record<string, any>, options?: {
  translations?: Record<string, any> | null;
  mirrorEnabled?: boolean;
}): {
  sourceLayout: Record<string, any>;
  editorLayout: Record<string, any>;
  mirrorEnabled: boolean;
  mirroredLayout: Record<string, any>;
  fitted: Record<string, any>;
  translations: Record<string, any>;
};
