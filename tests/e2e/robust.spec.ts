import { test, expect } from '@playwright/test';
import { canvasStats, openApp, setLayers, waitForData } from './helpers';

test.describe('Länderkarte und Ausfallsicherheit', () => {
  test('Ländergrenzen und Küsten sind eingebaut und liegen über den Wetterfarben', async ({ page }) => {
    await openApp(page, { failTiles: true });
    await waitForData(page);
    const info = await page.evaluate(() => {
      const w = (window as any).__windblick;
      const c = w.map.getPane('borders').querySelector('canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let white = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) white++;
      return { white, z: Number(w.map.getPane('borders').style.zIndex), field: Number(w.map.getPane('field').style.zIndex) };
    });
    expect(info.z).toBeGreaterThan(info.field);
    expect(info.white).toBeGreaterThan(500); // visible lines even without any map tiles
  });

  test('Grenzen werden beim Hineinzoomen genauer', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await expect.poll(() => page.evaluate(() => (window as any).__windblick.borders.level)).toBe('fine'); // zoom 5
    await page.evaluate(() => (window as any).__windblick.map.setZoom(2, { animate: false }));
    await expect.poll(() => page.evaluate(() => (window as any).__windblick.borders.level)).toBe('coarse');
  });

  test('fällt der Kartenserver aus, springt die App auf einen Ersatzserver um', async ({ page }) => {
    const requests: string[] = [];
    await openApp(page, { failTiles: true, requests });
    await expect.poll(() => requests.filter((u) => u.includes('server.arcgisonline.com')).length).toBeGreaterThan(0);
    await expect(page.locator('.fallback-tiles img').first()).toBeVisible();
  });

  test('ein Fehler in einem Teil wird angezeigt, der Rest funktioniert weiter', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('windblick:test-fail', JSON.stringify('Legende')));
    const errors = await openApp(page);
    await expect(page.getByTestId('banner-text')).toContainText('Interner Fehler (Legende): Testfehler');
    await expect(page.getByTestId('banner-text')).toContainText('Version');
    // layer menu and search still work
    await setLayers(page, ['temp', 'rain']);
    await waitForData(page);
    expect((await canvasStats(page, 'field-canvas')).opaque).toBeGreaterThan(1000);
    await page.locator('#search-input').fill('Berl');
    await expect(page.locator('#search-results li', { hasText: 'Berlin' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('startet das App Skript gar nicht, erscheint ein Hinweis statt einer leeren Seite', async ({ page }) => {
    await page.route(/\/assets\/index-.*\.js$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'this is not valid javascript (' }));
    await page.goto('./');
    await expect(page.getByTestId('boot-error')).toContainText('Die App konnte nicht starten');
  });

  test('Einstellungen zeigen die Version und setzen die App zurück', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await setLayers(page, ['temp']);
    await page.locator('#btn-settings').click();
    await expect(page.getByTestId('app-version')).toContainText(/Version \d{4}-\d{2}-\d{2} /);
    page.once('dialog', (d) => d.accept());
    await Promise.all([page.waitForEvent('load'), page.getByTestId('app-reset').click()]);
    await expect(page.locator('#timeline .time-label')).toBeVisible();
    // back to defaults: wind layer only
    await expect.poll(() => page.evaluate(() => (window as any).__windblick?.state.layers.join(','))).toBe('wind');
  });
});
