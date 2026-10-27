import { expect, type Page } from '@playwright/test';
import { installMocks, type MockOptions } from './mock';

export async function openApp(page: Page, opts: MockOptions = {}, path = './'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installMocks(page, opts);
  await page.goto(path);
  await expect(page.locator('#timeline .time-label')).toBeVisible();
  return errors;
}

export async function selectLayer(page: Page, id: string): Promise<void> {
  const toggle = page.getByTestId('layer-toggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(`.layer-list [data-layer="${id}"]`).click();
  await expect(page.locator(`.layer-list [data-layer="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
}

/** Sum + count of non-transparent pixels on a canvas, as a cheap fingerprint. */
export async function canvasStats(page: Page, testid: string): Promise<{ opaque: number; sum: number; white: number }> {
  return page.evaluate((id) => {
    const c = document.querySelector<HTMLCanvasElement>(`[data-testid="${id}"]`)!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    let sum = 0;
    let white = 0;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] > 0) {
        opaque++;
        sum += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7;
        if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230 && d[i + 3] > 150) white++;
      }
    }
    return { opaque, sum, white };
  }, testid);
}

export async function clickLatLng(page: Page, lat: number, lon: number): Promise<void> {
  const p = await page.evaluate(([la, lo]) => {
    const pt = (window as any).__windblick.map.latLngToContainerPoint([la, lo]);
    return { x: pt.x, y: pt.y };
  }, [lat, lon]);
  await page.locator('#map').click({ position: { x: p.x, y: p.y } });
}

export async function setView(page: Page, lat: number, lon: number, zoom: number): Promise<void> {
  await page.evaluate(([la, lo, z]) => (window as any).__windblick.map.setView([la, lo], z, { animate: false }), [lat, lon, zoom]);
  await page.waitForTimeout(600); // debounce + data
}

export async function waitForData(page: Page): Promise<void> {
  await expect(page.locator('#loading')).toBeHidden();
  await page.waitForTimeout(200);
}
