import { test, expect } from '@playwright/test';
import { installMocks } from './mock';

test.describe('PWA / iPhone Homescreen', () => {
  test('Manifest, Icons und iOS Meta Tags sind vorhanden', async ({ page, request }) => {
    await installMocks(page);
    await page.goto('./');
    const manifest = await (await request.get('./manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const r = await request.get(`./${icon.src}`);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type']).toContain('image/png');
    }
    const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect((await request.get(touch!)).status()).toBe(200);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  });

  test.describe('mit Service Worker', () => {
    test.use({ serviceWorkers: 'allow' });

    test('registriert Service Worker und startet offline aus dem Cache', async ({ page, context }) => {
      await installMocks(context);
      await page.goto('./');
      await expect(page.getByTestId('time-label')).toBeVisible();
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      // Reload once so the page is controlled and assets get cached.
      await page.reload();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await expect(page.locator('#loading')).toBeHidden();
      await page.waitForTimeout(500);

      await context.setOffline(true);
      await page.reload();
      await expect(page.locator('#layer-menu')).toBeVisible();
      await expect(page.getByTestId('time-label')).toBeVisible();
      await context.setOffline(false);
    });
  });
});
