// Renders the app icon (SVG) to the PNG sizes iOS and the manifest need.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d3b5c"/><stop offset="1" stop-color="#0b0e13"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(256 256) scale(${pad}) translate(-256 -256)" fill="none" stroke-linecap="round">
    <path d="M86 196 H318 a54 54 0 1 0 -54 -54" stroke="#ffffff" stroke-width="30"/>
    <path d="M86 268 H390 a50 50 0 1 1 -50 50" stroke="#e4b33c" stroke-width="30"/>
    <path d="M126 340 H262" stroke="#4fa3e0" stroke-width="30"/>
  </g>
</svg>`;

const out = new URL('../public/icons/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.78],
  ['apple-touch-icon.png', 180, 0.92],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(pad).replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: out + name, omitBackground: false });
}
await browser.close();
console.log('icons written');
