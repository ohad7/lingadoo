import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFeatures, FEATURE_NAMES } from '../../src/lib/continuationFeatures.js';

function block(bbox, sourceText, opts = {}) {
  return {
    source_block_id: opts.id || 'test',
    bbox,
    source_text: sourceText,
    font_size: opts.font_size ?? 10,
    font_family: opts.font_family ?? 'Arial',
    block_type: opts.block_type ?? 'text_line',
  };
}

test('FEATURE_NAMES matches extractFeatures output length', () => {
  const a = block([100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין');
  const b = block([100, 22, 200, 32], 'כל אחת מהקרנות');
  const features = extractFeatures(a, b);
  assert.equal(features.length, FEATURE_NAMES.length);
});

test('dangling preposition feature fires for A ending with בגין', () => {
  const a = block([100, 10, 200, 20], 'בחלק זה מובאים נתונים בגין');
  const b = block([100, 22, 200, 32], 'כל אחת מהקרנות');
  const features = extractFeatures(a, b);
  const idx = FEATURE_NAMES.indexOf('dangling_preposition');
  assert.equal(features[idx], 1);
});

test('terminal punctuation feature fires for A ending with period', () => {
  const a = block([100, 10, 200, 20], 'המשפט הסתיים.');
  const b = block([100, 22, 200, 32], 'משפט חדש מתחיל כאן');
  const features = extractFeatures(a, b);
  const idx = FEATURE_NAMES.indexOf('ends_terminal_punct');
  assert.equal(features[idx], 1);
});

test('same_row feature fires for blocks on same visual row', () => {
  const a = block([200, 10, 300, 22], 'נתונים בגין');
  const b = block([100, 10, 195, 22], 'כל אחת');
  const features = extractFeatures(a, b);
  const idx = FEATURE_NAMES.indexOf('same_row');
  assert.equal(features[idx], 1);
});

test('both_short interaction feature fires when both blocks < 5 words', () => {
  const a = block([100, 10, 150, 20], 'תגמולי עובד');
  const b = block([160, 10, 210, 20], 'תגמולי מעסיק');
  const features = extractFeatures(a, b);
  const shortAIdx = FEATURE_NAMES.indexOf('short_a');
  const shortBIdx = FEATURE_NAMES.indexOf('short_b');
  const bothShortIdx = FEATURE_NAMES.indexOf('both_short');
  assert.equal(features[shortAIdx], 1);
  assert.equal(features[shortBIdx], 1);
  assert.equal(features[bothShortIdx], 1);
});

test('font_size_ratio is max/min of font sizes', () => {
  const a = block([100, 10, 200, 20], 'טקסט ארוך מספיק בעברית', { font_size: 10 });
  const b = block([100, 22, 200, 32], 'עוד טקסט בעברית כאן', { font_size: 15 });
  const features = extractFeatures(a, b);
  const idx = FEATURE_NAMES.indexOf('font_size_ratio');
  assert.equal(features[idx], 0.5); // max/min - 1: 15/10 - 1 = 0.5
});

test('vertical_gap_norm is gap divided by max block height', () => {
  const a = block([100, 10, 200, 20], 'טקסט ארוך מספיק בעברית');
  const b = block([100, 30, 200, 40], 'עוד טקסט בעברית כאן');
  const features = extractFeatures(a, b);
  const idx = FEATURE_NAMES.indexOf('vertical_gap_norm');
  // gap = 30 - 20 = 10, max height = 10, ratio = 1.0
  assert.equal(features[idx], 1.0);
});

test('both_hebrew is 0 when B has no Hebrew', () => {
  const a = block([100, 10, 200, 20], 'טקסט בעברית');
  const b = block([100, 22, 200, 32], '111,222');
  const features = extractFeatures(a, b);
  const idx = FEATURE_NAMES.indexOf('both_hebrew');
  assert.equal(features[idx], 0);
});
