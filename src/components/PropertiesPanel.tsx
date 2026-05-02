import type { PageBlock } from '../api/types';
import SegmentedControl from './SegmentedControl';
import { hexToRgb01 } from '../lib/colorUtils';

type PropertiesPanelProps = {
  selectedBlocks: PageBlock[];
  selectedGraphicRegionId: string;
  onUpdateOrientation: (orientation: 'horizontal' | 'vertical_ttb') => void;
  onUpdateTextColor: (color: string) => void;
  onUpdateBackgroundFill: (enabled: boolean, color?: number[]) => void;
  onUpdateText: (blockId: string, text: string) => void;
  onDelete: () => void;
  onJoin: () => void;
  onToggleFlip: () => void;
  onResetPosition: () => void;
  busy: boolean;
  docTextColors: string[];
  docBgColors: number[][];
};

function allSame<T>(values: T[]): boolean {
  return values.length > 0 && values.every((v) => v === values[0]);
}

export default function PropertiesPanel({
  selectedBlocks,
  selectedGraphicRegionId,
  onUpdateOrientation,
  onUpdateTextColor,
  onUpdateBackgroundFill,
  onUpdateText,
  onDelete,
  onJoin,
  onToggleFlip,
  onResetPosition,
  busy,
  docTextColors,
  docBgColors,
}: PropertiesPanelProps) {
  // Graphic region selected (no blocks)
  if (selectedGraphicRegionId && selectedBlocks.length === 0) {
    return (
      <div>
        <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 12px' }}>Visual Region</h3>
        <div className="prop-section">
          <button className="btn-secondary" type="button" onClick={onToggleFlip} disabled={busy} style={{ width: '100%', marginBottom: 8 }}>
            Toggle Flip
          </button>
          <button className="btn-secondary" type="button" onClick={onResetPosition} disabled={busy} style={{ width: '100%' }}>
            Reset Position
          </button>
        </div>
      </div>
    );
  }

  // Single text block selected
  if (selectedBlocks.length === 1 && !selectedGraphicRegionId) {
    const block = selectedBlocks[0];
    return (
      <div>
        <div className="prop-section">
          <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 12px' }}>Text Block</h3>
        </div>

        {block.source_text && (
          <div className="prop-section">
            <label className="prop-label">Original</label>
            <div
              className="prop-textarea"
              style={{ direction: 'rtl', background: 'var(--surface-alt)', cursor: 'default', minHeight: 'auto', fontSize: '12px', color: 'var(--ink-muted)' }}
            >
              {block.source_text}
            </div>
          </div>
        )}

        <div className="prop-section">
          <label className="prop-label">Translation</label>
          <textarea
            className="prop-textarea"
            value={block.text}
            onChange={(e) => onUpdateText(block.source_block_id, e.target.value)}
            rows={4}
            disabled={busy}
          />
        </div>

        <div className="prop-section">
          <label className="prop-label">Orientation</label>
          <SegmentedControl
            options={[
              { value: 'horizontal', label: 'Horizontal' },
              { value: 'vertical_ttb', label: 'Vertical' },
            ]}
            value={block.source_text_orientation || 'horizontal'}
            onChange={(v) => onUpdateOrientation(v as 'horizontal' | 'vertical_ttb')}
            disabled={busy}
          />
        </div>

        <div className="prop-section">
          <label className="prop-label">Appearance</label>
        </div>

        <div className="prop-section">
          <label className="prop-label">Text Color</label>
          <div className="color-swatches">
            {docTextColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch${(block.text_color || '').toLowerCase() === color ? ' color-swatch--active' : ''}`}
                style={{ background: color, border: color === '#ffffff' ? '2px solid var(--border)' : undefined }}
                onClick={() => onUpdateTextColor(color)}
                title={color}
                disabled={busy}
              />
            ))}
            <button
              type="button"
              className="color-swatch color-swatch--custom"
              title="Custom color"
              disabled={busy}
            >
              <input
                type="color"
                value={block.text_color || '#000000'}
                onChange={(e) => onUpdateTextColor(e.target.value)}
              />
            </button>
          </div>
        </div>

        <div className="prop-section">
          <label className="prop-label">Background Fill</label>
          <label className="prop-checkbox">
            <input
              type="checkbox"
              checked={Boolean(block.background_fill_enabled)}
              onChange={(e) => onUpdateBackgroundFill(e.target.checked)}
              disabled={busy}
            />
            <span>Enabled</span>
          </label>
          {block.background_fill_enabled ? (
            <div className="color-swatches" style={{ marginTop: 6 }}>
              {(docBgColors.length > 0 ? docBgColors : docTextColors.map((hex) => hexToRgb01(hex))).map((rgb) => {
                const cssColor = `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;
                return (
                  <button
                    key={cssColor}
                    type="button"
                    className="color-swatch"
                    style={{ background: cssColor }}
                    onClick={() => onUpdateBackgroundFill(true, rgb)}
                    title={cssColor}
                    disabled={busy}
                  />
                );
              })}
              <button
                type="button"
                className="color-swatch color-swatch--custom"
                title="Custom color"
                disabled={busy}
              >
                <input
                  type="color"
                  value={
                    Array.isArray(block.background_fill_color)
                      ? '#' + block.background_fill_color.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
                      : '#ffffff'
                  }
                  onChange={(e) => onUpdateBackgroundFill(true, hexToRgb01(e.target.value))}
                />
              </button>
            </div>
          ) : null}
        </div>

        <hr className="prop-divider" />

        <button className="btn-danger" type="button" onClick={onDelete} disabled={busy} style={{ width: '100%' }}>
          Delete Block
        </button>
      </div>
    );
  }

  // Multiple blocks selected
  if (selectedBlocks.length > 1) {
    const sharedOrientation = allSame(selectedBlocks.map((b) => b.source_text_orientation || 'horizontal')) ? (selectedBlocks[0].source_text_orientation || 'horizontal') : '';
    const sharedTextColor = allSame(selectedBlocks.map((b) => b.text_color || '#000000')) ? (selectedBlocks[0].text_color || '#000000') : '';

    return (
      <div>
        <div className="prop-section">
          <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 12px' }}>{selectedBlocks.length} blocks selected</h3>
        </div>

        <div className="prop-section">
          <label className="prop-label">Orientation</label>
          <SegmentedControl
            options={[
              { value: 'horizontal', label: 'Horizontal' },
              { value: 'vertical_ttb', label: 'Vertical' },
            ]}
            value={sharedOrientation}
            onChange={(v) => onUpdateOrientation(v as 'horizontal' | 'vertical_ttb')}
            disabled={busy}
          />
        </div>

        <div className="prop-section">
          <label className="prop-label">Appearance</label>
        </div>

        <div className="prop-section">
          <label className="prop-label">Text Color</label>
          <div className="color-swatches">
            {docTextColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch${sharedTextColor.toLowerCase() === color ? ' color-swatch--active' : ''}`}
                style={{ background: color, border: color === '#ffffff' ? '2px solid var(--border)' : undefined }}
                onClick={() => onUpdateTextColor(color)}
                title={color}
                disabled={busy}
              />
            ))}
            <button
              type="button"
              className="color-swatch color-swatch--custom"
              title="Custom color"
              disabled={busy}
            >
              <input
                type="color"
                value={sharedTextColor || '#000000'}
                onChange={(e) => onUpdateTextColor(e.target.value)}
              />
            </button>
          </div>
        </div>

        <hr className="prop-divider" />

        <button className="btn-secondary" type="button" onClick={onJoin} disabled={busy} style={{ width: '100%', marginBottom: 8 }}>
          Join Blocks
        </button>
        <button className="btn-danger" type="button" onClick={onDelete} disabled={busy} style={{ width: '100%' }}>
          Delete Blocks
        </button>
      </div>
    );
  }

  return null;
}
