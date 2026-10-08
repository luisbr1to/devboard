// Renders the DevBoard icons (terminal prompt ">_") from SVG with Playwright's Chromium:
// appPackage/color.png (192×192, full-bleed colour), appPackage/outline.png (32×32, white on
// transparent, as Teams requires) and public/favicon.svg. Run: npm run icons:render
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const glyph = (stroke: string, width: number, paths: string[]) =>
  `<g fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => `<path d="${d}"/>`)
    .join("")}</g>`;
const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs>`;

// Symbol centred in the 96 px safe area of the 192 px tile.
export const colorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">${gradient}<rect width="192" height="192" fill="url(#g)"/>${glyph("#ffffff", 14, ["M58 68l30 28-30 28", "M102 124h34"])}</svg>`;
export const outlineSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${glyph("#ffffff", 2.75, ["M6 9l7.5 7L6 23", "M16 23h10"])}</svg>`;
export const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${gradient}<rect width="32" height="32" rx="7" fill="url(#g)"/>${glyph("#ffffff", 2.75, ["M8 10.5l6 5.5-6 5.5", "M16.5 21.5h7.5"])}</svg>`;

async function render() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const [file, svg, size] of [
      ["appPackage/color.png", colorSvg, 192],
      ["appPackage/outline.png", outlineSvg, 32],
    ] as const) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<html><body style="margin:0;background:transparent">${svg}</body></html>`,
      );
      await page.screenshot({
        path: file,
        omitBackground: true,
        clip: { x: 0, y: 0, width: size, height: size },
      });
    }
    await writeFile("public/favicon.svg", `${faviconSvg}\n`);
  } finally {
    await browser.close();
  }
}
void render().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
