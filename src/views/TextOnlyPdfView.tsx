type TextOnlyPdfViewProps = {
  fileName: string;
  pdfUrl: string;
  onBack: () => void;
};

export default function TextOnlyPdfView({ fileName, pdfUrl, onBack }: TextOnlyPdfViewProps) {
  return (
    <div className="pdf-viewer-screen">
      <header className="app-bar">
        <button className="btn-ghost" type="button" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 4 }}>
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Home
        </button>
        <span className="app-bar-brand">Lingadoo</span>
        <span className="app-bar-title">{fileName}</span>
      </header>
      <main className="pdf-viewer-body">
        <iframe title="Detected text PDF preview" src={pdfUrl} className="pdf-viewer-frame" />
      </main>
    </div>
  );
}
