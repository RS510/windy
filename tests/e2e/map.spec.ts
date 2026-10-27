import { test, expect } from '@playwright/test';
import { canvasStats, openApp, selectLayer, waitForData } from './helpers';

test.describe('Karte, Layer und Zeitleiste', () => {
  test('lädt Gitterdaten, zeichnet Farbfeld und animiert Windpartikel', async ({ page }) => {
    const requests: string[] = [];
    const errors = await openApp(page, { requests });
    await waitForData(page);
    const grid = requests.find((u) => u.includes('api.open-meteo.com/v1/forecast'))!;
    expect(grid).toBeTruthy();
    const url = new URL(grid);
    expect(url.searchParams.get('latitude')!.split(',').length).toBeGreaterThan(50);
    expect(url.searchParams.get('hourly')).toContain('wind_speed_10m');

    const field = await canvasStats(page, 'field-canvas');
    expect(field.opaque).toBeGreaterThan(1000);

    const p1 = await canvasStats(page, 'particle-canvas');
    await page.waitForTimeout(400);
    const p2 = await canvasStats(page, 'particle-canvas');
    expect(p1.opaque).toBeGreaterThan(50);
    expect(p2.sum).not.toBe(p1.sum); // particles move
    const frames = await page.evaluate(() => (window as any).__windblick.particles.frames);
    expect(frames).toBeGreaterThan(10);
    expect(errors).toEqual([]);
  });

  test('jeder Layer lässt sich einschalten und lädt die passenden Daten', async ({ page }) => {
    const requests: string[] = [];
    const errors = await openApp(page, { requests });
    await waitForData(page);
    let last = await canvasStats(page, 'field-canvas');
    const cases: [string, string, string | null][] = [
      ['gust', 'Böen', null],
      ['temp', 'Temperatur', null],
      ['rain', 'Regen', null],
      ['clouds', 'Wolken', null],
      ['pressure', 'Luftdruck', null],
      ['humidity', 'Luftfeuchte', null],
      ['wind850', 'Wind 850 hPa', 'wind_speed_850hPa'],
      ['wind500', 'Wind 500 hPa', null], // same request as 850 hPa, served from cache
      ['waves', 'Wellen', 'marine-api.open-meteo.com'],
      ['pm25', 'Feinstaub PM2.5', 'air-quality-api.open-meteo.com'],
      ['ozone', 'Ozon', null], // same request as PM2.5, served from cache
      ['wind', 'Wind', null],
    ];
    for (const [id, label, needle] of cases) {
      requests.length = 0;
      await selectLayer(page, id);
      await waitForData(page);
      await expect(page.locator('#legend .title span').first()).toHaveText(label);
      if (needle) expect(requests.some((u) => u.includes(needle)), `${id} lädt ${needle}`).toBe(true);
      const now = await canvasStats(page, 'field-canvas');
      expect(now.sum, `${id} ändert das Farbfeld`).not.toBe(last.sum);
      last = now;
    }
    expect(errors).toEqual([]);
  });

  test('Luftdruck zeigt Isobaren mit Beschriftung', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await selectLayer(page, 'temp');
    await waitForData(page);
    const before = await canvasStats(page, 'field-canvas');
    await selectLayer(page, 'pressure');
    await waitForData(page);
    const after = await canvasStats(page, 'field-canvas');
    expect(after.white).toBeGreaterThan(before.white + 20);
  });

  test('Zeitleiste: Schieberegler und Abspielen ändern Zeitpunkt und Karte', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    const label = page.getByTestId('time-label');
    const t0 = await label.textContent();
    const f0 = await canvasStats(page, 'field-canvas');
    const slider = page.locator('.time-slider');
    const max = Number(await slider.getAttribute('max'));
    expect(max).toBe(5 * 24 - 1);
    await slider.fill(String(Math.floor(max * 0.75)));
    await expect(label).not.toHaveText(t0!);
    const f1 = await canvasStats(page, 'field-canvas');
    expect(f1.sum).not.toBe(f0.sum);

    const t1 = await label.textContent();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Pause');
    await expect(label).not.toHaveText(t1!, { timeout: 3000 });
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Abspielen');
    const stopped = await label.textContent();
    await page.waitForTimeout(1600);
    await expect(label).toHaveText(stopped!);
  });

  test('Modellwahl lädt Daten des gewählten Modells', async ({ page }) => {
    const requests: string[] = [];
    await openApp(page, { requests });
    await waitForData(page);
    const before = await canvasStats(page, 'field-canvas');
    requests.length = 0;
    await page.locator('#btn-model').click();
    await page.locator('#model-menu [data-model="gfs_seamless"]').click();
    await expect(page.locator('#btn-model')).toHaveText('GFS ▾');
    await waitForData(page);
    expect(requests.some((u) => new URL(u).searchParams.get('models') === 'gfs_seamless')).toBe(true);
    const after = await canvasStats(page, 'field-canvas');
    expect(after.sum).not.toBe(before.sum);
    // persists across reload
    await page.reload();
    await expect(page.locator('#btn-model')).toHaveText('GFS ▾');
  });

  test('Regenradar zeigt Radarbilder mit eigener Zeitleiste', async ({ page }) => {
    const requests: string[] = [];
    const errors = await openApp(page, { requests });
    await waitForData(page);
    await selectLayer(page, 'radar');
    await expect(page.locator('#btn-model')).toHaveText('RainViewer');
    await expect.poll(() => requests.filter((u) => u.includes('tilecache.rainviewer.com')).length).toBeGreaterThan(0);
    const slider = page.locator('.time-slider');
    await expect(slider).toHaveAttribute('max', '15');
    await expect(slider).toHaveValue('12'); // newest past frame
    await expect(page.locator('.time-label .sub')).toHaveText(/jetzt|vor/);
    const field = await canvasStats(page, 'field-canvas');
    expect(field.opaque).toBe(0);
    const visibleRadar = await page.locator('.radar-tiles').evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== '0').length);
    expect(visibleRadar).toBe(1);
    // step to a nowcast frame
    await slider.fill('14');
    await expect(page.locator('.time-label .sub')).toHaveText(/in|jetzt/);
    // back to forecast restores the forecast timeline
    await selectLayer(page, 'wind');
    await expect(slider).toHaveAttribute('max', String(5 * 24 - 1));
    await expect(page.locator('.radar-tiles')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Windanimation lässt sich in den Einstellungen abschalten', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await page.locator('#btn-settings').click();
    await page.getByTestId('toggle-particles').uncheck();
    await page.waitForTimeout(200);
    expect((await canvasStats(page, 'particle-canvas')).opaque).toBe(0);
    await page.getByTestId('toggle-particles').check();
    await page.waitForTimeout(300);
    expect((await canvasStats(page, 'particle-canvas')).opaque).toBeGreaterThan(0);
  });
});
