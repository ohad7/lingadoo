import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlannedCandidateConfigs,
  collectSuspiciousPageIds,
  evaluateDocumentQuality,
} from '../../src/lib/document-runs/documentQualityPlanner.js';

test('collectSuspiciousPageIds returns page ids with extraction warnings', () => {
  assert.deepEqual(
    collectSuspiciousPageIds([
      { page_id: 1, extraction_warning: null },
      { page_id: 2, extraction_warning: { suspicious: true, reasons: ['replacement_chars'] } },
      { page_id: 3, extraction_warning: { suspicious: false, reasons: [] } },
    ]),
    [2],
  );
});

test('evaluateDocumentQuality stays on the direct-open path for healthy docs', () => {
  const decision = evaluateDocumentQuality({
    requestedPages: [1, 2],
    detectedTextLayouts: [
      { page_id: 1, extraction_warning: null },
      { page_id: 2, extraction_warning: null },
    ],
    detectedTextSupportedPageIds: [1, 2],
    detectedTextSkippedPageIds: [],
    alternativesEnabled: true,
    mirrorEnabled: true,
  });

  assert.equal(decision.shouldOpenDirectly, true);
  assert.equal(decision.shouldRunAlternatives, false);
  assert.equal(decision.suppressMainCandidate, false);
  assert.equal(decision.recommendedCandidateId, 'main-detected-text');
});

test('evaluateDocumentQuality routes suspicious docs into alternative candidates', () => {
  const decision = evaluateDocumentQuality({
    requestedPages: [1],
    detectedTextLayouts: [
      { page_id: 1, extraction_warning: { suspicious: true, reasons: ['replacement_chars'] } },
    ],
    detectedTextSupportedPageIds: [1],
    detectedTextSkippedPageIds: [],
    alternativesEnabled: true,
    mirrorEnabled: true,
  });

  assert.equal(decision.shouldOpenDirectly, false);
  assert.equal(decision.shouldRunAlternatives, true);
  assert.equal(decision.suppressMainCandidate, false);
  assert.equal(decision.recommendedCandidateId, 'ocr-grouped-mirrored');
  assert.deepEqual(decision.reasons, ['suspicious_extraction']);
});

test('buildPlannedCandidateConfigs includes OCR alternatives for suspicious mirrored docs', () => {
  const configs = buildPlannedCandidateConfigs({
    qualityDecision: {
      shouldRunAlternatives: true,
      suppressMainCandidate: false,
    },
    mirrorEnabled: true,
    repairVerticalOverflowEnabled: true,
  });

  assert.deepEqual(
    configs.map((candidate) => candidate.id),
    ['main-detected-text', 'ocr-grouped', 'ocr-grouped-mirrored'],
  );
});

test('buildPlannedCandidateConfigs suppresses the main candidate when quality says it is unusable', () => {
  const configs = buildPlannedCandidateConfigs({
    qualityDecision: {
      shouldRunAlternatives: true,
      suppressMainCandidate: true,
    },
    mirrorEnabled: false,
    repairVerticalOverflowEnabled: true,
  });

  assert.deepEqual(
    configs.map((candidate) => candidate.id),
    ['ocr-grouped'],
  );
});
