import { test, expect } from '@playwright/test';
import { clickLatLng, openApp, setView, waitForData } from './helpers';

test.describe('Favoriten, Spots, Einstellungen', () => {
  test('Favorit speichern, nach Neustart vorhanden, entfernen', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await clickLatLng(page, 50.5, 10);
    await page.getByTestId('popup-forecast').click();
    const fav = page.getByTestId('fav-toggle');
    await expect(fav).toHaveAttribute('aria-pressed', 'false');
    await fav.click();
    await expect(page.getByTestId('fav-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fav-marker')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.fav-marker')).toHaveCount(1);
    await page.locator('#btn-places').click();
    const list = page.getByTestId('fav-list');
    await expect(list.locator('li')).toHaveCount(1);
    // opening from the list shows its forecast
    await list.locator('.grow').click();
    await expect(page.locator('#sheet')).toHaveClass(/open/);
    await expect(page.getByTestId('fav-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#sheet .close-btn').click();
    await page.locator('#btn-places').click();
    await page.getByRole('button', { name: /entfernen/ }).click();
    await expect(page.getByTestId('fav-list')).toHaveCount(0);
    await expect(page.locator('.fav-marker')).toHaveCount(0);
  });

  test('Spot anlegen, bewerten, bearbeiten und löschen', async ({ page }) => {
    const errors = await openApp(page);
    await waitForData(page);
    await setView(page, 55, 4, 6);
    await clickLatLng(page, 55, 4);
    await page.getByTestId('popup-forecast').click();
    await page.getByTestId('spot-edit').click();
    const form = page.getByTestId('spot-form');
    await expect(form).toBeVisible();
    // Wait until the panel has finished sliding in, as a person would before tapping.
    await expect.poll(() => page.locator('#panel-spot').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)).toBe(0);

    // validation
    await page.getByTestId('spot-name').fill('Nordsee Test');
    await page.getByTestId('spot-min').fill('40');
    await page.getByTestId('spot-max').fill('20');
    await page.getByTestId('spot-save').click();
    await expect(page.getByTestId('spot-error')).toContainText('Windbereich');

    await form.locator('[data-sport="windsurf"]').click();
    await page.getByTestId('spot-min').fill('15');
    await page.getByTestId('spot-max').fill('60');
    await form.locator('[data-dir="5"]').click(); // SW
    await form.locator('[data-dir="6"]').click(); // W
    await page.getByTestId('spot-save').click();
    await expect(form).toBeHidden();

    const marker = page.getByTestId('spot-marker');
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveAttribute('data-rating', /[012]/);

    // sheet shows the spot tab with hourly ratings
    await expect(page.locator('[data-tab="spot"]')).toBeVisible();
    await page.locator('[data-tab="spot"]').click();
    await expect(page.getByTestId('rating-strip').first()).toBeVisible();
    expect(await page.locator('[data-testid="rating-strip"] span').count()).toBe(7 * 24);
    await expect(page.getByTestId('spot-windows')).toBeVisible();
    await expect(page.getByTestId('sheet-title')).toHaveText('Nordsee Test');

    // persists and appears in the list; edit keeps values
    await page.reload();
    await expect(page.getByTestId('spot-marker')).toHaveCount(1);
    await page.locator('#btn-places').click();
    await expect(page.getByTestId('spot-list')).toContainText('Windsurfen');
    await expect(page.getByTestId('spot-list')).toContainText('15 km/h bis 60 km/h');
    await page.getByTestId('spot-list').locator('.grow').click();
    await expect(page.locator('[data-tab="spot"]')).toHaveClass(/active/);
    await page.getByTestId('spot-edit').click();
    await expect(page.getByTestId('spot-min')).toHaveValue('15');
    await expect(page.getByTestId('spot-max')).toHaveValue('60');
    await expect(page.getByTestId('spot-form').locator('[data-dir="6"]')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('spot-form').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByTestId('spot-marker')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Spot mit vorbelegten Werten lässt sich direkt speichern, auch in m/s mit Komma', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await clickLatLng(page, 52, 5);
    await page.getByTestId('popup-forecast').click();
    await page.getByTestId('spot-edit').click();
    await expect(page.getByTestId('spot-max')).toHaveValue('50'); // 14 m/s, rounded
    await page.getByTestId('spot-name').fill('Standard');
    await page.getByTestId('spot-save').click();
    await expect(page.getByTestId('spot-form')).toBeHidden();
    await expect(page.getByTestId('spot-marker')).toHaveCount(1);

    await page.locator('#btn-settings').click();
    await page.locator('[data-setting="wind"] [data-value="ms"]').click();
    await page.locator('#panel-settings .close-btn').click();
    await page.getByTestId('spot-edit').click(); // detail sheet of the new spot is still open
    await page.getByTestId('spot-min').fill('5,5');
    await page.getByTestId('spot-save').click();
    await expect(page.getByTestId('spot-form')).toBeHidden();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('windblick:spots')!)[0].minWind);
    expect(stored).toBeCloseTo(5.5);
  });

  test('Spot Tooltip zeigt Bewertung an der Karte', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'windblick:spots',
        JSON.stringify([{ id: 's1', name: 'Hafen', lat: 54.3, lon: 8.6, sport: 'kite', minWind: 2, maxWind: 30, directions: [] }]),
      );
    });
    await openApp(page);
    await waitForData(page);
    const marker = page.getByTestId('spot-marker');
    await expect(marker).toHaveAttribute('data-rating', '2');
    await marker.hover();
    await expect(page.locator('.spot-tip')).toContainText('Hafen: gut');
  });

  test('Einheiten wirken auf Legende, Popup und Vorhersage und bleiben gespeichert', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await page.locator('#btn-settings').click();
    await page.locator('[data-setting="wind"] [data-value="kt"]').click();
    await page.locator('[data-setting="temp"] [data-value="f"]').click();
    await page.locator('[data-setting="pressure"] [data-value="inhg"]').click();
    await expect(page.getByTestId('legend-unit')).toHaveText('kn');
    await page.locator('#panel-settings .close-btn').click();

    await clickLatLng(page, 50.5, 10);
    await expect(page.getByTestId('popup-main')).toHaveText(/ kn$/);
    await expect(page.getByTestId('popup')).toContainText('°F');
    await page.getByTestId('popup-forecast').click();
    await expect(page.getByTestId('summary')).toContainText('kn');
    await expect(page.getByTestId('summary')).toContainText('inHg');

    await page.reload();
    await expect(page.getByTestId('legend-unit')).toHaveText('kn');
    await page.locator('#btn-settings').click();
    await page.locator('[data-setting="wind"] [data-value="bft"]').click();
    await expect(page.getByTestId('legend-unit')).toHaveText('Bft');
  });
});

test.describe('Fehler und Offline', () => {
  test('Serverfehler zeigt Hinweis mit erneutem Versuch, App bleibt bedienbar', async ({ page }) => {
    const errors = await openApp(page, { failForecast: true });
    await expect(page.getByTestId('banner-text')).toContainText('Wetterdaten konnten nicht geladen werden');
    await expect(page.getByTestId('banner-text')).toContainText('Testfehler');
    await expect(page.locator('#banner button', { hasText: 'Erneut versuchen' })).toBeVisible();
    // UI still works
    await page.locator('#btn-settings').click();
    await expect(page.locator('#panel-settings')).toHaveClass(/open/);
    expect(errors).toEqual([]);
  });

  test('Fehler in der Vorhersage zeigt Hinweis im Detailfenster', async ({ page }) => {
    await openApp(page, { failForecast: true });
    await page.evaluate(() => document.querySelector<HTMLElement>('#banner')!.hidden = true);
    await clickLatLng(page, 50.5, 10);
    await page.getByTestId('popup-forecast').click();
    await expect(page.getByTestId('sheet-error')).toContainText('Daten konnten nicht geladen werden');
  });

  test('Offline zeigt Hinweis, online lädt neu', async ({ page, context }) => {
    await openApp(page);
    await waitForData(page);
    await context.setOffline(true);
    await expect(page.getByTestId('banner-text')).toContainText('Keine Internetverbindung');
    await context.setOffline(false);
    await expect(page.locator('#banner')).toBeHidden();
  });
});
