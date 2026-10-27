import { test, expect } from '@playwright/test';
import { clickLatLng, openApp, setView, waitForData } from './helpers';

test.describe('Punktvorhersage', () => {
  test('Tippen auf die Karte zeigt Werte, Vorhersage öffnet Meteogramm', async ({ page }) => {
    const errors = await openApp(page);
    await waitForData(page);
    await clickLatLng(page, 50.5, 10);
    const popup = page.getByTestId('popup');
    await expect(popup).toBeVisible();
    await expect(page.getByTestId('popup-main')).toHaveText(/\d+ km\/h/);
    await expect(popup).toContainText('Temperatur');
    await expect(popup).toContainText('°C');

    await page.getByTestId('popup-forecast').click();
    const sheet = page.locator('#sheet');
    await expect(sheet).toHaveClass(/open/);
    await expect(page.getByTestId('sheet-sub')).toContainText('50.5');
    await expect(page.getByTestId('meteogram')).toBeVisible();
    await expect(page.getByTestId('summary')).toContainText('km/h');
    // 7 days in the daily table, wind arrows present
    await expect(page.locator('[data-testid="daily-table"] tbody tr')).toHaveCount(await page.evaluate(() => {
      const start = Math.floor(Date.now() / 86400000) * 86400;
      const days = new Set<string>();
      for (let i = 0; i < 7 * 24; i++) days.add(new Date((start + i * 3600) * 1000).toDateString());
      return days.size;
    }));
    expect(await page.locator('[data-testid="meteogram"] path[data-dir]').count()).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });

  test('Popup aktualisiert sich mit der Zeitleiste', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await clickLatLng(page, 55, 2);
    const main = page.getByTestId('popup-main');
    const v1 = await main.textContent();
    await page.locator('.time-slider').fill('100');
    await expect(main).not.toHaveText(v1!);
  });

  test('Tabs Modelle, Wellen und Luft laden ihre Daten', async ({ page }) => {
    const requests: string[] = [];
    await openApp(page, { requests });
    await waitForData(page);
    await setView(page, 55, 3, 6);
    await clickLatLng(page, 55, 3); // Nordsee
    await page.getByTestId('popup-forecast').click();
    await expect(page.getByTestId('meteogram')).toBeVisible();

    await page.locator('[data-tab="models"]').click();
    await expect(page.getByTestId('model-table')).toBeVisible();
    await expect(page.locator('[data-testid="model-table"] thead th')).toHaveText(['Tag', 'ECMWF', 'GFS', 'ICON', 'AROME']);
    expect(requests.some((u) => new URL(u).searchParams.get('models') === 'ecmwf_ifs025,gfs_seamless,icon_seamless,meteofrance_seamless')).toBe(true);
    expect(await page.locator('#sheet path[data-series]').count()).toBeGreaterThanOrEqual(16);

    await page.locator('[data-tab="waves"]').click();
    await expect(page.getByTestId('wave-height')).toContainText(' m');

    await page.locator('[data-tab="air"]').click();
    await expect(page.getByTestId('aqi')).toContainText(/\d+ · /);

    await page.locator('#sheet .close-btn').click();
    await expect(page.locator('#sheet')).not.toHaveClass(/open/);
  });

  test('Wellen Tab erklärt fehlende Meeresdaten an Land', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await clickLatLng(page, 50.5, 10);
    await page.getByTestId('popup-forecast').click();
    await page.locator('[data-tab="waves"]').click();
    await expect(page.getByTestId('no-marine')).toBeVisible();
  });
});

test.describe('Suche und Standort', () => {
  test('Ortssuche mit Auswahl springt zum Ort und öffnet die Vorhersage', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await page.locator('#search-input').fill('Berl');
    const item = page.locator('#search-results li', { hasText: 'Berlin' });
    await expect(item).toBeVisible();
    await expect(item).toContainText('Deutschland');
    await item.click();
    await expect(page.getByTestId('sheet-title')).toHaveText('Berlin');
    await expect.poll(async () => page.evaluate(() => (window as any).__windblick.map.getCenter().lat), { timeout: 5000 }).toBeCloseTo(52.52, 1);
  });

  test('Enter wählt den ersten Treffer, Koordinaten funktionieren', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    const input = page.locator('#search-input');
    await input.fill('Tarifa');
    await input.press('Enter');
    await expect(page.getByTestId('sheet-title')).toHaveText('Tarifa');
    await page.locator('#sheet .close-btn').click();
    await input.fill('54.3, 8.6');
    await input.press('Enter');
    await expect(page.getByTestId('sheet-sub')).toHaveText('54.300, 8.600');
  });

  test('keine Treffer und Suchfehler werden angezeigt', async ({ page }) => {
    await openApp(page, { failGeocoding: false });
    await page.locator('#search-input').fill('xyzq');
    await expect(page.locator('#search-results li')).toHaveText('Keine Treffer');
  });

  test('Suchfehler zeigt Hinweis', async ({ page }) => {
    await openApp(page, { failGeocoding: true });
    await page.locator('#search-input').fill('Berlin');
    await expect(page.getByTestId('banner-text')).toContainText('Ortssuche fehlgeschlagen');
  });

  test('Mein Standort zentriert die Karte und zeigt Werte', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 47.8, longitude: 13.0 });
    await openApp(page);
    await waitForData(page);
    await page.locator('#btn-locate').click();
    await expect(page.getByTestId('popup')).toContainText('47.800, 13.000');
  });

  test('verweigerter Standort zeigt Hilfe', async ({ page, context }) => {
    await context.clearPermissions();
    await openApp(page);
    await page.locator('#btn-locate').click();
    await expect(page.getByTestId('banner-text')).toContainText(/Standort/);
  });
});
