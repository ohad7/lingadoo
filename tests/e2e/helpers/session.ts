import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const fixturePdf = path.join(repoRoot, 'tests/documents/report_1_test.pdf');

export function reportFixturePath(): string {
  return fixturePdf;
}

export function workspaceFixturePath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

/**
 * Upload a PDF fixture via the redesigned upload flow:
 * 1. Set file on hidden input → triggers UploadPreviewModal
 * 2. Click "Translate N pages" button (all pages selected by default)
 * 3. Wait for upload to complete and editor view to appear
 */
export async function uploadFixture(page: Page, fixturePath: string): Promise<void> {
  await page.setInputFiles('input[type="file"]', fixturePath);
  // UploadPreviewModal appears with page thumbnails — click Translate
  const translateButton = page.getByRole('button', { name: /^Translate(?: \d+ page(?:s)?)?$/ });
  await expect(translateButton).toBeVisible({ timeout: 30_000 });
  await translateButton.click();
  // Wait for editor view to appear (upload completes → transitions to editor)
  await expect(page.locator('.editor-view')).toBeVisible({ timeout: 120_000 });
}

export async function uploadCanonicalFixture(page: Page): Promise<void> {
  await uploadFixture(page, fixturePdf);
}
