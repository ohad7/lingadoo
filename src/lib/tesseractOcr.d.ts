export function resolveTesseractLanguageSpec(
  sourceLanguageCode?: string,
  targetLanguageCode?: string,
): {
  primary: string;
  languages: string[];
  spec: string;
};

export function normalizeTesseractProgressMessage(message: unknown): {
  status: string;
  progress: number | null;
} | null;

export function inflateOcrBBox(
  bbox: number[],
  options?: {
    paddingX?: number;
    paddingY?: number | null;
    maxWidth?: number;
    maxHeight?: number;
  },
): number[] | null;

export function extractTesseractBoxesByGranularity(pageData: unknown): {
  block: Array<{ text: string; bbox: number[]; confidence: number | null }>;
  line: Array<{ text: string; bbox: number[]; confidence: number | null }>;
  grouped: Array<{ text: string; bbox: number[]; confidence: number | null }>;
  word: Array<{ text: string; bbox: number[]; confidence: number | null }>;
};

export function extractTesseractLineBoxes(pageData: unknown): Array<{
  text: string;
  bbox: number[];
  confidence: number | null;
}>;

export function extractTesseractWordBoxes(pageData: unknown): Array<{
  text: string;
  bbox: number[];
  confidence: number | null;
}>;
