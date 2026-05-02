import { useRef, useState, useCallback } from 'react';
import type { BrowserCompatibilityReport } from '../lib/browserCompatibility';
import {
  HOME_LOCALES,
  localizeCompatibilityIssue,
  type LocaleConfig,
  type SupportedLocale,
} from '../lib/homeLocale';

type HomeViewProps = {
  onFileSelected: (file: File) => void;
  busy: boolean;
  error: string;
  locale: SupportedLocale;
  compatibility: BrowserCompatibilityReport | null;
  mode: 'translate' | 'edit';
};

export default function HomeView({ onFileSelected, busy, error, locale, compatibility, mode }: HomeViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const content: LocaleConfig = HOME_LOCALES[locale];
  const dropZoneDisabled = busy || compatibility?.status === 'blocked';
  const sourceUrl = import.meta.env.VITE_SOURCE_URL || '';

  const handleFile = useCallback((file: File) => {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      onFileSelected(file);
    }
  }, [onFileSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dropZoneDisabled) setDragOver(true);
  }, [dropZoneDisabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (dropZoneDisabled) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [dropZoneDisabled, handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be selected again
    e.target.value = '';
  }, [handleFile]);

  const handleDropZoneClick = useCallback(() => {
    if (!dropZoneDisabled) fileInputRef.current?.click();
  }, [dropZoneDisabled]);

  const dropZoneClass = ['drop-zone', dragOver ? 'drag-over' : ''].filter(Boolean).join(' ');

  return (
    <div className="home-view" dir={content.dir}>
      <div className="home-title">
        <h1>{content.title}</h1>
        <p>{mode === 'edit' ? content.editSubtitle : content.subtitle}</p>
      </div>

      {error && <p className="error">{error}</p>}

      {compatibility && compatibility.status !== 'ready' && (
        <div className={`compatibility-card compatibility-card-${compatibility.status}`}>
          <div className="compatibility-card-title">
            {compatibility.status === 'blocked'
              ? content.compatibilityBlockedTitle
              : content.compatibilityLimitedTitle}
          </div>
          <p className="compatibility-card-text">
            {compatibility.status === 'blocked'
              ? content.compatibilityBlockedIntro
              : content.compatibilityLimitedIntro}
          </p>
          <ul className="compatibility-card-list">
            {(compatibility.status === 'blocked' ? compatibility.hardBlockers : compatibility.warnings).map((issue) => {
              const localizedIssue = localizeCompatibilityIssue(locale, issue);
              return (
                <li key={issue.key}>
                  <strong>{localizedIssue.label}:</strong> {localizedIssue.detail}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div
        className={dropZoneClass}
        onClick={handleDropZoneClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={dropZoneDisabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      >
        <svg className="drop-zone-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="6" y="10" width="36" height="32" rx="4" stroke="currentColor" strokeWidth="2" fill="none"/>
          <path d="M24 30V18m0 0l-6 6m6-6l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="14" y="6" width="20" height="8" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
        </svg>
        <span className="drop-zone-text">{content.dropZoneText}</span>
        <span className="drop-zone-browse">{content.dropZoneBrowse}</span>
      </div>

      <div className="home-steps">
        <div className="home-step">
          <div className="home-step-number">1</div>
          <div className="home-step-label">{content.stepUploadLabel}</div>
          <div className="home-step-desc">{content.stepUploadDesc}</div>
        </div>
        <div className="home-step">
          <div className="home-step-number">2</div>
          <div className="home-step-label">{mode === 'edit' ? content.stepEditLabel : content.stepTranslateLabel}</div>
          <div className="home-step-desc">{mode === 'edit' ? content.stepEditDesc : content.stepTranslateDesc}</div>
        </div>
        <div className="home-step">
          <div className="home-step-number">3</div>
          <div className="home-step-label">{content.stepDownloadLabel}</div>
          <div className="home-step-desc">{content.stepDownloadDesc}</div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />
      {sourceUrl ? (
        <div className="public-links">
          <a href={sourceUrl} target="_blank" rel="noreferrer">Source</a>
        </div>
      ) : null}
    </div>
  );
}
