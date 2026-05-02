import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseInspectArgs(argv) {
  const args = {
    pdf: '',
    pages: [],
    blocks: [],
    url: 'http://127.0.0.1:8766',
    source: 'Hebrew',
    target: 'English',
    documentAlternatives: false,
    documentCandidate: '',
    mirror: true,
    autoNudge: true,
    repairVerticalOverflow: true,
    useBucketFontRatio: true,
    preserveVerticalSourceAnchor: false,
    useTightTextBBox: false,
    detectLogos: false,
    protectVisualRegions: true,
    reconstructMixedBidiLines: false,
    enableTesseractOcr: true,
    debugInspections: true,
    mergeContinuationBlocks: false,
    browserTranslatorTimeoutMs: null,
    mockTranslations: '',
    autoMockTranslations: true,
    exportTranslations: '',
    waitMs: 1500,
    toggleQ: true,
    headed: false,
    help: false,
    preHooks: [],
    postHooks: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') {
      args.help = true;
      continue;
    }
    if (token === '--headed') {
      args.headed = true;
      continue;
    }
    if (token === '--no-toggle-q') {
      args.toggleQ = false;
      continue;
    }
    if (token === '--pdf') {
      args.pdf = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--block') {
      args.blocks.push(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (token === '--page') {
      const parsed = Number(argv[index + 1] || '');
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --page value: ${String(argv[index + 1] || '')}`);
      }
      args.pages.push(parsed);
      index += 1;
      continue;
    }
    if (token === '--url') {
      args.url = String(argv[index + 1] || args.url);
      index += 1;
      continue;
    }
    if (token === '--source') {
      args.source = String(argv[index + 1] || args.source);
      index += 1;
      continue;
    }
    if (token === '--target') {
      args.target = String(argv[index + 1] || args.target);
      index += 1;
      continue;
    }
    if (token === '--document-candidate') {
      args.documentCandidate = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--document-alternatives') {
      args.documentAlternatives = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--mirror') {
      args.mirror = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--auto-nudge') {
      args.autoNudge = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--repair-vertical-overflow') {
      args.repairVerticalOverflow = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--use-bucket-font-ratio') {
      args.useBucketFontRatio = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--preserve-vertical-source-anchor') {
      args.preserveVerticalSourceAnchor = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--use-tight-text-bbox') {
      args.useTightTextBBox = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--detect-logos') {
      args.detectLogos = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--protect-visual-regions') {
      args.protectVisualRegions = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--reconstruct-mixed-bidi-lines') {
      args.reconstructMixedBidiLines = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--enable-tesseract-ocr') {
      args.enableTesseractOcr = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--debug-inspections') {
      args.debugInspections = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--merge-continuation-blocks') {
      args.mergeContinuationBlocks = String(argv[index + 1] || 'true').toLowerCase() !== 'false';
      index += 1;
      continue;
    }
    if (token === '--browser-translator-timeout-ms') {
      const parsed = Number(argv[index + 1] || '');
      args.browserTranslatorTimeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      index += 1;
      continue;
    }
    if (token === '--mock-translations') {
      args.mockTranslations = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--no-auto-mock-translations') {
      args.autoMockTranslations = false;
      continue;
    }
    if (token === '--export-translations') {
      args.exportTranslations = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--wait-ms') {
      args.waitMs = Math.max(0, Number(argv[index + 1] || args.waitMs) || args.waitMs);
      index += 1;
      continue;
    }
    if (token === '--pre-hook') {
      args.preHooks.push(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (token === '--post-hook') {
      args.postHooks.push(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

export function resolvePathFromCwd(inputPath, cwd = process.cwd()) {
  if (!inputPath) return '';
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
}

export function resolveDefaultMockTranslationsPath(pdfPath, fixturesDir) {
  if (!pdfPath || !fixturesDir) return '';
  const pdfBaseName = path.basename(String(pdfPath), path.extname(String(pdfPath)));
  if (!pdfBaseName) return '';
  return path.resolve(fixturesDir, `${pdfBaseName}.browser-translator.json`);
}

export async function runInspectHook(hookPath, context) {
  const absPath = resolvePathFromCwd(hookPath);
  if (!absPath) {
    throw new Error('Hook path is empty.');
  }
  const hookModule = await import(pathToFileURL(absPath).href);
  const hookFn = typeof hookModule.default === 'function'
    ? hookModule.default
    : (typeof hookModule.run === 'function' ? hookModule.run : null);
  if (!hookFn) {
    throw new Error(`Hook module must export a default function or named run(): ${absPath}`);
  }
  const result = await hookFn(context);
  return result == null ? null : result;
}
