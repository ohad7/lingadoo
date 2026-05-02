import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import type {
  SessionState,
} from './api/types';
import type { EditorSessionRuntime } from './lib/editorSessionRuntime';
import { assessBrowserCompatibility } from './lib/browserCompatibility';
import type { BrowserCompatibilityReport } from './lib/browserCompatibility';
import './styles.css';

import { LOADING_MESSAGES } from './lib/progressMessages.js';
import { parseStringSearchParam } from './lib/browserFeatureFlags.js';
import HomeView from './views/HomeView';
import {
  HOME_LOCALES,
  appModeFromPath,
  appPathFromLocationPath,
  localeFromPath,
  type SupportedLocale,
  type AppMode,
} from './lib/homeLocale';

const EditorView = lazy(() => import('./views/EditorView'));
const TextOnlyPdfView = lazy(() => import('./views/TextOnlyPdfView'));
const UploadPreviewModal = lazy(() => import('./components/UploadPreviewModal'));

type AppView = 'home' | 'editor' | 'pdf-viewer';

type EditorVersionOption = {
  id: string;
  label: string;
  recommended: boolean;
  session: SessionState;
};

type EditorVersionBundle = {
  options: EditorVersionOption[];
  activeId: string;
  note: string;
};

function UploadModalFallback() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * LOADING_MESSAGES.length));
  const lastRef = useRef(index);
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => {
        let next = Math.floor(Math.random() * LOADING_MESSAGES.length);
        if (LOADING_MESSAGES.length > 1) {
          while (next === lastRef.current) {
            next = Math.floor(Math.random() * LOADING_MESSAGES.length);
          }
        }
        lastRef.current = next;
        return next;
      });
    }, 4000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="modal-overlay">
      <div className="modal-loading">
        <div className="modal-loading__spinner" />
        <span className="modal-loading__label">{LOADING_MESSAGES[index]}</span>
      </div>
    </div>
  );
}

export default function App() {
  const currentAppPath = () => appPathFromLocationPath(window.location.pathname, import.meta.env.BASE_URL);
  const [view, setView] = useState<AppView>('home');
  const [locale, setLocale] = useState<SupportedLocale>(() => localeFromPath(currentAppPath()));
  const [appMode, setAppMode] = useState<AppMode>(() => appModeFromPath(currentAppPath()));
  const [error, setError] = useState('');
  const [session, setSession] = useState<SessionState | null>(null);
  const [editorRuntime, setEditorRuntime] = useState<EditorSessionRuntime | null>(null);
  const [editorVersions, setEditorVersions] = useState<EditorVersionBundle | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [compatibility, setCompatibility] = useState<BrowserCompatibilityReport | null>(null);
  const [textOnlyPdf, setTextOnlyPdf] = useState<{ url: string; fileName: string } | null>(null);
  const [devInitialPages] = useState<number[] | null>(() => {
    if (typeof window === 'undefined') return null;
    const p = parseStringSearchParam(window.location.search, 'p', '');
    if (!p) return null;
    const pages = p.split(',').map((s: string) => Number(s.trim())).filter((n: number) => Number.isFinite(n) && n > 0);
    return pages.length > 0 ? pages : null;
  });

  useEffect(() => {
    function handlePopState() {
      const pathname = currentAppPath();
      setLocale(localeFromPath(pathname));
      setAppMode(appModeFromPath(pathname));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const config = HOME_LOCALES[locale];
    document.documentElement.lang = config.code;
  }, [locale]);

  useEffect(() => {
    // Preload heavy chunks in the background after page load so they are ready
    // before the user drops a file.
    const preload = () => {
      void import('mupdf');
      void import('./components/UploadPreviewModal');
    };
    if (document.readyState === 'complete') {
      preload();
    } else {
      window.addEventListener('load', preload, { once: true });
      return () => window.removeEventListener('load', preload);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const startAssessment = () => {
      void (async () => {
        const report = await assessBrowserCompatibility();
        if (!cancelled) {
          setCompatibility(report);
        }
      })();
    };
    const globalWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const scheduleAssessment = () => {
      timeoutId = window.setTimeout(() => {
        if (typeof globalWindow.requestIdleCallback === 'function') {
          idleId = globalWindow.requestIdleCallback(() => {
            startAssessment();
          }, { timeout: 1500 });
        } else {
          startAssessment();
        }
      }, 0);
    };
    if (document.readyState === 'complete') {
      scheduleAssessment();
    } else {
      const onLoad = () => {
        window.removeEventListener('load', onLoad);
        if (!cancelled) {
          scheduleAssessment();
        }
      };
      window.addEventListener('load', onLoad);
      return () => {
        cancelled = true;
        window.removeEventListener('load', onLoad);
      };
    }
    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId !== null && typeof globalWindow.cancelIdleCallback === 'function') {
        globalWindow.cancelIdleCallback(idleId);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const filePath = parseStringSearchParam(window.location.search, 'file', '');
    if (!filePath) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = `/__dev__/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[dev-auto-load] Failed to fetch ${filePath}: ${response.status}`);
          return;
        }
        if (cancelled) return;
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        const fileName = filePath.split('/').pop() || 'document.pdf';
        const file = new File([bytes], fileName, { type: 'application/pdf' });
        setPendingUploadFile(file);
      } catch (err) {
        console.warn('[dev-auto-load] Error loading file:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (view === 'editor' && session && editorRuntime) {
    return (
      <Suspense fallback={null}>
        <EditorView
          key={session.session_id}
          session={session}
          runtime={editorRuntime}
          versionSwitcher={editorVersions ? {
            options: editorVersions.options.map((option) => ({
              id: option.id,
              label: option.label,
              recommended: option.recommended,
            })),
            activeId: editorVersions.activeId,
            note: editorVersions.note,
            onSelect: (nextId) => {
              const nextOption = editorVersions.options.find((option) => option.id === nextId);
              if (!nextOption) {
                return;
              }
              setEditorVersions({
                ...editorVersions,
                activeId: nextId,
              });
              setSession(nextOption.session);
            },
          } : null}
          onBack={() => {
            if (editorVersions) {
              const seen = new Set<string>();
              for (const option of editorVersions.options) {
                if (seen.has(option.session.session_id)) {
                  continue;
                }
                seen.add(option.session.session_id);
                editorRuntime.disposeSession?.(option.session);
              }
            } else {
              editorRuntime.disposeSession?.(session);
            }
            setView('home');
            setSession(null);
            setEditorRuntime(null);
            setEditorVersions(null);
          }}
          onSessionUpdate={(nextSession) => {
            setSession(nextSession);
            setEditorVersions((current) => {
              if (!current) {
                return current;
              }
              return {
                ...current,
                options: current.options.map((option) => (
                  option.id === current.activeId
                    ? { ...option, session: nextSession }
                    : option
                )),
              };
            });
          }}
        />
      </Suspense>
    );
  }

  if (view === 'pdf-viewer' && textOnlyPdf) {
    return (
      <Suspense fallback={null}>
        <TextOnlyPdfView
          fileName={textOnlyPdf.fileName}
          pdfUrl={textOnlyPdf.url}
          onBack={() => {
            URL.revokeObjectURL(textOnlyPdf.url);
            setTextOnlyPdf(null);
            setView('home');
          }}
        />
      </Suspense>
    );
  }

  return (
    <>
      <HomeView
        mode={appMode}
        locale={locale}
        compatibility={compatibility}
        onFileSelected={(file) => {
          if (compatibility?.status === 'blocked') {
            return;
          }
          setPendingUploadFile(file);
        }}
        busy={false}
        error={error}
      />
      {pendingUploadFile && (
        <Suspense fallback={<UploadModalFallback />}>
          <UploadPreviewModal
            mode={appMode}
            file={pendingUploadFile}
            initialPages={devInitialPages}
            onCancel={() => setPendingUploadFile(null)}
            onOpenLocalSession={({ session: nextSession, runtime }) => {
              setPendingUploadFile(null);
              setEditorRuntime(runtime);
              setSession(nextSession);
              setEditorVersions(null);
              setView('editor');
              setError('');
            }}
            onOpenLocalSessionVersions={({ versions, activeSessionId, runtime, note }) => {
              const activeVersion = versions.find((option) => option.id === activeSessionId) || versions[0] || null;
              if (!activeVersion) {
                return;
              }
              setPendingUploadFile(null);
              setEditorRuntime(runtime);
              setSession(activeVersion.session);
              setEditorVersions({
                options: versions,
                activeId: activeVersion.id,
                note,
              });
              setView('editor');
              setError('');
            }}
            onOpenTextOnlyPdf={({ url, fileName }) => {
              setPendingUploadFile(null);
              setTextOnlyPdf((current) => {
                if (current?.url) {
                  URL.revokeObjectURL(current.url);
                }
                return { url, fileName };
              });
              setView('pdf-viewer');
              setEditorVersions(null);
              setError('');
            }}
          />
        </Suspense>
      )}
    </>
  );
}
