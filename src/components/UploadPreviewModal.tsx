import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  resolveAutoNudgeEnabledFromSearch,
  resolveRepairVerticalOverflowEnabledFromSearch,
  resolvePreserveVerticalSourceAnchorEnabledFromSearch,
  resolveUseTightTextBBoxEnabledFromSearch,
  resolveUseBucketFontRatioEnabledFromSearch,
  resolveDetectLogosEnabledFromSearch,
  resolveProtectVisualRegionsEnabledFromSearch,
  resolveDefaultReconstructMixedBidiLinesEnabled,
  resolveReconstructMixedBidiLinesEnabledFromSearch,
  resolveDebugInspectionsEnabledFromSearch,
  resolveBrowserTranslatorTimeoutMsFromSearch,
  resolveDocumentAlternativesEnabledFromSearch,
  resolveDocumentCandidateOverrideFromSearch,
  resolveProgressToneFromSearch,
  resolveUseBarrierDetectionFromSearch,
  resolveStrictAutoNudgeBBoxCollisionFromSearch,
  resolveMergeContinuationBlocksEnabledFromSearch,
} from '../lib/browserFeatureFlags';
import { shouldShowStandaloneUploadError } from '../lib/uploadPreviewErrors.js';
import { clearBrowserTranslationInspectionEntries } from '../lib/browserTranslationInspection.js';
import { createLocalEditorSession } from '../lib/localEditorSession';
import { DOCUMENT_RUN_PHASES, runDocumentCandidates } from '../lib/document-runs/candidateRunEngine.js';
import {
  detectDocumentLanguage,
  DOCUMENT_LANGUAGE_ORDER,
  getDocumentLanguage,
  shouldMirrorByDefault,
} from '../lib/pdf-core/documentLanguages';
import UploadProgressModal from './UploadProgressModal';
import type { EditorSessionRuntime } from '../lib/editorSessionRuntime';
import type { SessionState, UploadJobState } from '../api/types';

type UploadPreviewModalProps = {
  file: File;
  initialPages?: number[] | null;
  onCancel: () => void;
  onOpenLocalSession: (result: { session: SessionState; runtime: EditorSessionRuntime }) => void;
  onOpenLocalSessionVersions?: (result: {
    versions: Array<{
      id: string;
      label: string;
      recommended: boolean;
      session: SessionState;
    }>;
    activeSessionId: string;
    runtime: EditorSessionRuntime;
    note: string;
  }) => void;
  onOpenTextOnlyPdf: (result: { url: string; fileName: string }) => void;
  mode: 'translate' | 'edit';
};

const BROWSER_PHASES = [
  ...DOCUMENT_RUN_PHASES,
] as const;

type DocumentRunOutput = Awaited<ReturnType<typeof runDocumentCandidates>>;

function optionLabelForIndex(index: number): string {
  return `Option ${String.fromCharCode(65 + index)}`;
}

function previewUrlFromPngBytes(pngBytes: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([pngBytes], { type: 'image/png' }));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const TEXT_PADDING_PT = 1.0;

async function compositePreviewPage(
  pngBytes: ArrayBuffer,
  fittedBlocks: Array<Record<string, any>>,
  widthPt: number,
  heightPt: number,
): Promise<string> {
  const bgUrl = previewUrlFromPngBytes(pngBytes);
  try {
    await document.fonts.ready;
    const img = await loadImage(bgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return bgUrl;

    ctx.drawImage(img, 0, 0);

    const scaleX = img.width / widthPt;
    const scaleY = img.height / heightPt;

    for (const block of fittedBlocks) {
      const bbox = block.bbox;
      if (!Array.isArray(bbox) || bbox.length < 4) continue;
      const text = String(block.translated_text || '');
      if (!text) continue;
      const lines: string[] = Array.isArray(block.lines) ? block.lines : text.split('\n');
      if (lines.length === 0) continue;

      const [x0, y0, x1, y1] = bbox.map(Number);
      const fontSize = Math.max(1, Number(block.font_size) || 10);
      const lineHeight = Math.max(fontSize, Number(block.line_height) || fontSize * 1.2);

      // White fill behind text
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY);

      // Draw text
      const fontPx = fontSize * scaleY;
      ctx.font = `${fontPx}px LingadooPreview, sans-serif`;
      ctx.fillStyle = '#122333';
      ctx.textBaseline = 'alphabetic';

      const padX = TEXT_PADDING_PT * scaleX;
      const padY = TEXT_PADDING_PT * scaleY;
      const contentW = (x1 - x0) * scaleX - padX * 2;

      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        const measured = ctx.measureText(lineText);
        // Center horizontally within content area
        const lx = x0 * scaleX + padX + Math.max(0, (contentW - measured.width) / 2);
        const ly = y0 * scaleY + padY + fontPx + i * (lineHeight * scaleY);
        ctx.fillText(lineText, lx, ly);
      }
    }

    return new Promise((resolve) => {
      canvas.toBlob((b) => {
        if (b) resolve(URL.createObjectURL(b));
        else resolve(bgUrl);
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(bgUrl);
  }
}

function createLocalUploadJob({
  fileName,
  currentPhase,
  pagesTotal,
  pagesDone = 0,
  status = 'running',
  startedAt,
  error = '',
}: {
  fileName: string;
  currentPhase: (typeof BROWSER_PHASES)[number];
  pagesTotal: number;
  pagesDone?: number;
  status?: UploadJobState['status'];
  startedAt: number;
  error?: string;
}): UploadJobState {
  const phaseIndex = Math.max(0, BROWSER_PHASES.indexOf(currentPhase));
  const phaseCount = BROWSER_PHASES.length;
  const pageFraction = (
    (currentPhase === 'translate_pages' || currentPhase === 'fit_pages') && pagesTotal > 0
  )
    ? Math.max(0, Math.min(1, pagesDone / pagesTotal))
    : 0;
  const progressPercent = status === 'succeeded'
    ? 100
    : Math.round((((phaseIndex + pageFraction) / phaseCount) * 100) * 10) / 10;
  const nowIso = new Date().toISOString();
  return {
    job_id: `browser-local-${fileName}`,
    status,
    current_phase: currentPhase,
    progress_percent: progressPercent,
    elapsed_ms: Date.now() - startedAt,
    phase_started_at: nowIso,
    pages_total: pagesTotal,
    pages_done: pagesDone,
    session_id: '',
    document_id: '',
    error,
    created_at: nowIso,
    started_at: nowIso,
    finished_at: status === 'succeeded' || status === 'failed' ? nowIso : '',
    performance_summary_url: '',
  };
}

export default function UploadPreviewModal({
  file,
  initialPages = null,
  onCancel,
  onOpenLocalSession,
  onOpenLocalSessionVersions,
  onOpenTextOnlyPdf: _onOpenTextOnlyPdf,
  mode = 'translate',
}: UploadPreviewModalProps) {
  const editOnly = mode === 'edit';
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [browserPreviewStarted, setBrowserPreviewStarted] = useState(false);
  const [browserPreviewLoading, setBrowserPreviewLoading] = useState(false);
  const [browserUploadJob, setBrowserUploadJob] = useState<UploadJobState | null>(null);
  const [browserPreviewError, setBrowserPreviewError] = useState('');
  const [enhancementPending, setEnhancementPending] = useState(false);
  const [enhancementActive, setEnhancementActive] = useState(false);
  const [enhancementProgress, setEnhancementProgress] = useState<number>(0);
  const [candidateSelection, setCandidateSelection] = useState<DocumentRunOutput | null>(null);
  const [candidatePreviewUrlsById, setCandidatePreviewUrlsById] = useState<Record<string, string[]>>({});
  const [detectedSourceLanguage, setDetectedSourceLanguage] = useState<{
    code: string;
    name: string;
    confidence: number;
    reason: string;
  } | null>(null);
  const [sourceLanguageCode, setSourceLanguageCode] = useState('he');
  const [targetLanguageCode, setTargetLanguageCode] = useState('en');
  const [mirrorEnabled, setMirrorEnabled] = useState(true);
  const [mirrorTouched, setMirrorTouched] = useState(false);
  const [autoNudgeEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return resolveAutoNudgeEnabledFromSearch(window.location.search);
  });
  const [browserTranslatorTimeoutMs] = useState(() => {
    if (typeof window === 'undefined') return null;
    return resolveBrowserTranslatorTimeoutMsFromSearch(window.location.search);
  });
  const [preserveVerticalSourceAnchorEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolvePreserveVerticalSourceAnchorEnabledFromSearch(window.location.search);
  });
  const [useBucketFontRatioEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return resolveUseBucketFontRatioEnabledFromSearch(window.location.search);
  });
  const [useTightTextBBoxEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveUseTightTextBBoxEnabledFromSearch(window.location.search);
  });
  const reconstructMixedBidiLinesEnabled = (() => {
    const defaultValue = resolveDefaultReconstructMixedBidiLinesEnabled({
      appMode: mode,
      sourceLanguageCode,
    });
    if (typeof window === 'undefined') {
      return defaultValue;
    }
    return resolveReconstructMixedBidiLinesEnabledFromSearch(window.location.search, defaultValue);
  })();
  const [detectLogosEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveDetectLogosEnabledFromSearch(window.location.search);
  });
  const [protectVisualRegionsEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveProtectVisualRegionsEnabledFromSearch(window.location.search);
  });
  const [repairVerticalOverflowEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveRepairVerticalOverflowEnabledFromSearch(window.location.search);
  });
  const [documentAlternativesEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveDocumentAlternativesEnabledFromSearch(window.location.search);
  });
  const [debugInspectionsEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveDebugInspectionsEnabledFromSearch(window.location.search);
  });
  const [useBarrierDetectionEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveUseBarrierDetectionFromSearch(window.location.search);
  });
  const [strictAutoNudgeBBoxCollisionEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveStrictAutoNudgeBBoxCollisionFromSearch(window.location.search);
  });
  const [mergeContinuationBlocksEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return resolveMergeContinuationBlocksEnabledFromSearch(window.location.search);
  });
  const [mockTranslationRun] = useState<Record<string, any> | null>(() => {
    if (typeof window === 'undefined') return null;
    const globalWindow = window as Window & {
      __LINGADOO_MOCK_TRANSLATION_RUN__?: Record<string, any> | null;
    };
    return globalWindow.__LINGADOO_MOCK_TRANSLATION_RUN__ || null;
  });
  const [documentCandidateOverride] = useState<'main-detected-text' | 'ocr-grouped' | 'ocr-grouped-mirrored' | null>(() => {
    if (typeof window === 'undefined') return null;
    return resolveDocumentCandidateOverrideFromSearch(window.location.search);
  });
  const [progressTone] = useState<'calm' | 'playful' | 'silly'>(() => {
    if (typeof window === 'undefined') return 'playful';
    return resolveProgressToneFromSearch(window.location.search);
  });
  const [subProgress, setSubProgress] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<string>('');
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pageSelectionDragging, setPageSelectionDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const pageSelectionGestureRef = useRef<{
    active: boolean;
    pointerId: number | null;
    targetSelected: boolean;
    visitedPages: Set<number>;
  }>({
    active: false,
    pointerId: null,
    targetSelected: true,
    visitedPages: new Set(),
  });
  const suppressThumbClickRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const loadPdf = async () => {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const thumbs: string[] = [];
      const sampleTexts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        if (i <= 2) {
          const textContent = await page.getTextContent();
          sampleTexts.push(
            (textContent.items || [])
              .map((item) => String('str' in item ? item.str || '' : ''))
              .filter(Boolean)
              .join(' '),
          );
        }
        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Unable to build thumbnail preview.');
        }
        await page.render({ canvasContext: ctx, viewport }).promise;
        thumbs.push(canvas.toDataURL());
      }
      if (cancelled) return;
      setThumbnails(thumbs);
      setTotalPages(pdf.numPages);
      if (Array.isArray(initialPages) && initialPages.length > 0) {
        setSelectedPages(new Set(initialPages.filter((p) => p >= 1 && p <= pdf.numPages)));
      } else {
        setSelectedPages(new Set(Array.from({ length: pdf.numPages }, (_, i) => i + 1)));
      }
      const detected = detectDocumentLanguage(sampleTexts.join('\n'));
      setDetectedSourceLanguage(detected);
      setSourceLanguageCode(detected.code);
      setLoading(false);
    };
    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!initialPages || initialPages.length === 0) return;
    if (loading || autoStartedRef.current) return;
    if (selectedPages.size === 0) return;
    autoStartedRef.current = true;
    void handleGenerateBrowserPreview();
  }, [loading, selectedPages, initialPages]);

  useEffect(() => {
    if (mirrorTouched) {
      return;
    }
    setMirrorEnabled(shouldMirrorByDefault(sourceLanguageCode, targetLanguageCode));
  }, [mirrorTouched, sourceLanguageCode, targetLanguageCode]);

  // Pre-select recommended tab when candidate selection appears
  useEffect(() => {
    if (candidateSelection) {
      const recommended = candidateSelection.decision.recommendedCandidateId;
      const firstId = String(candidateSelection.candidates[0]?.id || '');
      setActiveTab(recommended ? String(recommended) : firstId);
      setPreviewPageIndex(0);
    }
  }, [candidateSelection]);

  useEffect(() => {
    if (!candidateSelection) {
      setCandidatePreviewUrlsById({});
      return;
    }
    let cancelled = false;
    const urlsCreated: string[] = [];

    async function generateCompositePreviews() {
      const nextPreviewUrlsById: Record<string, string[]> = {};
      for (const candidate of candidateSelection!.candidates) {
        if (cancelled) return;
        const renderedPages = Array.isArray(candidate?.localSessionArgs?.renderedPages)
          ? candidate.localSessionArgs.renderedPages
          : [];
        const pageArtifactsById = (candidate?.localSessionArgs as any)?.pageArtifactsById;
        const previewUrls: string[] = [];
        for (const page of renderedPages) {
          if (cancelled) return;
          const artifacts = pageArtifactsById?.get?.(Number(page.pageId));
          const fittedBlocks = Array.isArray(artifacts?.fitted?.blocks) ? artifacts.fitted.blocks : [];
          const url = await compositePreviewPage(
            page.pngBytes,
            fittedBlocks,
            Number(page.widthPt) || 1,
            Number(page.heightPt) || 1,
          );
          urlsCreated.push(url);
          previewUrls.push(url);
        }
        nextPreviewUrlsById[String(candidate.id)] = previewUrls;
      }
      if (!cancelled) {
        setCandidatePreviewUrlsById(nextPreviewUrlsById);
      }
    }

    generateCompositePreviews();
    return () => {
      cancelled = true;
      urlsCreated.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [candidateSelection]);

  function togglePage(pageNum: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) {
        next.delete(pageNum);
      } else {
        next.add(pageNum);
      }
      return next;
    });
  }

  function setAllPagesSelected() {
    setSelectedPages(new Set(Array.from({ length: totalPages }, (_, index) => index + 1)));
  }

  function clearSelectedPages() {
    setSelectedPages(new Set());
  }

  function setPageSelected(pageNum: number, shouldSelect: boolean) {
    setSelectedPages((prev) => {
      const alreadySelected = prev.has(pageNum);
      if (alreadySelected === shouldSelect) {
        return prev;
      }
      const next = new Set(prev);
      if (shouldSelect) {
        next.add(pageNum);
      } else {
        next.delete(pageNum);
      }
      return next;
    });
  }

  function applyPageSelectionGesture(pageNum: number) {
    const gesture = pageSelectionGestureRef.current;
    if (!gesture.active || gesture.visitedPages.has(pageNum)) {
      return;
    }
    gesture.visitedPages.add(pageNum);
    setPageSelected(pageNum, gesture.targetSelected);
  }

  function beginPageSelectionGesture(event: React.PointerEvent<HTMLButtonElement>, pageNum: number) {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    if (event.pointerType === 'touch') {
      return;
    }
    event.preventDefault();
    suppressThumbClickRef.current = true;
    pageSelectionGestureRef.current = {
      active: true,
      pointerId: event.pointerId,
      targetSelected: !selectedPages.has(pageNum),
      visitedPages: new Set(),
    };
    setPageSelectionDragging(true);
    applyPageSelectionGesture(pageNum);
  }

  function finishPageSelectionGesture() {
    const gesture = pageSelectionGestureRef.current;
    if (!gesture.active) {
      return;
    }
    pageSelectionGestureRef.current = {
      active: false,
      pointerId: null,
      targetSelected: true,
      visitedPages: new Set(),
    };
    setPageSelectionDragging(false);
  }

  useEffect(() => {
    if (!pageSelectionDragging) {
      return undefined;
    }
    function handlePointerMove(event: PointerEvent) {
      const gesture = pageSelectionGestureRef.current;
      if (!gesture.active) {
        return;
      }
      if (gesture.pointerId != null && event.pointerId !== gesture.pointerId) {
        return;
      }
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const thumb = hit instanceof Element
        ? hit.closest<HTMLElement>('[data-page-thumb="true"]')
        : null;
      const pageNum = Number(thumb?.dataset.pageNum || 0);
      if (pageNum > 0) {
        applyPageSelectionGesture(pageNum);
      }
    }
    function handlePointerEnd(event: PointerEvent) {
      const gesture = pageSelectionGestureRef.current;
      if (gesture.pointerId != null && event.pointerId !== gesture.pointerId) {
        return;
      }
      finishPageSelectionGesture();
    }
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [pageSelectionDragging]);

  async function handleGenerateBrowserPreview() {
    const requestedPages = Array.from(selectedPages).sort((a, b) => a - b);
    let progressPagesTotal = requestedPages.length;
    const startedAt = Date.now();
    const setPhase = (
      currentPhase: string,
      {
        pagesDone = 0,
        status = 'running',
        error = '',
      }: {
        pagesDone?: number;
        status?: UploadJobState['status'];
        error?: string;
      } = {},
    ) => {
      setBrowserUploadJob(createLocalUploadJob({
        fileName: file.name,
        currentPhase,
        pagesTotal: progressPagesTotal,
        pagesDone,
        status,
        startedAt,
        error,
      }));
    };

    setBrowserPreviewStarted(true);
    setBrowserPreviewLoading(true);
    setBrowserPreviewError('');
    setEnhancementPending(false);
    setEnhancementActive(false);
    setEnhancementProgress(0);
    setCandidateSelection(null);
    clearBrowserTranslationInspectionEntries();
    setPhase('receive_upload');

    try {
      const documentRun = await runDocumentCandidates({
        file,
        requestedPages,
        sourceLanguageCode,
        targetLanguageCode: editOnly ? sourceLanguageCode : targetLanguageCode,
        mirrorEnabled: editOnly ? false : mirrorEnabled,
        alternativesEnabled: documentAlternativesEnabled,
        candidateIdOverride: documentCandidateOverride,
        autoNudgeEnabled,
        strictAutoNudgeBBoxCollisionEnabled,
        repairVerticalOverflowEnabled,
        preserveVerticalSourceAnchorEnabled,
        useTightTextBBoxEnabled,
        detectLogosEnabled,
        protectVisualRegionsEnabled,
        reconstructMixedBidiLinesEnabled,
        debugInspectionsEnabled,
        useBarrierDetectionEnabled,
        mergeContinuationBlocksEnabled,
        useBucketFontRatioEnabled,
        browserTranslatorTimeoutMs,
        mockTranslationRun,
        onQualityDecision: (qualityDecision) => {
          if (qualityDecision?.shouldRunAlternatives) {
            setEnhancementPending(true);
          }
        },
        onPhase: (currentPhase: string, details?: { pagesDone?: number; pagesTotal?: number; subProgress?: number; candidateIndex?: number; candidateCount?: number }) => {
          const cIdx = Number(details?.candidateIndex ?? 0);
          const cCount = Number(details?.candidateCount ?? 1);

          // Alternative candidates (index > 0) → activate enhancement and route progress
          if (cIdx > 0 && cCount > 1) {
            setEnhancementActive(true);
            // Coarse phase fraction within one candidate
            const phaseFractions: Record<string, number> = {
              extract_layouts: 0.0,
              download_language_pack: 0.2,
              translate_pages: 0.4,
              fit_pages: 0.7,
              render_outputs: 0.9,
            };
            const baseFraction = phaseFractions[currentPhase] ?? 0;
            // Add page-level granularity within the phase
            let pageFraction = 0;
            const phaseSpan = currentPhase === 'translate_pages' ? 0.3
              : currentPhase === 'fit_pages' ? 0.2
              : currentPhase === 'extract_layouts' ? 0.2
              : 0;
            if (phaseSpan > 0 && Number(details?.pagesTotal) > 0) {
              pageFraction = phaseSpan * Math.min(1, Number(details?.pagesDone ?? 0) / Number(details?.pagesTotal));
            }
            const candidateFraction = (baseFraction + pageFraction);
            const overallPercent = ((cIdx - 1 + candidateFraction) / (cCount - 1)) * 100;
            setEnhancementProgress(Math.max(0, Math.min(100, overallPercent)));
            return;
          }

          // Main candidate (index 0): update main progress as before
          if (Number.isFinite(Number(details?.pagesTotal)) && Number(details?.pagesTotal) > 0) {
            progressPagesTotal = Number(details?.pagesTotal);
          }
          // Forward continuous sub-progress (e.g. Tesseract 0-1)
          if (typeof details?.subProgress === 'number' && Number.isFinite(details.subProgress)) {
            setSubProgress(details.subProgress);
          } else {
            setSubProgress(undefined);
          }
          if (currentPhase === 'translate_pages' || currentPhase === 'fit_pages' || currentPhase === 'extract_layouts') {
            setPhase(currentPhase, { pagesDone: Number(details?.pagesDone || 0) });
            return;
          }
          setPhase(currentPhase);
        },
      });
      progressPagesTotal = documentRun.shared.supportedPageIds.length;
      const decision = documentRun.decision;
      if (decision.mode === 'choose-candidate') {
        if (onOpenLocalSessionVersions) {
          const builtVersions = documentRun.candidates.map((candidate, index) => {
            const localSession = createLocalEditorSession({
              sourcePdfName: documentRun.shared.sourcePdfName,
              sourcePdfBytes: documentRun.shared.sourcePdfBytes,
              ...(candidate.localSessionArgs as any),
            });
            return {
              id: String(candidate.id || ''),
              label: optionLabelForIndex(index),
              recommended: decision.recommendedCandidateId === String(candidate.id || ''),
              session: localSession.session,
              runtime: localSession.runtime,
            };
          });
          const activeSessionId = String(
            decision.recommendedCandidateId
            || builtVersions[0]?.id
            || '',
          );
          const sharedRuntime = builtVersions[0]?.runtime;
          if (!activeSessionId || !sharedRuntime) {
            throw new Error('Unable to prepare alternative document versions.');
          }
          onOpenLocalSessionVersions({
            versions: builtVersions.map(({ id, label, recommended, session }) => ({
              id,
              label,
              recommended,
              session,
            })),
            activeSessionId,
            runtime: sharedRuntime,
            note: '',
          });
          return;
        }
        setCandidateSelection(documentRun);
        setBrowserUploadJob(null);
        return;
      }
      const selectedCandidate = documentRun.candidates.find((candidate) => candidate.id === decision.candidateId);
      if (!selectedCandidate) {
        throw new Error('Unable to resolve the selected document candidate.');
      }
      setPhase('create_working_session');
      const localSession = createLocalEditorSession({
        sourcePdfName: documentRun.shared.sourcePdfName,
        sourcePdfBytes: documentRun.shared.sourcePdfBytes,
        ...(selectedCandidate.localSessionArgs as any),
      });
      setPhase('create_working_session', {
        status: 'succeeded',
        pagesDone: documentRun.shared.supportedPageIds.length,
      });
      onOpenLocalSession(localSession);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[upload-preview-modal] default detected-text editor flow failed', error);
      setBrowserPreviewError(message);
      setBrowserUploadJob((job) => createLocalUploadJob({
        fileName: file.name,
        currentPhase: (job?.current_phase as (typeof BROWSER_PHASES)[number]) || 'extract_layouts',
        pagesTotal: requestedPages.length,
        pagesDone: Number(job?.pages_done || 0),
        status: 'failed',
        startedAt,
        error: message,
      }));
    } finally {
      setBrowserPreviewLoading(false);
    }
  }

  function openChosenCandidate(documentRun: DocumentRunOutput, candidateId: string) {
    const selectedCandidate = documentRun.candidates.find((candidate) => candidate.id === candidateId);
    if (!selectedCandidate) {
      setBrowserPreviewError('Unable to resolve the selected document version.');
      return;
    }
    const localSession = createLocalEditorSession({
      sourcePdfName: documentRun.shared.sourcePdfName,
      sourcePdfBytes: documentRun.shared.sourcePdfBytes,
      ...(selectedCandidate.localSessionArgs as any),
    });
    onOpenLocalSession(localSession);
  }

  // Reset zoom on tab/page change
  useEffect(() => {
    setZoom(1);
    requestAnimationFrame(() => {
      if (!viewportRef.current) {
        return;
      }
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    });
  }, [activeTab, previewPageIndex]);

  const applyZoomAtPoint = useCallback((nextZoom: number, cursorX: number, cursorY: number) => {
    const viewport = viewportRef.current;
    const clampedZoom = Math.max(1, Math.min(5, nextZoom));
    if (!viewport) {
      setZoom(clampedZoom);
      return;
    }
    const previousZoom = Math.max(1, zoom);
    const contentX = (viewport.scrollLeft + cursorX) / previousZoom;
    const contentY = (viewport.scrollTop + cursorY) / previousZoom;
    setZoom(clampedZoom);
    requestAnimationFrame(() => {
      if (!viewportRef.current) {
        return;
      }
      viewportRef.current.scrollLeft = Math.max(0, contentX * clampedZoom - cursorX);
      viewportRef.current.scrollTop = Math.max(0, contentY * clampedZoom - cursorY);
    });
  }, [zoom]);

  // Pinch-to-zoom toward cursor via non-passive wheel listener
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const viewport = el;
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      applyZoomAtPoint(zoom + (-e.deltaY * 0.01), cx, cy);
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [applyZoomAtPoint, zoom]);

  const handlePreviewDoubleClick = useCallback((e: React.MouseEvent) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    applyZoomAtPoint(zoom > 1 ? 1 : 2.25, cx, cy);
  }, [applyZoomAtPoint, zoom]);

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
    const viewport = viewportRef.current;
    if (zoom <= 1 || !viewport) return;
    e.preventDefault();
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  }, [zoom]);

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    const viewport = viewportRef.current;
    if (!dragRef.current.active || !viewport) return;
    viewport.scrollLeft = dragRef.current.scrollLeft - (e.clientX - dragRef.current.startX);
    viewport.scrollTop = dragRef.current.scrollTop - (e.clientY - dragRef.current.startY);
  }, []);

  const handlePreviewMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const languageControls = (
    <div style={{ display: 'grid', gap: 12, marginBottom: 16, textAlign: 'start' }}>
      <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
        <span>Source language{detectedSourceLanguage ? ` · detected ${detectedSourceLanguage.name}` : ''}</span>
        <select value={sourceLanguageCode} onChange={(event) => setSourceLanguageCode(event.target.value)}>
          {DOCUMENT_LANGUAGE_ORDER.map((code) => {
            const language = getDocumentLanguage(code);
            return <option key={code} value={code}>{language.name}</option>;
          })}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
        <span>Target language</span>
        <select value={targetLanguageCode} onChange={(event) => setTargetLanguageCode(event.target.value)}>
          {DOCUMENT_LANGUAGE_ORDER.map((code) => {
            const language = getDocumentLanguage(code);
            return <option key={code} value={code}>{language.name}</option>;
          })}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
        <input
          type="checkbox"
          checked={mirrorEnabled}
          onChange={(event) => {
            setMirrorEnabled(event.target.checked);
            setMirrorTouched(true);
          }}
        />
        <span>Reverse layout direction</span>
      </label>
    </div>
  );

  const candidateChooser = candidateSelection ? (() => {
    const activePreviewUrls = candidatePreviewUrlsById[activeTab] || [];
    const activeIndex = candidateSelection.candidates.findIndex(
      (c) => String(c.id) === activeTab,
    );
    const clampedPage = Math.min(previewPageIndex, Math.max(0, activePreviewUrls.length - 1));

    return (
      <div className="candidate-chooser">
        <div className="candidate-chooser-header">
          <h3>Which version looks best?</h3>
          <p>Choose the version you want to open in the editor.</p>
        </div>

        {/* Tab bar */}
        <div className="candidate-tab-bar">
          {candidateSelection.candidates.map((candidate, index) => {
            const candidateId = String(candidate.id || '');
            const isActive = candidateId === activeTab;
            const recommended = candidateSelection.decision.recommendedCandidateId === candidateId;
            return (
              <button
                key={candidateId}
                type="button"
                className={`candidate-tab${isActive ? ' candidate-tab--active' : ''}`}
                onClick={() => { setActiveTab(candidateId); setPreviewPageIndex(0); }}
              >
                {optionLabelForIndex(index)}
                {recommended && <span className="candidate-tab-badge">Recommended</span>}
              </button>
            );
          })}
        </div>

        {/* Full-width preview with natural scroll + zoom */}
        <div className="candidate-preview-area">
          {activePreviewUrls.length > 0 ? (
            <>
              <div
                ref={viewportRef}
                className={`candidate-preview-viewport${zoom > 1 ? ' candidate-preview-viewport--zoomed' : ''}`}
                onDoubleClick={handlePreviewDoubleClick}
                onMouseDown={handlePreviewMouseDown}
                onMouseMove={handlePreviewMouseMove}
                onMouseUp={handlePreviewMouseUp}
                onMouseLeave={handlePreviewMouseUp}
              >
                {clampedPage > 0 && (
                  <button
                    type="button"
                    className="candidate-preview-nav candidate-preview-nav--prev"
                    onClick={() => setPreviewPageIndex(clampedPage - 1)}
                    aria-label="Previous page"
                  >
                    &#x2039;
                  </button>
                )}
                <div
                  className="candidate-preview-surface"
                  style={{ width: `${zoom * 100}%` }}
                >
                  <img
                    className="candidate-preview-image"
                    src={activePreviewUrls[clampedPage]}
                    alt={`${optionLabelForIndex(activeIndex)} page ${clampedPage + 1}`}
                    draggable={false}
                  />
                </div>
                {clampedPage < activePreviewUrls.length - 1 && (
                  <button
                    type="button"
                    className="candidate-preview-nav candidate-preview-nav--next"
                    onClick={() => setPreviewPageIndex(clampedPage + 1)}
                    aria-label="Next page"
                  >
                    &#x203A;
                  </button>
                )}
              </div>

              {/* Page dots + zoom hint */}
              <div className="candidate-preview-controls">
                {activePreviewUrls.length > 1 && (
                  <div className="candidate-page-dots">
                    {activePreviewUrls.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`candidate-page-dot${i === clampedPage ? ' candidate-page-dot--active' : ''}`}
                        onClick={() => setPreviewPageIndex(i)}
                        aria-label={`Page ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
                {zoom > 1 ? (
                  <button
                    type="button"
                    className="candidate-zoom-reset"
                    onClick={() => {
                      setZoom(1);
                      if (viewportRef.current) {
                        viewportRef.current.scrollLeft = 0;
                        viewportRef.current.scrollTop = 0;
                      }
                    }}
                  >
                    Reset zoom
                  </button>
                ) : (
                  <span className="candidate-zoom-hint">Pinch or double-click to zoom</span>
                )}
              </div>
            </>
          ) : (
            <div className="candidate-preview-empty">Preview unavailable</div>
          )}
        </div>

        {/* Open button */}
        <div className="candidate-preview-footer">
          <button
            className="btn-primary"
            type="button"
            onClick={() => openChosenCandidate(candidateSelection, activeTab)}
          >
            Open and edit this version
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--ink-faint)' }}>
            You can edit the translation after opening.
          </span>
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className={`modal-content${candidateSelection ? ' modal-content--candidate-chooser' : ''}${!browserPreviewStarted && totalPages > 1 ? ' modal-content--page-picker' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Upload: {file.name}</h2>
          <button className="modal-close" onClick={onCancel}>&#x2715;</button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--ink-muted)' }}>Loading preview...</p>
        ) : (
          <>
            {!browserPreviewStarted ? (
              <>
                {totalPages === 1 ? (
                  <div className="upload-single-page">
                    <div className="upload-single-page-thumb">
                      <img src={thumbnails[0]} alt="Page 1" />
                    </div>
                    <div className="upload-single-page-info">
                      {!editOnly && languageControls}
                      <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)', margin: '0 0 8px' }}>
                        {file.name}
                      </p>
                      <p style={{ fontSize: '0.85rem', color: 'var(--ink-faint)', margin: '0 0 16px' }}>
                        1 page
                      </p>
                      <button
                        className="btn-primary"
                        type="button"
                        disabled={browserPreviewLoading}
                        onClick={() => { void handleGenerateBrowserPreview(); }}
                      >
                        {editOnly ? 'Edit' : 'Translate'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-page-picker">
                    {!editOnly && languageControls}
                    <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', margin: 0 }}>
                      {editOnly ? 'Select pages to edit' : 'Select pages to translate'}
                    </p>

                    <div className={`page-thumb-grid-wrap${pageSelectionDragging ? ' page-thumb-grid-wrap--dragging' : ''}`}>
                      <div className={`page-thumb-grid${pageSelectionDragging ? ' page-thumb-grid--dragging' : ''}`}>
                        {thumbnails.map((dataUrl, index) => {
                          const pageNum = index + 1;
                          const isSelected = selectedPages.has(pageNum);
                          return (
                            <button
                              key={pageNum}
                              className={`page-thumb${isSelected ? ' selected' : ''}`}
                              onPointerDown={(event) => beginPageSelectionGesture(event, pageNum)}
                              onClick={() => {
                                if (suppressThumbClickRef.current) {
                                  suppressThumbClickRef.current = false;
                                  return;
                                }
                                togglePage(pageNum);
                              }}
                              onDragStart={(event) => event.preventDefault()}
                              type="button"
                              data-page-thumb="true"
                              data-page-num={pageNum}
                            >
                              <img src={dataUrl} alt={`Page ${pageNum}`} draggable={false} />
                              <span className="page-thumb-checkbox">{isSelected ? '\u2713' : ''}</span>
                              <span className="page-thumb-number">{pageNum}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="page-selection-footer">
                      <div className="page-selection-meta">
                        <span className="page-selection-count">
                        {selectedPages.size} of {totalPages} pages selected
                        </span>
                        <span className="page-selection-hint">Click or drag across thumbnails to select or clear pages.</span>
                      </div>
                      <div className="page-selection-actions">
                        <div className="page-selection-bulk-actions">
                          <button className="btn-secondary" type="button" onClick={setAllPagesSelected}>All</button>
                          <button className="btn-secondary" type="button" onClick={clearSelectedPages}>None</button>
                        </div>
                        <button
                          className="btn-primary"
                          type="button"
                          disabled={browserPreviewLoading || selectedPages.size === 0}
                          onClick={() => { void handleGenerateBrowserPreview(); }}
                        >
                          {editOnly ? 'Edit' : 'Translate'} {selectedPages.size} page{selectedPages.size !== 1 ? 's' : ''}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                {candidateChooser || (browserUploadJob && (
                  <UploadProgressModal
                    uploadJob={browserUploadJob}
                    filename={file.name}
                    embedded
                    title={editOnly ? `Processing ${file.name}` : `Translating ${file.name}`}
                    progressTone={progressTone}
                    workingHarder={enhancementActive}
                    subProgress={subProgress}
                    sourceLanguage={getDocumentLanguage(sourceLanguageCode).name}
                    targetLanguage={getDocumentLanguage(targetLanguageCode).name}
                    enhancementPending={enhancementPending}
                    enhancementActive={enhancementActive}
                    enhancementProgress={enhancementProgress}
                  />
                ))}

                {shouldShowStandaloneUploadError(browserUploadJob, browserPreviewError) && (
                  <p className="error" style={{ marginBottom: 12 }}>{browserPreviewError}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
