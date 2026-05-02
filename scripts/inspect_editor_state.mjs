#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import net from 'node:net';

import { chromium } from 'playwright';
import {
  parseInspectArgs,
  resolvePathFromCwd,
  resolveDefaultMockTranslationsPath,
  runInspectHook,
} from './inspect_editor_state_lib.mjs';

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function startDevServer(port) {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const appDir = path.resolve(scriptDir, '..');
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  return child;
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Dev server did not become ready at ${url} within ${timeoutMs}ms`);
}

async function assertServerIdentity(baseUrl) {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const expectedAppDir = path.resolve(scriptDir, '..');
  const infoUrl = new URL('/__dev__/info', baseUrl).toString();
  try {
    const res = await fetch(infoUrl);
    if (!res.ok) {
      process.stderr.write(`Warning: /__dev__/info returned ${res.status} — cannot verify server identity\n`);
      return;
    }
    const info = await res.json();
    process.stderr.write(`Server info: cwd=${info.cwd} git=${info.git?.branch}@${info.git?.commit}${info.git?.dirty ? ' (dirty)' : ''} pid=${info.pid}\n`);
    if (path.resolve(info.cwd) !== path.resolve(expectedAppDir)) {
      throw new Error(
        `Dev server is running from ${info.cwd} but inspect script expects ${expectedAppDir}. ` +
        `The server may be stale. Kill it and re-run, or pass --url to use it explicitly.`
      );
    }
  } catch (err) {
    if (err.message?.includes('Dev server is running from')) throw err;
    process.stderr.write(`Warning: could not verify server identity: ${err.message}\n`);
  }
}

function killDevServer(child) {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
}

function printHelp() {
  process.stdout.write(`Usage: npm run inspect:browser -- --pdf <path> [options]

Options:
  --pdf <path>          PDF to upload. Required.
  --page <n>            Page number to select before translating. Repeatable.
  --block <id>          Block id to inspect. Repeatable.
  --url <url>           App URL. Default: http://127.0.0.1:8766
  --source <label>      Source language label. Default: Hebrew
  --target <label>      Target language label. Default: English
  --document-alternatives <bool>
                        Enable the document-level alternative candidate chooser. Default: false
  --document-candidate <id>
                        Force a document candidate id such as ocr-grouped or ocr-grouped-mirrored
  --mirror <true|false> Reverse layout direction. Default: true
  --auto-nudge <bool>   Enable post-fit auto-nudge in the editor session. Default: true
  --repair-vertical-overflow <bool>
                        Enable post-fit downward vertical overflow repair. Default: true
  --use-bucket-font-ratio <bool>
                        Use bucket-based nominal font sizing before auto-nudge. Default: true
  --preserve-vertical-source-anchor <bool>
                        Preserve source vertical text anchor for eligible tight single-line blocks. Default: false
  --use-tight-text-bbox <bool>
                        Apply the tight text bbox experiment to editor blocks. Default: false
  --detect-logos <bool>
                        Detect small top-edge logo candidates and show them in q debug overlay. Default: false
  --protect-visual-regions <bool>
                        Auto-unmirror graphic regions and strong raster logo candidates. Default: true
  --reconstruct-mixed-bidi-lines <bool>
                        Reorder mixed Hebrew/Latin detected-text lines before translation. Default: false
  --debug-inspections <bool>
                        Enable debug-only editor keyboard shortcuts like q / w / e / r. Default: true
  --merge-continuation-blocks <bool>
                        Merge conservative continuation pairs before translation. Default: false
  --browser-translator-timeout-ms <ms>
                        Override the browser Translator API timeout. Default: app default
  --mock-translations <path>
                        Inject a captured browser translation run JSON before upload
  --no-auto-mock-translations
                        Do not auto-load tests/node/fixtures/<pdf>.browser-translator.json
  --export-translations <path>
                        Save the browser translation run JSON after the editor opens
  --wait-ms <ms>        Extra wait after editor opens. Default: 1500
  --pre-hook <path>     JS module to run after editor opens, before built-in inspection.
  --post-hook <path>    JS module to run after built-in inspection. Repeatable.
  --no-toggle-q         Do not press q before collecting overlay counts.
  --headed              Launch visible Chrome instead of headless mode.
  --help                Show this help.

Examples:
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --page 1 --block p1_b39
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --block p1_b17 --block p1_b39 --headed
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --block p1_b17 --auto-nudge false
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --page 1 --merge-continuation-blocks true
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --block p1_b17 --browser-translator-timeout-ms 20000
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --browser-translator-timeout-ms 20000 --export-translations ./tests/node/fixtures/report_1_test.browser-translator.json
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --block p1_b17 --mock-translations ./tests/node/fixtures/report_1_test.browser-translator.json
  npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --pre-hook ./scripts/example_pre_hook.mjs --block p1_b39
`);
}

async function setSelectByText(page, label, value) {
  const select = page.getByLabel(label);
  if (await select.count() === 0) return;
  await select.selectOption({ label: value });
}

async function setMirrorCheckbox(page, enabled) {
  const checkbox = page.getByLabel('Reverse layout direction');
  if (await checkbox.count() === 0) return;
  if ((await checkbox.isChecked()) !== enabled) {
    await checkbox.click();
  }
}

async function setSelectedPages(page, selectedPages) {
  if (!Array.isArray(selectedPages) || selectedPages.length === 0) {
    return;
  }
  const uniquePages = [...new Set(selectedPages.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
  if (uniquePages.length === 0) {
    return;
  }
  await page.locator('.page-thumb').first().waitFor({ state: 'visible', timeout: 30000 });
  const noneButton = page.getByRole('button', { name: /^None$/ });
  if (await noneButton.count() > 0) {
    await noneButton.click();
    await page.waitForTimeout(100);
  }
  for (const pageNumber of uniquePages) {
    const pageButton = page.locator('.page-thumb').nth(pageNumber - 1);
    if (await pageButton.count() === 0) {
      throw new Error(`Unable to find page selector for page ${pageNumber}`);
    }
    await pageButton.click();
    await page.waitForTimeout(50);
  }
}

async function collectBlockSnapshot(page, blockId) {
  const block = page.locator(`.overlay-block[title^="${blockId} "]`).first();
  if (await block.count() === 0) {
    return { blockId, found: false };
  }

  await block.click();
  await page.waitForTimeout(100);

  const fontInput = page.locator('.editor-properties .prop-input[type="number"]').first();
  const translationArea = page.locator('.editor-properties textarea.prop-textarea').first();
  const originalBox = page.locator('.editor-properties .prop-section .prop-textarea').first();

  return page.evaluate(async ({ blockId }) => {
    const blockEl = document.querySelector(`.overlay-block[title^="${blockId} "]`);
    const readText = (node) => (node ? String(node.textContent || '').trim() : null);
    const fontField = document.querySelector('.editor-properties .prop-input[type="number"]');
    const textareas = [...document.querySelectorAll('.editor-properties textarea.prop-textarea')];
    const sourceTextNode = document.querySelector('.editor-properties .prop-section .prop-textarea');
    return {
      blockId,
      found: Boolean(blockEl),
      className: blockEl?.className || null,
      title: blockEl?.getAttribute('title') || null,
      style: blockEl?.getAttribute('style') || null,
      overlayText: readText(blockEl),
      fontSizeInput: fontField ? Number(fontField.value) : null,
      translationText: textareas.length > 0 ? String(textareas[textareas.length - 1].value || '') : null,
      originalText: textareas.length > 0 ? readText(sourceTextNode) : null,
      activeTag: document.activeElement?.tagName || null,
      activeClass: document.activeElement?.className || null,
    };
  }, { blockId });
}

async function main() {
  const args = parseInspectArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const pdfPath = resolvePathFromCwd(args.pdf);
  if (!pdfPath) {
    throw new Error('Missing required --pdf argument.');
  }
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const appDir = path.resolve(scriptDir, '..');
  const autoMockTranslationsPath = args.autoMockTranslations
    ? resolveDefaultMockTranslationsPath(pdfPath, path.resolve(appDir, 'tests', 'node', 'fixtures'))
    : '';
  const requestedMockTranslationsPath = resolvePathFromCwd(args.mockTranslations);
  const mockTranslationsPath = requestedMockTranslationsPath || autoMockTranslationsPath;
  const exportTranslationsPath = resolvePathFromCwd(args.exportTranslations);

  // Always start a fresh dev server from current code, unless --url is explicitly provided
  let devServerChild = null;
  let effectiveUrl = args.url;
  const userProvidedUrl = process.argv.slice(2).some((a) => a === '--url');
  if (!userProvidedUrl) {
    const port = await findAvailablePort();
    effectiveUrl = `http://localhost:${port}`;
    process.stderr.write(`Starting dev server on port ${port}...\n`);
    devServerChild = startDevServer(port);
    await waitForServer(effectiveUrl);
    process.stderr.write(`Dev server ready at ${effectiveUrl}\n`);
  }

  await assertServerIdentity(effectiveUrl);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.headed,
  });

  try {
    const page = await browser.newPage();
    if (mockTranslationsPath) {
      const mockFileExists = fs.existsSync(mockTranslationsPath);
      if (!mockFileExists && requestedMockTranslationsPath) {
        throw new Error(`Mock translations file not found: ${mockTranslationsPath}`);
      }
      if (mockFileExists) {
        if (!requestedMockTranslationsPath && args.autoMockTranslations) {
          process.stderr.write(`Auto-loading mock translations from ${mockTranslationsPath}\n`);
        }
        const mockTranslations = JSON.parse(fs.readFileSync(mockTranslationsPath, 'utf8'));
        await page.addInitScript((payload) => {
          window.__LINGADOO_MOCK_TRANSLATION_RUN__ = payload;
        }, mockTranslations);
      }
    }
    const consoleLines = [];
    page.on('console', (message) => {
      consoleLines.push(`[${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      consoleLines.push(`[pageerror] ${error instanceof Error ? error.stack || error.message : String(error)}`);
    });

    const pageUrl = new URL(effectiveUrl);
    pageUrl.searchParams.set('autoNudge', args.autoNudge ? '1' : '0');
    pageUrl.searchParams.set('repairVerticalOverflow', args.repairVerticalOverflow ? '1' : '0');
    pageUrl.searchParams.set('useBucketFontRatio', args.useBucketFontRatio ? '1' : '0');
    pageUrl.searchParams.set('preserveVerticalSourceAnchor', args.preserveVerticalSourceAnchor ? '1' : '0');
    pageUrl.searchParams.set('useTightTextBbox', args.useTightTextBBox ? '1' : '0');
    pageUrl.searchParams.set('detectLogos', args.detectLogos ? '1' : '0');
    pageUrl.searchParams.set('protectVisualRegions', args.protectVisualRegions ? '1' : '0');
    pageUrl.searchParams.set('reconstructMixedBidiLines', args.reconstructMixedBidiLines ? '1' : '0');
    pageUrl.searchParams.set('enableTesseractOcr', args.enableTesseractOcr ? '1' : '0');
    pageUrl.searchParams.set('debugInspections', args.debugInspections ? '1' : '0');
    pageUrl.searchParams.set('documentAlternatives', args.documentAlternatives ? '1' : '0');
    pageUrl.searchParams.set('mergeContinuationBlocks', args.mergeContinuationBlocks ? '1' : '0');
    if (args.documentCandidate) {
      pageUrl.searchParams.set('documentCandidate', String(args.documentCandidate));
    }
    if (args.browserTranslatorTimeoutMs != null) {
      pageUrl.searchParams.set('browserTranslatorTimeoutMs', String(args.browserTranslatorTimeoutMs));
    }
    const collectOverlayState = () => page.evaluate(() => ({
      activeTag: document.activeElement?.tagName || null,
      overlayBlockCount: document.querySelectorAll('.overlay-block').length,
      nudgedBlockCount: document.querySelectorAll('.overlay-block.nudged').length,
      bidiReconstructedDebugCount: document.querySelectorAll('.overlay-block.bidi-reconstructed-debug').length,
      logoDebugCount: document.querySelectorAll('.logo-debug-region').length,
      ghostCount: document.querySelectorAll('.nudge-ghost').length,
    }));

    try {
      await page.goto(pageUrl.toString());
      await page.setInputFiles('input[type="file"]', pdfPath);
      await setSelectByText(page, 'Source language', args.source);
      await setSelectByText(page, 'Target language', args.target);
      await setMirrorCheckbox(page, args.mirror);
      await setSelectedPages(page, args.pages);

      const translateButton = page.getByRole('button', { name: /^Translate(?: \d+ page(?:s)?)?$/ });
      await translateButton.waitFor({ state: 'visible', timeout: 30000 });
      await translateButton.click();

      await page.getByRole('button', { name: /Home/i }).waitFor({ timeout: 60000 });
      await page.locator('.overlay-block').first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(args.waitMs);

      const hookContext = {
        args: {
          ...args,
          pdf: pdfPath,
        },
        browser,
        page,
        consoleLines,
        collectBlockSnapshot: (blockId) => collectBlockSnapshot(page, blockId),
        collectOverlayState,
      };
      const preHookResults = [];
      for (const hookPath of args.preHooks) {
        preHookResults.push({
          path: resolvePathFromCwd(hookPath),
          result: await runInspectHook(hookPath, hookContext),
        });
      }

      const overlayBefore = await collectOverlayState();

      let overlayAfter = overlayBefore;
      if (args.toggleQ) {
        await page.keyboard.press('q');
        await page.waitForTimeout(150);
        overlayAfter = await collectOverlayState();
      }

      const blocks = [];
      for (const blockId of args.blocks) {
        blocks.push(await collectBlockSnapshot(page, blockId));
      }

      const postHookResults = [];
      for (const hookPath of args.postHooks) {
        postHookResults.push({
          path: resolvePathFromCwd(hookPath),
          result: await runInspectHook(hookPath, hookContext),
        });
      }

      let exportedTranslationsPath = null;
      if (exportTranslationsPath) {
        const translationRun = await page.evaluate(() => window.__LINGADOO_LAST_BROWSER_TRANSLATION_RUN__ || null);
        if (!translationRun) {
          throw new Error('No browser translation run data was captured for export.');
        }
        fs.mkdirSync(path.dirname(exportTranslationsPath), { recursive: true });
        fs.writeFileSync(exportTranslationsPath, `${JSON.stringify(translationRun, null, 2)}\n`, 'utf8');
        exportedTranslationsPath = exportTranslationsPath;
      }

      process.stdout.write(`${JSON.stringify({
        url: effectiveUrl,
        resolvedUrl: pageUrl.toString(),
        pdf: pdfPath,
        pages: args.pages,
        source: args.source,
        target: args.target,
        mirror: args.mirror,
        autoNudge: args.autoNudge,
        repairVerticalOverflow: args.repairVerticalOverflow,
        useBucketFontRatio: args.useBucketFontRatio,
        preserveVerticalSourceAnchor: args.preserveVerticalSourceAnchor,
        useTightTextBBox: args.useTightTextBBox,
        detectLogos: args.detectLogos,
        reconstructMixedBidiLines: args.reconstructMixedBidiLines,
        enableTesseractOcr: args.enableTesseractOcr,
        mergeContinuationBlocks: args.mergeContinuationBlocks,
        browserTranslatorTimeoutMs: args.browserTranslatorTimeoutMs,
        mockTranslationsPath: mockTranslationsPath || null,
        exportedTranslationsPath,
        preHookResults,
        overlayBefore,
        overlayAfter,
        blocks,
        postHookResults,
        consoleLines,
      }, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        url: effectiveUrl,
        resolvedUrl: pageUrl.toString(),
        pdf: pdfPath,
        pages: args.pages,
        source: args.source,
        target: args.target,
        mirror: args.mirror,
        autoNudge: args.autoNudge,
        repairVerticalOverflow: args.repairVerticalOverflow,
        useBucketFontRatio: args.useBucketFontRatio,
        preserveVerticalSourceAnchor: args.preserveVerticalSourceAnchor,
        useTightTextBBox: args.useTightTextBBox,
        detectLogos: args.detectLogos,
        reconstructMixedBidiLines: args.reconstructMixedBidiLines,
        enableTesseractOcr: args.enableTesseractOcr,
        mergeContinuationBlocks: args.mergeContinuationBlocks,
        browserTranslatorTimeoutMs: args.browserTranslatorTimeoutMs,
        mockTranslationsPath: mockTranslationsPath || null,
        message: error instanceof Error ? error.message : String(error),
        consoleLines,
      }, null, 2)}\n`);
      throw error;
    }
  } finally {
    await browser.close();
    killDevServer(devServerChild);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
