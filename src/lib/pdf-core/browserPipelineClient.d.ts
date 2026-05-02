export declare class BrowserPipelineClient {
  constructor();
  destroy(): void;
  extractDocument(args: {
    documentBytes: ArrayBuffer | Uint8Array;
    sourcePdfName?: string;
    documentId?: string | null;
    requestedPages?: number[] | null;
    includeMixed?: boolean;
    extractionMode?: 'digital' | 'detected-text';
    detectLogos?: boolean;
    reconstructMixedBidiLines?: boolean;
  }): Promise<any>;
  renderCanvasPreview(payload: any): Promise<any>;
  buildTextOnlyPdf(args: {
    documentBytes: ArrayBuffer | Uint8Array;
    requestedPages?: number[] | null;
  }): Promise<{
    pdfBytes: ArrayBuffer;
  }>;
  buildDetectedTextOverlayPdf(args: {
    documentBytes: ArrayBuffer | Uint8Array;
    requestedPages?: number[] | null;
    mirrorEnabled?: boolean;
  }): Promise<{
    pdfBytes: ArrayBuffer;
  }>;
  probeRuntime(): Promise<any>;
  exportEditedPdf(args: { pages: any[] }): Promise<any>;
  prepareTranslator(args: {
    sourceCode?: string;
    targetCode?: string;
    browserTranslatorTimeoutMs?: number | null;
  }): Promise<{
    provider: any;
    availability: string;
    downloadNeeded: boolean;
    translationEngine: string;
  }>;
  translateLayouts(args: {
    layouts: any[];
    sourceCode?: string;
    targetCode?: string;
    browserTranslatorTimeoutMs?: number | null;
    provider?: any;
  }): Promise<any>;
}
