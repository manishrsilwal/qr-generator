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
check(await page.locator("#qr-preview .preview-empty").count() === 1, "empty state shown before content");
check(await page.locator("#scan-badge").isHidden(), "badge hidden in empty state");
check(await page.locator("#dot-style-grid .style-option").count() === 6, "6 dot styles rendered");
check(
  await page.evaluate(() => document.getElementById("card-style").inert && document.getElementById("card-reliability").inert),
  "design cards inert before content"
);

await page.fill("#qr-content", "https://setu.ndrrma.gov.np/");
await page.fill("#qr-name", "setu-test");
await page.waitForTimeout(800);
check(await page.locator("#qr-preview svg, #qr-preview canvas").count() > 0, "preview renders once content exists");
check(
  await page.evaluate(() => !document.getElementById("card-style").inert),
  "design cards enabled once content exists"
);

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

// --- Audit regressions ---
// quiet zone: ISO/IEC 18004 requires >= 4 modules on every side
const qz = await page.evaluate(() => {
  const data = "https://setu.ndrrma.gov.np/";
  const n = window.Tessel.moduleCount(data, "H");
  const margin = window.Tessel.quietZoneMargin(1024, data, "H");
  const modulePx = (1024 - 2 * margin) / n;
  return { n, margin, modulePx, ok: margin >= 4 * modulePx - 1 };
});
check(qz.ok, `quiet zone >= 4 modules (v${(qz.n - 17) / 4}: margin ${qz.margin}px, module ${qz.modulePx.toFixed(1)}px)`);

// inverted colours decode but must carry the light-on-dark caution
await page.click("#btn-invert");
const cautionSeen = await page
  .waitForFunction(() => document.querySelector("#scan-advice")?.textContent.includes("light-on-dark"), null, { timeout: 30000 })
  .then(() => true).catch(() => false);
check(cautionSeen, "inverted code shows light-on-dark guideline caution");
await page.click("#btn-invert");
await page.waitForTimeout(600);

// empty content must disable downloads and copy, and the badge must agree
await page.fill("#qr-content", "");
check(await page.locator("#btn-download-png").isDisabled(), "downloads disabled with empty content");
check(await page.locator("#btn-copy-png").isDisabled(), "copy disabled with empty content");
await page.waitForTimeout(700);
check(
  await page.locator("#qr-preview .preview-empty").count() === 1,
  "empty state returns when content is cleared"
);
await page.fill("#qr-content", "https://setu.ndrrma.gov.np/");
await page.waitForTimeout(600);

// arrow keys move selection within radiogroups (WAI-ARIA pattern)
await page.focus('#size-options .seg-btn[data-size="1024"]');
await page.keyboard.press("ArrowRight");
check(
  await page.locator('#size-options .seg-btn[data-size="2048"]').evaluate((el) => el.classList.contains("active")),
  "arrow keys move radiogroup selection"
);
await page.click('#size-options .seg-btn[data-size="1024"]');

// reset restores default design after changes
await page.click('#dot-style-grid .style-option[data-value="square"]');
await page.click("#btn-reset-design");
check(
  await page.locator('#dot-style-grid .style-option[data-value="dots"]').evaluate((el) => el.classList.contains("active")),
  "reset restores default design"
);
await page.waitForTimeout(600);

const waitBadgeOk = () =>
  page.waitForFunction(() => document.getElementById("scan-badge")?.className === "scan-badge ok", null, { timeout: 30000 })
    .then(() => true).catch(() => false);

// content types: Wi-Fi payload builds and verifies
await page.click('#content-type .chip[data-type="wifi"]');
await page.fill("#tf-wifi-ssid", "Relief-Center");
await page.fill("#tf-wifi-pass", "nepal2026");
const wifiPayload = await page.locator("#payload-preview").textContent();
check(wifiPayload.startsWith("WIFI:T:WPA;S:Relief-Center;"), `Wi-Fi payload built (${wifiPayload.trim()})`);
check(
  (await page.getAttribute("#tf-wifi-pass", "placeholder")) === "Network password",
  "generated fields carry placeholders"
);
await page.waitForTimeout(700);
check(await waitBadgeOk(), "Wi-Fi QR verified scannable");
await page.click('#content-type .chip[data-type="url"]');
await page.waitForTimeout(400);

// frame label: the composed artifact still verifies and downloads
await page.click('#frame-style .seg-btn[data-frame="label"]');
await page.waitForTimeout(700);
check(await waitBadgeOk(), "framed code verified scannable");
const dlFramed = page.waitForEvent("download");
await page.click("#btn-download-png");
const framedPath = path.join(shotDir, "framed.png");
await (await dlFramed).saveAs(framedPath);
check(fs.statSync(framedPath).size > 5000, "framed PNG downloaded");
await page.screenshot({ path: path.join(shotDir, "ui-frame.png"), fullPage: false });
await page.click('#frame-style .seg-btn[data-frame="none"]');
await page.waitForTimeout(400);

await page.screenshot({ path: path.join(shotDir, "ui-single.png"), fullPage: true });

// --- Batch flow ---
// leave a non-URL type selected so the row-bridge test proves it resets
await page.click('#content-type .chip[data-type="wifi"]');
await page.click("#tab-batch");

// XSS regression: a hostile CSV *filename* must render as text, never HTML
const evilPath = path.join(shotDir, "<img src=x onerror=window.__xss=1>.csv");
fs.copyFileSync("SampleFiles/batch_links.csv", evilPath);
await page.setInputFiles("#csv-input", evilPath);
await page.waitForSelector("#batch-preview:not(.hidden)");
const xssFired = await page.evaluate(() => window.__xss === 1);
const summaryText = await page.locator("#batch-summary").textContent();
check(!xssFired && summaryText.includes("<img"), "CSV filename rendered as text, not HTML");
fs.unlinkSync(evilPath);

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

// per-row verification after generation
await page.waitForFunction(
  () => document.querySelector("#batch-progress-label")?.textContent.includes("Done"),
  null, { timeout: 30000 }
);
check(
  (await page.locator("#batch-progress-label").textContent()).includes("all verified scannable"),
  "batch completion reports verification"
);
const firstRowBadge = await page.locator("#batch-table tbody tr >> nth=0").locator(".row-badge").textContent();
check(firstRowBadge.includes("verified"), `rows show per-code verification (badge: ${firstRowBadge.trim()})`);

// a design change must invalidate stale verified claims
await page.click('#corner-square-style .seg-btn[data-value="square"]');
await page.waitForTimeout(200);
const invalidatedBadge = await page.locator("#batch-table tbody tr >> nth=0").locator(".row-badge").textContent();
check(invalidatedBadge.includes("ready"), "design change invalidates verified badges");
await page.click('#corner-square-style .seg-btn[data-value="extra-rounded"]');
await page.waitForTimeout(300);

await page.screenshot({ path: path.join(shotDir, "ui-batch.png"), fullPage: true });

// row → Single-tab preview bridge
await page.click("#batch-table .link-btn >> nth=2");
check(await page.locator("#panel-single:not(.hidden)").count() === 1, "row click opens Single tab");
check((await page.inputValue("#qr-content")).includes("setu"), "row URL loaded into content field");
check(
  await page.locator('#content-type .chip[data-type="url"]').evaluate((el) => el.classList.contains("active")),
  "row preview resets content type to URL"
);
await page.click("#tab-batch");

// --- Mobile viewport ---
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
check(!hasHScroll, "no horizontal scroll at 375px");

// mini preview appears when the main preview scrolls out of view
await page.click("#tab-single");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
check(await page.locator("#mini-preview:not(.hidden)").count() === 1, "mini preview appears on mobile scroll");
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(600);
check(await page.locator("#mini-preview.hidden").count() === 1, "mini preview hides when preview is visible");

await page.screenshot({ path: path.join(shotDir, "ui-mobile.png"), fullPage: true });

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
