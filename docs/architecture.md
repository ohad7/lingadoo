# Architecture

Lingadoo is a browser-first PDF translation and editing app.

The default flow is:

1. The user selects a PDF in the browser.
2. MuPDF.js extracts detected text locally.
3. The browser's local Translator API translates supported text.
4. Lingadoo fits translated blocks into a mirrored detected-text layout.
5. The editor stores the session in browser memory and exports a PDF locally.

There is no application server in the active product path. The local server used by development, inspection, and E2E serves static files only.

Important areas:

- `src/components/UploadPreviewModal.tsx`: upload flow and local session creation.
- `src/lib/document-runs/`: candidate extraction, translation, fitting, and preview orchestration.
- `src/lib/pdf-core/`: browser PDF extraction, translation, preview, and export primitives.
- `src/lib/localEditorSession.ts`: local editor runtime.
- `src/views/EditorView.tsx`: editor UI and editing operations.

When changing rendering behavior, update both the browser preview path and PDF export path.
