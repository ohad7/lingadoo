import { expect, test } from '@playwright/test';

test('default home page is english', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lingadoo' })).toBeVisible();
  await expect(page.getByText('PDF translation made easy')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.home-view')).toHaveAttribute('dir', 'ltr');
});

test('hebrew home page is rtl', async ({ page }) => {
  await page.goto('/he');
  await expect(page.getByText('תרגום PDF בלי לאבד את הצורה')).toBeVisible();
  await expect(page.getByText('גררו לכאן קובץ PDF')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('.home-view')).toHaveAttribute('dir', 'rtl');
});

test('hebrew home page localizes the blocked-browser message', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only shim
    window.Translator = undefined;
  });
  await page.goto('/he');
  const compatibilityCard = page.locator('.compatibility-card');
  await expect(page.getByText('יש לפתוח את Lingadoo ב-Chrome או ב-Edge במחשב')).toBeVisible();
  await expect(compatibilityCard).toContainText('דפדפנים נתמכים');
  await expect(compatibilityCard).toContainText('כרגע Lingadoo עובד רק ב־Google Chrome וב־Microsoft Edge במחשב.');
  await expect(page.locator('.drop-zone')).toHaveCSS('pointer-events', 'none');
});

test('french home page is localized', async ({ page }) => {
  await page.goto('/fr');
  await expect(page.getByText('La traduction PDF en toute simplicité')).toBeVisible();
  await expect(page.getByText('Déposez un PDF ici')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.home-view')).toHaveAttribute('dir', 'ltr');
});

test('home page blocks upload when local translation is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only shim
    window.Translator = undefined;
  });
  await page.goto('/');
  const compatibilityCard = page.locator('.compatibility-card');
  await expect(page.getByText('Use Lingadoo in Chrome or Edge on desktop')).toBeVisible();
  await expect(compatibilityCard).toContainText(/Google Chrome/i);
  await expect(compatibilityCard).toContainText(/Microsoft Edge/i);
  await expect(page.locator('.drop-zone')).toHaveCSS('pointer-events', 'none');
});

test('home page blocks upload when core browser runtime is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only shim
    window.Worker = undefined;
  });
  await page.goto('/');
  await expect(page.getByText('Use Lingadoo in Chrome or Edge on desktop')).toBeVisible();
  await expect(page.getByText(/Module workers/i)).toBeVisible();
  await expect(page.locator('.drop-zone')).toHaveCSS('pointer-events', 'none');
});
