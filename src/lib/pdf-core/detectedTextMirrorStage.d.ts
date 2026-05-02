export function buildDetectedTextMirroredArtifacts(layout: Record<string, any>, options?: {
  translations?: Record<string, any> | null;
  mirrorEnabled?: boolean;
  useBucketFontRatioEnabled?: boolean;
}): {
  sourceLayout: Record<string, any>;
  editorLayout: Record<string, any>;
  mirrorEnabled: boolean;
  mirroredLayout: Record<string, any>;
  fitted: Record<string, any>;
  translations: Record<string, any>;
};
