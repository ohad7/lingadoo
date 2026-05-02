import { useEffect, useState } from 'react';

export type ToolMode = 'select' | 'text' | 'region';

type AlignmentMode = '' | 'left' | 'center' | 'right' | 'justify';
type WeightMode = '' | 'normal' | 'bold';
type WrapMode = '' | 'none' | 'word';

type EditorToolbarProps = {
  toolMode: ToolMode;
  onToolModeChange: (mode: ToolMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasTextSelection: boolean;
  fontSizeValue?: string;
  fontSizePlaceholder?: string;
  onFontSizeStep: (delta: number) => void;
  onFontSizeCommit: (value: number) => void;
  onAutoFit: () => void;
  selectedWeight: WeightMode;
  onWeightChange: (value: 'normal' | 'bold') => void;
  selectedAlignment: AlignmentMode;
  onAlignmentChange: (value: 'left' | 'center' | 'right' | 'justify') => void;
  selectedWrapMode: WrapMode;
  onWrapModeChange: (value: 'none' | 'word') => void;
};

function AlignmentIcon({ mode }: { mode: 'left' | 'center' | 'right' }) {
  if (mode === 'center') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M3 4h10" />
        <path d="M5 7h6" />
        <path d="M2 10h12" />
        <path d="M4 13h8" />
      </svg>
    );
  }
  if (mode === 'right') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M3 4h10" />
        <path d="M7 7h6" />
        <path d="M2 10h11" />
        <path d="M6 13h7" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 4h10" />
      <path d="M3 7h6" />
      <path d="M3 10h11" />
      <path d="M3 13h7" />
    </svg>
  );
}

function WrapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h8a2.5 2.5 0 1 1 0 5H7" />
      <path d="M2.5 8h4.5" />
      <path d="M7 8l-1.8-1.8" />
      <path d="M7 8l-1.8 1.8" />
      <path d="M2.5 12h7" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5h4" />
      <path d="M9.5 4.5h4" />
      <path d="M5 2l1.8 2.5L5 7" />
      <path d="M11 2L9.2 4.5 11 7" />
      <path d="M2.5 11.5h11" />
      <path d="M8 11.5v-3" />
      <path d="M6.3 10l1.7-1.5L9.7 10" />
    </svg>
  );
}

export default function EditorToolbar({
  toolMode,
  onToolModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasTextSelection,
  fontSizeValue = '',
  fontSizePlaceholder = 'Size',
  onFontSizeStep,
  onFontSizeCommit,
  onAutoFit,
  selectedWeight,
  onWeightChange,
  selectedAlignment,
  onAlignmentChange,
  selectedWrapMode,
  onWrapModeChange,
}: EditorToolbarProps) {
  const [fontInputValue, setFontInputValue] = useState(fontSizeValue);

  useEffect(() => {
    setFontInputValue(fontSizeValue);
  }, [fontSizeValue]);

  function commitFontInput() {
    const parsed = Number.parseFloat(fontInputValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFontInputValue(fontSizeValue);
      return;
    }
    const rounded = Math.round(parsed * 100) / 100;
    setFontInputValue(String(rounded));
    onFontSizeCommit(rounded);
  }

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Editor tools">
      <div className="editor-toolbar-group">
        <button
          type="button"
          className={`toolbar-btn${toolMode === 'select' ? ' toolbar-btn--active' : ''}`}
          onClick={() => onToolModeChange('select')}
          title="Select tool (V)"
          aria-pressed={toolMode === 'select'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 2l4 12 2-5 5-2L3 2z" />
          </svg>
          <span className="toolbar-btn-label">Select</span>
        </button>
        <button
          type="button"
          className={`toolbar-btn${toolMode === 'text' ? ' toolbar-btn--active' : ''}`}
          onClick={() => onToolModeChange('text')}
          title="New text block (T)"
          aria-pressed={toolMode === 'text'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3h10M8 3v10M5 13h6" />
          </svg>
          <span className="toolbar-btn-label">Text</span>
        </button>
        <button
          type="button"
          className={`toolbar-btn${toolMode === 'region' ? ' toolbar-btn--active' : ''}`}
          onClick={() => onToolModeChange('region')}
          title="Region select (R)"
          aria-pressed={toolMode === 'region'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2">
            <rect x="2" y="2" width="12" height="12" rx="1" />
          </svg>
          <span className="toolbar-btn-label">Region</span>
        </button>
      </div>

      <div className="editor-toolbar-separator" />

      <div className="editor-toolbar-group">
        <button
          type="button"
          className="toolbar-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7h7a3 3 0 0 1 0 6H9" />
            <path d="M6 4L3 7l3 3" />
          </svg>
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13 7H6a3 3 0 0 0 0 6h1" />
            <path d="M10 4l3 3-3 3" />
          </svg>
        </button>
      </div>

      <div className="editor-toolbar-separator" />
      <div className="editor-toolbar-group editor-toolbar-group--format">
        <div className={`toolbar-size-cluster${hasTextSelection ? '' : ' toolbar-size-cluster--disabled'}`} role="group" aria-label="Type size">
          <div className="toolbar-size-cluster__label">Type</div>
          <div className="toolbar-size-cluster__controls">
            <button
              type="button"
              className="toolbar-btn toolbar-btn--compact"
              onClick={() => onFontSizeStep(-0.5)}
              title="Decrease font size"
              disabled={!hasTextSelection}
            >
              <span className="toolbar-btn-text">A-</span>
            </button>
            <div className="toolbar-font-stepper" role="group" aria-label="Font size">
              <input
                className="toolbar-number-input"
                type="text"
                inputMode="decimal"
                aria-label="Font size"
                placeholder={fontSizePlaceholder}
                value={fontInputValue}
                disabled={!hasTextSelection}
                onChange={(event) => setFontInputValue(event.currentTarget.value)}
                onBlur={commitFontInput}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitFontInput();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setFontInputValue(fontSizeValue);
                    event.currentTarget.blur();
                  }
                }}
              />
              <span className="toolbar-number-suffix">pt</span>
            </div>
            <button
              type="button"
              className="toolbar-btn toolbar-btn--compact"
              onClick={() => onFontSizeStep(0.5)}
              title="Increase font size"
              disabled={!hasTextSelection}
            >
              <span className="toolbar-btn-text">A+</span>
            </button>
            <div className="toolbar-size-cluster__divider" />
            <button
              type="button"
              className="toolbar-btn toolbar-btn--fit"
              onClick={onAutoFit}
              title="Auto-fit text to block"
              disabled={!hasTextSelection}
            >
              <FitIcon />
              <span className="toolbar-btn-label">Fit</span>
            </button>
          </div>
        </div>
        <div className="editor-toolbar-subseparator" aria-hidden="true" />
        <button
          type="button"
          className={`toolbar-btn${selectedWeight === 'bold' ? ' toolbar-btn--active' : ''}`}
          onClick={() => onWeightChange(selectedWeight === 'bold' ? 'normal' : 'bold')}
          title="Bold"
          aria-pressed={selectedWeight === 'bold'}
          disabled={!hasTextSelection}
        >
          <span className="toolbar-btn-text toolbar-btn-text--bold">B</span>
        </button>
        <div className="editor-toolbar-subseparator" aria-hidden="true" />
        <div className={`editor-toolbar-cluster${hasTextSelection ? '' : ' editor-toolbar-cluster--disabled'}`} role="group" aria-label="Text alignment">
          <button
            type="button"
            className={`toolbar-btn${selectedAlignment === 'left' ? ' toolbar-btn--active' : ''}`}
            onClick={() => onAlignmentChange('left')}
            title="Align left"
            disabled={!hasTextSelection}
          >
            <AlignmentIcon mode="left" />
          </button>
          <button
            type="button"
            className={`toolbar-btn${selectedAlignment === 'center' ? ' toolbar-btn--active' : ''}`}
            onClick={() => onAlignmentChange('center')}
            title="Align center"
            disabled={!hasTextSelection}
          >
            <AlignmentIcon mode="center" />
          </button>
          <button
            type="button"
            className={`toolbar-btn${selectedAlignment === 'right' ? ' toolbar-btn--active' : ''}`}
            onClick={() => onAlignmentChange('right')}
            title="Align right"
            disabled={!hasTextSelection}
          >
            <AlignmentIcon mode="right" />
          </button>
          <button
            type="button"
            className={`toolbar-btn${selectedAlignment === 'justify' ? ' toolbar-btn--active' : ''}`}
            onClick={() => onAlignmentChange('justify')}
            title="Justify"
            disabled={!hasTextSelection}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M2.5 4h11" />
              <path d="M2.5 7h11" />
              <path d="M2.5 10h11" />
              <path d="M2.5 13h11" />
            </svg>
          </button>
        </div>
        <div className="editor-toolbar-subseparator" aria-hidden="true" />
        <button
          type="button"
          className={`toolbar-btn${selectedWrapMode === 'word' ? ' toolbar-btn--active' : ''}`}
          onClick={() => onWrapModeChange(selectedWrapMode === 'word' ? 'none' : 'word')}
          title={selectedWrapMode === 'word' ? 'Disable word wrap' : 'Enable word wrap'}
          aria-pressed={selectedWrapMode === 'word'}
          disabled={!hasTextSelection}
        >
          <WrapIcon />
          <span className="toolbar-btn-label">Wrap</span>
        </button>
      </div>
    </div>
  );
}
