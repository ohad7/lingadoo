import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDocumentCandidateConfigsForOverride,
  buildDefaultDocumentCandidateConfigs,
  buildMainDetectedTextCandidateConfig,
  buildOcrGroupedCandidateConfig,
  buildOcrGroupedMirroredCandidateConfig,
  MAIN_DETECTED_TEXT_CANDIDATE_ID,
  OCR_GROUPED_CANDIDATE_ID,
  OCR_GROUPED_MIRRORED_CANDIDATE_ID,
} from '../../src/lib/document-runs/candidateRunCatalog.js';
import {
  OCR_INPUT_RENDER_SCALE,
  resolveDocumentRunDecision,
  shouldDetectPageBarriers,
  shouldRenderTextlessPagePreviews,
} from '../../src/lib/document-runs/candidateRunEngine.js';

test('buildMainDetectedTextCandidateConfig captures the current browser candidate defaults', () => {
  assert.deepEqual(
    buildMainDetectedTextCandidateConfig({
      mirrorEnabled: false,
      preserveVerticalSourceAnchorEnabled: true,
      useTightTextBBoxEnabled: true,
      repairVerticalOverflowEnabled: true,
      useBucketFontRatioEnabled: true,
    }),
    {
      id: MAIN_DETECTED_TEXT_CANDIDATE_ID,
      internalLabel: 'Main detected text',
      extractionProfile: 'detected-text',
      mirrorMode: 'forced-off',
      fitProfile: 'bucket-ratio',
      preserveVerticalSourceAnchor: true,
      useTightTextBbox: true,
      repairVerticalOverflow: true,
      restoreImageOrientations: true,
    },
  );
});

test('buildDefaultDocumentCandidateConfigs returns the single current main candidate', () => {
  const configs = buildDefaultDocumentCandidateConfigs({
    mirrorEnabled: true,
    repairVerticalOverflowEnabled: false,
  });

  assert.equal(configs.length, 1);
  assert.equal(configs[0].id, MAIN_DETECTED_TEXT_CANDIDATE_ID);
  assert.equal(configs[0].mirrorMode, 'forced-on');
  assert.equal(configs[0].repairVerticalOverflow, false);
});

test('buildOcrGroupedCandidateConfig captures the OCR grouped fallback candidate defaults', () => {
  assert.deepEqual(
    buildOcrGroupedCandidateConfig({
      repairVerticalOverflowEnabled: true,
    }),
    {
      id: OCR_GROUPED_CANDIDATE_ID,
      internalLabel: 'OCR grouped',
      extractionProfile: 'ocr-grouped',
      mirrorMode: 'forced-off',
      fitProfile: 'bucket-ratio',
      preserveVerticalSourceAnchor: false,
      useTightTextBbox: false,
      repairVerticalOverflow: true,
      restoreImageOrientations: false,
    },
  );
  assert.equal(
    buildOcrGroupedCandidateConfig({
      mirrorEnabled: true,
      repairVerticalOverflowEnabled: false,
    }).mirrorMode,
    'forced-off',
  );
});

test('buildOcrGroupedMirroredCandidateConfig captures the mirrored OCR grouped candidate defaults', () => {
  assert.deepEqual(
    buildOcrGroupedMirroredCandidateConfig({
      repairVerticalOverflowEnabled: true,
    }),
    {
      id: OCR_GROUPED_MIRRORED_CANDIDATE_ID,
      internalLabel: 'OCR grouped mirrored',
      extractionProfile: 'ocr-grouped',
      mirrorMode: 'forced-on',
      fitProfile: 'bucket-ratio',
      preserveVerticalSourceAnchor: false,
      useTightTextBbox: false,
      repairVerticalOverflow: true,
      restoreImageOrientations: false,
    },
  );
});

test('buildDocumentCandidateConfigsForOverride resolves known override ids', () => {
  assert.equal(buildDocumentCandidateConfigsForOverride('ocr-grouped')[0].id, OCR_GROUPED_CANDIDATE_ID);
  assert.equal(buildDocumentCandidateConfigsForOverride('ocr-grouped-mirrored')[0].id, OCR_GROUPED_MIRRORED_CANDIDATE_ID);
  assert.equal(buildDocumentCandidateConfigsForOverride('main-detected-text')[0].id, MAIN_DETECTED_TEXT_CANDIDATE_ID);
  assert.equal(buildDocumentCandidateConfigsForOverride('bogus')[0].id, MAIN_DETECTED_TEXT_CANDIDATE_ID);
});

test('resolveDocumentRunDecision opens directly when there is one candidate', () => {
  assert.deepEqual(
    resolveDocumentRunDecision([{ id: 'main-detected-text' }], { recommendedCandidateId: 'main-detected-text' }),
    {
      mode: 'direct-open',
      candidateId: 'main-detected-text',
      recommendedCandidateId: 'main-detected-text',
    },
  );
});

test('resolveDocumentRunDecision requires a chooser when multiple candidates exist', () => {
  assert.deepEqual(
    resolveDocumentRunDecision([{ id: 'a' }, { id: 'b' }], { recommendedCandidateId: 'b' }),
    {
      mode: 'choose-candidate',
      candidateIds: ['a', 'b'],
      recommendedCandidateId: 'b',
    },
  );
});

test('OCR input render scale targets 240 DPI', () => {
  assert.equal(OCR_INPUT_RENDER_SCALE, 240 / 72);
});

test('mergeContinuationBlocks enables page barrier detection even when debug inspection is off', () => {
  assert.equal(
    shouldDetectPageBarriers({
      debugInspectionsEnabled: false,
      useBarrierDetectionEnabled: false,
      mergeContinuationBlocksEnabled: true,
    }),
    true,
  );
});

test('mergeContinuationBlocks requests textless previews when they are otherwise disabled', () => {
  assert.equal(
    shouldRenderTextlessPagePreviews({
      debugInspectionsEnabled: false,
      protectVisualRegionsEnabled: false,
      useBarrierDetectionEnabled: false,
      mergeContinuationBlocksEnabled: true,
    }),
    true,
  );
});
