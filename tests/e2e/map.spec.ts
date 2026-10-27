import { test, expect } from '@playwright/test';
import { canvasStats, openApp, selectLayer, setLayers, setView, toggleLayer, waitForData } from './helpers';

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
      await expect(page.locator('#legend .legend-item')).toHaveCount(1);
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
    expect((await canvasStats(page, 'iso-canvas')).opaque).toBe(0);
    await selectLayer(page, 'pressure');
    await waitForData(page);
    const iso = await canvasStats(page, 'iso-canvas');
    expect(iso.opaque).toBeGreaterThan(20);
    expect(iso.white).toBeGreaterThan(5);
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
    // radar together with wind uses the forecast time line and the newest radar frame
    await setLayers(page, ['wind', 'radar']);
    await expect(slider).toHaveAttribute('max', String(5 * 24 - 1));
    await expect(page.locator('.radar-tiles')).not.toHaveCount(0);
    await expect(page.locator('#legend .legend-item')).toHaveCount(2);
    // back to forecast only removes the radar
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

  test('mehrere Ebenen gleichzeitig: zwei Legenden, Bild aus beiden', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await setLayers(page, ['temp']);
    await waitForData(page);
    const temp = await canvasStats(page, 'field-canvas');
    await setLayers(page, ['rain']);
    await waitForData(page);
    const rain = await canvasStats(page, 'field-canvas');
    await setLayers(page, ['temp', 'rain']);
    await waitForData(page);
    const both = await canvasStats(page, 'field-canvas');
    await expect(page.locator('#legend .legend-item')).toHaveCount(2);
    await expect(page.locator('#legend [data-legend="temp"]')).toBeVisible();
    await expect(page.locator('#legend [data-legend="rain"]')).toBeVisible();
    expect(both.sum).not.toBe(temp.sum);
    expect(both.sum).not.toBe(rain.sum);
    await page.reload();
    await expect(page.locator('#legend .legend-item')).toHaveCount(2);
  });

  test('alle Ebenen aus: nur noch Karte, keine Farben, Linien oder Legende', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    await toggleLayer(page, 'wind');
    await page.waitForTimeout(300);
    expect((await canvasStats(page, 'field-canvas')).opaque).toBe(0);
    expect((await canvasStats(page, 'particle-canvas')).opaque).toBe(0);
    await expect(page.locator('#legend .legend-item')).toHaveCount(0);
    const toggle = page.getByTestId('layer-toggle');
    if (await toggle.isVisible()) await expect(toggle).toContainText('Keine Ebene');
    await expect(page.locator('.leaflet-tile-pane img').first()).toBeVisible(); // base map still there
  });

  test('Windlinien nur bei Wind Ebenen', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    for (const id of ['temp', 'rain', 'clouds', 'pressure', 'humidity', 'waves', 'pm25']) {
      await setLayers(page, [id]);
      await waitForData(page);
      await page.waitForTimeout(150);
      expect((await canvasStats(page, 'particle-canvas')).opaque, id).toBe(0);
    }
    for (const id of ['wind', 'gust', 'wind850']) {
      await setLayers(page, [id]);
      await waitForData(page);
      await page.waitForTimeout(400);
      expect((await canvasStats(page, 'particle-canvas')).opaque, id).toBeGreaterThan(20);
    }
    await setLayers(page, ['temp', 'wind']);
    await waitForData(page);
    await page.waitForTimeout(400);
    expect((await canvasStats(page, 'particle-canvas')).opaque).toBeGreaterThan(20);
  });

  test('ganze Erde sichtbar und mit Wetterdaten gefüllt', async ({ page }) => {
    const requests: string[] = [];
    await openApp(page, { requests });
    await waitForData(page);
    await setView(page, 20, 0, 0);
    await waitForData(page);
    const span = await page.evaluate(() => {
      const b = (window as any).__windblick.map.getBounds();
      return b.getEast() - b.getWest();
    });
    expect(span).toBeGreaterThanOrEqual(360);
    const last = new URL(requests.filter((u) => u.includes('/v1/forecast')).pop()!);
    const n = last.searchParams.get('latitude')!.split(',').length;
    expect(n).toBeGreaterThan(220);
    expect(n).toBeLessThanOrEqual(450);
    expect((await canvasStats(page, 'field-canvas')).opaque).toBeGreaterThan(1000);
  });

  test('erster Start zeigt die ganze Erdbreite', async ({ page }) => {
    await openApp(page, { freshView: true });
    const span = await page.evaluate(() => {
      const b = (window as any).__windblick.map.getBounds();
      return b.getEast() - b.getWest();
    });
    expect(span).toBeGreaterThanOrEqual(270);
  });

  test('Ortsnamen liegen über den Wetterfarben', async ({ page }) => {
    await openApp(page);
    await waitForData(page);
    const z = await page.evaluate(() => {
      const m = (window as any).__windblick.map;
      return { labels: Number(m.getPane('labels').style.zIndex), field: Number(m.getPane('field').style.zIndex) };
    });
    expect(z.labels).toBeGreaterThan(z.field);
    const src = await page.locator('.label-tiles img').first().getAttribute('src');
    expect(src).toContain('dark_only_labels');
    expect(await page.locator('.leaflet-tile-pane img').first().getAttribute('src')).toContain('dark_all');
    // no blend mode that iOS Safari renders unreliably
    const blend = await page.evaluate(() => Array.from(document.querySelectorAll('.leaflet-pane')).map((p) => getComputedStyle(p).mixBlendMode));
    expect(blend.every((b) => b === 'normal')).toBe(true);
  });
});
