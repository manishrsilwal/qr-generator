// Smoke test: serves the app, exercises single + batch flows in headless
// Chromium, and screenshots the UI. Run: node scripts/e2e-test.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".csv": "text/csv" };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const shotDir = process.argv[2] ?? "scripts/screenshots";
fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

await page.goto(base, { waitUntil: "networkidle" });

// --- Single flow ---
check(await page.locator("#qr-preview svg, #qr-preview canvas").count() > 0, "preview renders");
check(await page.locator("#dot-style-grid .style-option").count() === 6, "6 dot styles rendered");

await page.fill("#qr-content", "https://setu.ndrrma.gov.np/");
await page.fill("#qr-name", "setu-test");
await page.waitForTimeout(800);

// first scan check downloads the zxing wasm, so allow generous time
const scanBadgeText = await page
  .locator("#scan-badge.ok, #scan-badge.bad")
  .textContent({ timeout: 30000 })
  .catch(() => "(badge never resolved)");
check(scanBadgeText.includes("Verified scannable"), `scan check passes (badge: "${scanBadgeText.trim()}")`);

const dlPng = page.waitForEvent("download");
await page.click("#btn-download-png");
const pngDownload = await dlPng;
check(pngDownload.suggestedFilename() === "setu-test.png", `PNG download named ${pngDownload.suggestedFilename()}`);
const pngPath = path.join(shotDir, "single-download.png");
await pngDownload.saveAs(pngPath);
check(fs.statSync(pngPath).size > 5000, "downloaded PNG has content");

const dlSvg = page.waitForEvent("download");
await page.click("#btn-download-svg");
const svgDownload = await dlSvg;
check(svgDownload.suggestedFilename() === "setu-test.svg", `SVG download named ${svgDownload.suggestedFilename()}`);

// gradient + transparent background still renders (inputs are visually
// hidden inside custom switches, so click the visible slider instead)
const toggle = (id) => page.locator(`label.switch:has(#${id}) .slider`).click();
await toggle("dots-gradient-toggle");
await toggle("bg-transparent");
await page.waitForTimeout(700);
check(await page.locator("#qr-preview svg, #qr-preview canvas").count() > 0, "gradient + transparent preview renders");
check(await page.locator("#dots-color2-wrap:not(.hidden)").count() === 1, "gradient second colour appears");
await page.screenshot({ path: path.join(shotDir, "ui-gradient.png"), fullPage: false });
await toggle("dots-gradient-toggle");
await toggle("bg-transparent");
await page.waitForTimeout(500);
const stillGradient = await page.evaluate(() =>
  document.querySelector("#qr-preview").innerHTML.toLowerCase().includes("gradient"));
check(!stillGradient, "gradient fully removed after untoggle");

await page.screenshot({ path: path.join(shotDir, "ui-single.png"), fullPage: true });

// --- Theme toggle ---
await page.click("#theme-toggle");
const stampedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
check(stampedTheme === "dark", `theme toggle stamps data-theme="dark" (got "${stampedTheme}")`);
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(shotDir, "ui-dark.png"), fullPage: true });
await page.click("#theme-toggle");

// --- Batch flow ---
await page.click("#tab-batch");
await page.setInputFiles("#csv-input", "SampleFiles/batch_links.csv");
await page.waitForSelector("#batch-preview:not(.hidden)");
check(await page.locator("#batch-table tbody tr").count() === 5, "5 CSV rows parsed");
check((await page.locator("#batch-summary").textContent()).includes("5 of 5"), "all rows valid");

const dlZip = page.waitForEvent("download", { timeout: 60000 });
await page.click("#btn-batch-generate");
const zipDownload = await dlZip;
const zipPath = path.join(shotDir, "batch.zip");
await zipDownload.saveAs(zipPath);
check(fs.statSync(zipPath).size > 10000, `batch ZIP downloaded (${fs.statSync(zipPath).size} bytes)`);

await page.screenshot({ path: path.join(shotDir, "ui-batch.png"), fullPage: true });

// --- Mobile viewport ---
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
check(!hasHScroll, "no horizontal scroll at 375px");
await page.screenshot({ path: path.join(shotDir, "ui-mobile.png"), fullPage: true });

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
