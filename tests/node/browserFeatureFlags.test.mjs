import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBooleanSearchParam,
  parseNumberSearchParam,
  parseStringSearchParam,
  resolveAutoNudgeEnabledFromSearch,
  resolveRepairVerticalOverflowEnabledFromSearch,
  resolvePreserveVerticalSourceAnchorEnabledFromSearch,
  resolveUseTightTextBBoxEnabledFromSearch,
  resolveUseBucketFontRatioEnabledFromSearch,
  resolveEnableTesseractOcrFromSearch,
  resolveDetectLogosEnabledFromSearch,
  resolveProtectVisualRegionsEnabledFromSearch,
  resolveDefaultReconstructMixedBidiLinesEnabled,
  resolveReconstructMixedBidiLinesEnabledFromSearch,
  resolveDebugInspectionsEnabledFromSearch,
  resolveDocumentAlternativesEnabledFromSearch,
  resolveBrowserTranslatorTimeoutMsFromSearch,
  resolveDocumentCandidateOverrideFromSearch,
  resolveProgressToneFromSearch,
  resolveMergeContinuationBlocksEnabledFromSearch,
} from '../../src/lib/browserFeatureFlags.js';

test('parseBooleanSearchParam reads explicit boolean url flags', () => {
  assert.equal(parseBooleanSearchParam('?autoNudge=1', 'autoNudge', false), true);
  assert.equal(parseBooleanSearchParam('?autoNudge=true', 'autoNudge', false), true);
  assert.equal(parseBooleanSearchParam('?autoNudge=0', 'autoNudge', true), false);
  assert.equal(parseBooleanSearchParam('?autoNudge=false', 'autoNudge', true), false);
});

test('resolveAutoNudgeEnabledFromSearch defaults on when flag is absent', () => {
  assert.equal(resolveAutoNudgeEnabledFromSearch(''), true);
  assert.equal(resolveAutoNudgeEnabledFromSearch('?mirror=1'), true);
});

test('resolveRepairVerticalOverflowEnabledFromSearch defaults on when flag is absent', () => {
  assert.equal(resolveRepairVerticalOverflowEnabledFromSearch(''), true);
  assert.equal(resolveRepairVerticalOverflowEnabledFromSearch('?repairVerticalOverflow=1'), true);
  assert.equal(resolveRepairVerticalOverflowEnabledFromSearch('?repairVerticalOverflow=0'), false);
});

test('resolveUseBucketFontRatioEnabledFromSearch defaults on when flag is absent', () => {
  assert.equal(resolveUseBucketFontRatioEnabledFromSearch(''), true);
  assert.equal(resolveUseBucketFontRatioEnabledFromSearch('?useBucketFontRatio=0'), false);
  assert.equal(resolveUseBucketFontRatioEnabledFromSearch('?useBucketFontRatio=1'), true);
});

test('resolvePreserveVerticalSourceAnchorEnabledFromSearch defaults off when flag is absent', () => {
  assert.equal(resolvePreserveVerticalSourceAnchorEnabledFromSearch(''), false);
  assert.equal(resolvePreserveVerticalSourceAnchorEnabledFromSearch('?preserveVerticalSourceAnchor=1'), true);
  assert.equal(resolvePreserveVerticalSourceAnchorEnabledFromSearch('?preserveVerticalSourceAnchor=0'), false);
});

test('resolveUseTightTextBBoxEnabledFromSearch defaults off when flag is absent', () => {
  assert.equal(resolveUseTightTextBBoxEnabledFromSearch(''), false);
  assert.equal(resolveUseTightTextBBoxEnabledFromSearch('?useTightTextBbox=1'), true);
  assert.equal(resolveUseTightTextBBoxEnabledFromSearch('?useTightTextBbox=0'), false);
});

test('resolveEnableTesseractOcrFromSearch defaults on when flag is absent', () => {
  assert.equal(resolveEnableTesseractOcrFromSearch(''), true);
  assert.equal(resolveEnableTesseractOcrFromSearch('?enableTesseractOcr=1'), true);
  assert.equal(resolveEnableTesseractOcrFromSearch('?enableTesseractOcr=0'), false);
});

test('resolveDetectLogosEnabledFromSearch defaults off when flag is absent', () => {
  assert.equal(resolveDetectLogosEnabledFromSearch(''), false);
  assert.equal(resolveDetectLogosEnabledFromSearch('?detectLogos=1'), true);
  assert.equal(resolveDetectLogosEnabledFromSearch('?detectLogos=0'), false);
});

test('resolveProtectVisualRegionsEnabledFromSearch defaults on when flag is absent', () => {
  assert.equal(resolveProtectVisualRegionsEnabledFromSearch(''), true);
  assert.equal(resolveProtectVisualRegionsEnabledFromSearch('?protectVisualRegions=1'), true);
  assert.equal(resolveProtectVisualRegionsEnabledFromSearch('?protectVisualRegions=0'), false);
});

test('resolveReconstructMixedBidiLinesEnabledFromSearch defaults off when flag is absent', () => {
  assert.equal(resolveReconstructMixedBidiLinesEnabledFromSearch(''), false);
  assert.equal(resolveReconstructMixedBidiLinesEnabledFromSearch('', true), true);
  assert.equal(resolveReconstructMixedBidiLinesEnabledFromSearch('?reconstructMixedBidiLines=1'), true);
  assert.equal(resolveReconstructMixedBidiLinesEnabledFromSearch('?reconstructMixedBidiLines=0'), false);
});

test('resolveDefaultReconstructMixedBidiLinesEnabled only defaults on for rtl edit mode', () => {
  assert.equal(resolveDefaultReconstructMixedBidiLinesEnabled({ appMode: 'edit', sourceLanguageCode: 'he' }), true);
  assert.equal(resolveDefaultReconstructMixedBidiLinesEnabled({ appMode: 'edit', sourceLanguageCode: 'ar' }), true);
  assert.equal(resolveDefaultReconstructMixedBidiLinesEnabled({ appMode: 'edit', sourceLanguageCode: 'en' }), false);
  assert.equal(resolveDefaultReconstructMixedBidiLinesEnabled({ appMode: 'translate', sourceLanguageCode: 'he' }), false);
});

test('resolveDebugInspectionsEnabledFromSearch defaults off when flag is absent', () => {
  assert.equal(resolveDebugInspectionsEnabledFromSearch(''), false);
  assert.equal(resolveDebugInspectionsEnabledFromSearch('?debugInspections=1'), true);
  assert.equal(resolveDebugInspectionsEnabledFromSearch('?debugInspections=0'), false);
});

test('resolveDocumentAlternativesEnabledFromSearch defaults on when flag is absent', () => {
  assert.equal(resolveDocumentAlternativesEnabledFromSearch(''), true);
  assert.equal(resolveDocumentAlternativesEnabledFromSearch('?documentAlternatives=1'), true);
  assert.equal(resolveDocumentAlternativesEnabledFromSearch('?documentAlternatives=0'), false);
});

test('resolveMergeContinuationBlocksEnabledFromSearch defaults off when flag is absent', () => {
  assert.equal(resolveMergeContinuationBlocksEnabledFromSearch(''), false);
  assert.equal(resolveMergeContinuationBlocksEnabledFromSearch('?mergeContinuationBlocks=1'), true);
  assert.equal(resolveMergeContinuationBlocksEnabledFromSearch('?mergeContinuationBlocks=0'), false);
});

test('resolveProgressToneFromSearch defaults to silly when flag is absent', () => {
  assert.equal(resolveProgressToneFromSearch(''), 'silly');
  assert.equal(resolveProgressToneFromSearch('?progressTone=playful'), 'playful');
  assert.equal(resolveProgressToneFromSearch('?progressTone=calm'), 'calm');
  assert.equal(resolveProgressToneFromSearch('?progressTone=bogus'), 'silly');
});

test('parseNumberSearchParam reads explicit numeric url flags', () => {
  assert.equal(parseNumberSearchParam('?browserTranslatorTimeoutMs=20000', 'browserTranslatorTimeoutMs', null), 20000);
  assert.equal(parseNumberSearchParam('?browserTranslatorTimeoutMs=bogus', 'browserTranslatorTimeoutMs', 5000), 5000);
});

test('parseStringSearchParam reads explicit string url flags', () => {
  assert.equal(parseStringSearchParam('?documentCandidate=ocr-grouped', 'documentCandidate', ''), 'ocr-grouped');
  assert.equal(parseStringSearchParam('?documentCandidate=ocr-grouped-mirrored', 'documentCandidate', ''), 'ocr-grouped-mirrored');
  assert.equal(parseStringSearchParam('?documentCandidate=', 'documentCandidate', 'fallback'), 'fallback');
});

test('resolveBrowserTranslatorTimeoutMsFromSearch defaults to null when absent', () => {
  assert.equal(resolveBrowserTranslatorTimeoutMsFromSearch(''), null);
  assert.equal(resolveBrowserTranslatorTimeoutMsFromSearch('?browserTranslatorTimeoutMs=12000'), 12000);
});

test('resolveDocumentCandidateOverrideFromSearch accepts known candidate ids only', () => {
  assert.equal(resolveDocumentCandidateOverrideFromSearch(''), null);
  assert.equal(resolveDocumentCandidateOverrideFromSearch('?documentCandidate=ocr-grouped'), 'ocr-grouped');
  assert.equal(resolveDocumentCandidateOverrideFromSearch('?documentCandidate=ocr-grouped-mirrored'), 'ocr-grouped-mirrored');
  assert.equal(resolveDocumentCandidateOverrideFromSearch('?documentCandidate=main-detected-text'), 'main-detected-text');
  assert.equal(resolveDocumentCandidateOverrideFromSearch('?documentCandidate=bogus'), null);
});
