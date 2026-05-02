import assert from 'node:assert/strict';
import test from 'node:test';

import { fitEditableBlockToBBox } from '../../src/lib/pdf-core/fitting.js';
import {
  buildJoinedBlockForFit,
  shouldRetranslateJoinedBlock,
} from '../../src/lib/localBlockMerge.js';

test('joined block re-translation triggers when visible text is target-language but source text is source-language', () => {
  assert.equal(shouldRetranslateJoinedBlock({
    mergedText: 'Quarterly report for the end of 2025',
    mergedSourceText: 'דוח רבעוני לסוף שנת 2025',
    sourceLanguageCode: 'he',
    targetLanguageCode: 'en',
  }), true);
});

test('joined block re-translation stays off when visible text is still source-language text', () => {
  assert.equal(shouldRetranslateJoinedBlock({
    mergedText: 'דוח רבעוני לסוף שנת 2025',
    mergedSourceText: 'דוח רבעוני לסוף שנת 2025',
    sourceLanguageCode: 'he',
    targetLanguageCode: 'en',
  }), false);
});

test('joined block fit preserves word-wrap and source font context', () => {
  const selected = [
    {
      source_block_id: 'p1_b18',
      text: 'בדוק אם',
      font_size: 6.828,
      source_font_size: 10.86,
      line_height: 8.1936,
      block_type: 'text_line',
      wrap_mode: 'word',
      source_clip_default: true,
      source_line_count: 1,
    },
    {
      source_block_id: 'p1_b20',
      text: 'סכומי הביטוח',
      font_size: 6.2293,
      source_font_size: 10.86,
      line_height: 7.4752,
      block_type: 'text_line',
      wrap_mode: 'word',
      source_clip_default: true,
      source_line_count: 1,
    },
  ];
  const joined = buildJoinedBlockForFit(selected[0], selected, {
    text: 'בדוק אם סכומי הביטוח שלך מתאימים לצרכיך',
    sourceText: 'בדוק אם סכומי הביטוח שלך מתאימים לצרכיך',
    bbox: [503.4859910354614, 202.1396942138672, 546.7056078109741, 252.07032318115233],
    sourceBBox: [53.29439218902588, 202.1396942138672, 96.51400896453857, 252.07032318115233],
  });
  const fit = fitEditableBlockToBBox(joined);
  assert.equal(joined.wrap_mode, 'word');
  assert.equal(joined.block_type, 'text_line');
  assert.equal(joined.bbox_edited, true);
  assert.equal(joined.source_font_size, 10.86);
  assert.ok(fit.fontSize > 7.5, `expected a larger join fit, got ${fit.fontSize}`);
  assert.equal(fit.overflow, false);
});
