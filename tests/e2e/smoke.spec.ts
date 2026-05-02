import { expect, test } from '@playwright/test';

import { uploadCanonicalFixture, uploadFixture, workspaceFixturePath } from './helpers/session';

test.describe('Web App Smoke @smoke', () => {
  test('boots with home view and upload zone @smoke', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Lingadoo' })).toBeVisible();
    await expect(page.locator('.drop-zone')).toBeVisible();
    await expect(page.locator('.drop-zone-text')).toHaveText('Drop a PDF here');
    await expect(page.locator('.drop-zone-browse')).toHaveText('or click to browse');
  });

  test('uploads canonical fixture and shows editor with canvas @smoke', async ({ page }) => {
    await page.goto('/');

    await uploadCanonicalFixture(page);

    // Editor view should be visible with app bar, canvas, and sidebar
    await expect(page.locator('.editor-view')).toBeVisible();
    await expect(page.locator('.app-bar')).toBeVisible();
    await expect(page.locator('.editor-canvas')).toBeVisible();
    await expect(page.locator('.editor-sidebar')).toBeVisible();
    await expect(page.locator('.editor-properties')).toBeVisible();

    // Status bar should show saved state
    await expect(page.getByText(/Unsaved changes|Saved/)).toBeVisible();

    // Page sidebar should have at least one page thumbnail
    const thumbs = page.locator('.editor-sidebar .page-thumb');
    expect(await thumbs.count()).toBeGreaterThan(0);

    // Canvas should render the full page stack, not just the active page.
    const stages = page.locator('.preview-stage');
    await expect(stages.first()).toBeVisible();
    await expect.poll(async () => stages.count()).toBe(await thumbs.count());
  });

  test('semantic faux-bold fixture renders editable overlay blocks without crashing @smoke', async ({ page }) => {
    await page.goto('/');
    await uploadFixture(page, workspaceFixturePath('tests/documents/faux_bold_semantic_test.pdf'));

    const blocks = page.locator('.overlay-block');
    await expect(blocks.first()).toBeVisible();
    expect(await blocks.count()).toBeGreaterThan(0);
  });
});
