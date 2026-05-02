import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseInspectArgs,
  resolveDefaultMockTranslationsPath,
  resolvePathFromCwd,
  runInspectHook,
} from '../../scripts/inspect_editor_state_lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('parseInspectArgs captures pre and post hook paths', () => {
  const args = parseInspectArgs([
    '--pdf', '../tests/documents/report_1_test.pdf',
    '--page', '1',
    '--page', '3',
    '--block', 'p1_b17',
    '--block', 'p1_b39',
    '--document-alternatives', 'true',
    '--document-candidate', 'ocr-grouped-mirrored',
    '--pre-hook', './scripts/pre_hook.mjs',
    '--post-hook', './scripts/post_hook_a.mjs',
    '--post-hook', './scripts/post_hook_b.mjs',
    '--no-toggle-q',
    '--mirror', 'false',
    '--auto-nudge', 'false',
    '--repair-vertical-overflow', 'true',
    '--use-bucket-font-ratio', 'true',
    '--preserve-vertical-source-anchor', 'true',
    '--use-tight-text-bbox', 'true',
    '--detect-logos', 'true',
    '--protect-visual-regions', 'true',
    '--reconstruct-mixed-bidi-lines', 'true',
    '--enable-tesseract-ocr', 'true',
    '--debug-inspections', 'true',
    '--merge-continuation-blocks', 'true',
    '--browser-translator-timeout-ms', '20000',
    '--mock-translations', './tests/node/fixtures/report_1_test.browser-translator.json',
    '--export-translations', './tmp/out.json',
    '--wait-ms', '2200',
  ]);

  assert.equal(args.pdf, '../tests/documents/report_1_test.pdf');
  assert.deepEqual(args.pages, [1, 3]);
  assert.deepEqual(args.blocks, ['p1_b17', 'p1_b39']);
  assert.equal(args.documentAlternatives, true);
  assert.equal(args.documentCandidate, 'ocr-grouped-mirrored');
  assert.deepEqual(args.preHooks, ['./scripts/pre_hook.mjs']);
  assert.deepEqual(args.postHooks, ['./scripts/post_hook_a.mjs', './scripts/post_hook_b.mjs']);
  assert.equal(args.toggleQ, false);
  assert.equal(args.mirror, false);
  assert.equal(args.autoNudge, false);
  assert.equal(args.repairVerticalOverflow, true);
  assert.equal(args.useBucketFontRatio, true);
  assert.equal(args.preserveVerticalSourceAnchor, true);
  assert.equal(args.useTightTextBBox, true);
  assert.equal(args.detectLogos, true);
  assert.equal(args.protectVisualRegions, true);
  assert.equal(args.reconstructMixedBidiLines, true);
  assert.equal(args.enableTesseractOcr, true);
  assert.equal(args.debugInspections, true);
  assert.equal(args.mergeContinuationBlocks, true);
  assert.equal(args.browserTranslatorTimeoutMs, 20000);
  assert.equal(args.mockTranslations, './tests/node/fixtures/report_1_test.browser-translator.json');
  assert.equal(args.autoMockTranslations, true);
  assert.equal(args.exportTranslations, './tmp/out.json');
  assert.equal(args.waitMs, 2200);
});

test('parseInspectArgs defaults bucket font ratio on', () => {
  const args = parseInspectArgs([
    '--pdf', '../tests/documents/report_1_test.pdf',
  ]);

  assert.equal(args.useBucketFontRatio, true);
  assert.equal(args.repairVerticalOverflow, true);
  assert.equal(args.preserveVerticalSourceAnchor, false);
  assert.equal(args.useTightTextBBox, false);
  assert.equal(args.detectLogos, false);
  assert.equal(args.protectVisualRegions, true);
  assert.equal(args.reconstructMixedBidiLines, false);
  assert.equal(args.enableTesseractOcr, true);
  assert.equal(args.debugInspections, true);
  assert.equal(args.mergeContinuationBlocks, false);
  assert.equal(args.autoMockTranslations, true);
  assert.equal(args.documentAlternatives, false);
  assert.equal(args.documentCandidate, '');
  assert.deepEqual(args.pages, []);
});

test('parseInspectArgs can disable automatic mock translation lookup', () => {
  const args = parseInspectArgs([
    '--pdf', '../tests/documents/report_1_test.pdf',
    '--no-auto-mock-translations',
  ]);

  assert.equal(args.autoMockTranslations, false);
});

test('runInspectHook executes named run export with inspection context', async () => {
  const hookPath = path.join(__dirname, 'fixtures', 'inspectEditorStateHook.mjs');
  const result = await runInspectHook(hookPath, {
    args: {
      pdf: '/tmp/report_1_test.pdf',
      blocks: ['hook-block'],
    },
    consoleLines: ['[info] example'],
    collectOverlayState: async () => ({ nudgedBlockCount: 3, ghostCount: 2 }),
    collectBlockSnapshot: async (blockId) => ({ blockId, found: true, fontSizeInput: 8.2 }),
  });

  assert.deepEqual(result, {
    pdf: '/tmp/report_1_test.pdf',
    blocks: ['hook-block'],
    overlay: { nudgedBlockCount: 3, ghostCount: 2 },
    block: { blockId: 'hook-block', found: true, fontSizeInput: 8.2 },
    consoleCount: 1,
  });
});

test('resolvePathFromCwd keeps absolute paths and resolves relative paths', () => {
  const cwd = path.join('/tmp', 'lingadoo', 'app');
  assert.equal(resolvePathFromCwd('/tmp/example.pdf', cwd), '/tmp/example.pdf');
  assert.equal(
    resolvePathFromCwd('./scripts/hook.mjs', cwd),
    path.join(cwd, 'scripts', 'hook.mjs'),
  );
});

test('resolveDefaultMockTranslationsPath maps a pdf name to the matching browser translation fixture', () => {
  const repoRoot = path.join('/tmp', 'lingadoo');
  assert.equal(
    resolveDefaultMockTranslationsPath(
      path.join(repoRoot, 'tests', 'documents', 'report_1_test.pdf'),
      path.join(repoRoot, 'tests', 'node', 'fixtures'),
    ),
    path.join(repoRoot, 'tests', 'node', 'fixtures', 'report_1_test.browser-translator.json'),
  );
});
