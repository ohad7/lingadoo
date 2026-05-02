export type BrowserCompatibilityIssueSeverity = 'blocker' | 'warning';

export type BrowserCompatibilityIssue = {
  key: string;
  severity: BrowserCompatibilityIssueSeverity;
  label: string;
  detail: string;
};

export type BrowserCompatibilityReport = {
  status: 'checking' | 'ready' | 'limited' | 'blocked';
  hardBlockers: BrowserCompatibilityIssue[];
  warnings: BrowserCompatibilityIssue[];
  translatorSupported: boolean;
  workerRuntimeReady: boolean;
  previewRenderingReady: boolean;
  pdfExportReady: boolean;
};

export function checkingBrowserCompatibilityReport(): BrowserCompatibilityReport;
export function assessBrowserCompatibility(): Promise<BrowserCompatibilityReport>;
export function assessBrowserCompatibilityForTest(args: {
  baseSupport: {
    worker: boolean;
    blob: boolean;
    objectUrl: boolean;
    webAssembly: boolean;
  };
  runtimeProbe: null | {
    workerReady: boolean;
    wasmReady: boolean;
    previewCanvasReady: boolean;
    pdfExportReady: boolean;
    workerFetchReady: boolean;
    error?: string;
  };
  translatorSupported?: boolean;
}): BrowserCompatibilityReport;
