// Batch QR generator (Node CLI)
// Usage: node scripts/generate-batch.mjs [input.csv] [outputDir]
// CSV columns: qrName,hostname,scanLimit,url
// Outputs one SVG + one PNG per row, styled to match SampleFiles/SampleQR.png
// (dot-shaped modules, black on white, error correction H).

import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Resvg } from "@resvg/resvg-js";
import { QRCodeStyling } from "qr-code-styling/lib/qr-code-styling.common.js";

const inputCsv = process.argv[2] ?? "SampleFiles/batch_links.csv";
const outDir = process.argv[3] ?? "output";
const PNG_SIZE = 1024;

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

function normalizeUrl(url) {
  const trimmed = url.trim();
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function safeFilename(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").slice(0, 120);
}

async function generate(row) {
  const url = normalizeUrl(row.url);
  const qr = new QRCodeStyling({
    jsdom: JSDOM,
    type: "svg",
    width: PNG_SIZE,
    height: PNG_SIZE,
    margin: 40,
    data: url,
    qrOptions: { errorCorrectionLevel: "H" },
    dotsOptions: { type: "dots", color: "#000000" },
    backgroundOptions: { color: "#ffffff" },
    // The sample renders finder corners as chains of dots, but ZXing cannot
    // detect those; solid frames keep the look and scan reliably.
    cornersSquareOptions: { type: "extra-rounded", color: "#000000" },
    cornersDotOptions: { type: "dot", color: "#000000" },
  });

  const svgBuffer = await qr.getRawData("svg");
  // resvg drops clip-paths written as url('#id'); normalize to url(#id)
  const svg = svgBuffer.toString("utf8").replace(/url\('#([^']+)'\)/g, "url(#$1)");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: PNG_SIZE } }).render().asPng();

  const base = safeFilename(row.qrName) || "qr";
  fs.writeFileSync(path.join(outDir, `${base}.svg`), svg);
  fs.writeFileSync(path.join(outDir, `${base}.png`), png);
  return { base, url };
}

const rows = parseCsv(fs.readFileSync(inputCsv, "utf8"));
const header = rows.shift().map(h => h.trim());
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
if (idx.url === undefined || idx.qrName === undefined) {
  console.error(`CSV must have qrName and url columns; found: ${header.join(", ")}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const r of rows) {
  const row = { qrName: r[idx.qrName] ?? "", url: r[idx.url] ?? "" };
  if (!row.url.trim()) continue;
  const { base, url } = await generate(row);
  console.log(`✓ ${base}  →  ${url}`);
}
console.log(`\nDone. Files written to ${path.resolve(outDir)}`);
