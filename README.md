# QR Studio

A QR code generator with single and batch (CSV) generation, styled QR designs, and SVG/PNG export.

![QR Studio](scripts/screenshots/ui-single.png)

## Features

- **Single QR codes** — enter a URL or text, style it, download as SVG or PNG.
- **Batch from CSV** — upload a CSV (`qrName,hostname,scanLimit,url`), preview the rows, and download every QR code in one ZIP (PNG, SVG, or both). A template CSV is downloadable in-app.
- **Design settings** — module shapes (square, dots, rounded, classy…), solid or gradient colours, transparent background, invert, corner frame/center styles, error correction level (L/M/Q/H), central logo upload with size control, and export resolution up to 4096px.
- **Live scannability check** — every preview is decoded with ZXing in the browser; a badge tells you whether the current design actually scans before you print it.

## Run the app

It's a static site — no build step. Serve the folder and open it:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open http://localhost:8000 (or the URL `serve` prints). Opening `index.html` directly from the file system mostly works too, but the scannability badge needs an HTTP origin.

## CLI batch generation

Generate QR codes from a CSV without the browser (used for the urgent batch in `output/`):

```bash
npm install
npm run batch                 # reads SampleFiles/batch_links.csv → output/
node scripts/generate-batch.mjs path/to/file.csv out-dir
npm run verify                # decodes every PNG in output/ to prove it scans
```

## Tests

```bash
npm test   # headless-browser smoke test: single flow, batch flow, downloads, responsive check
```

Requires Playwright's Chromium (`npx playwright install chromium`).

## CSV format

```csv
qrName,hostname,scanLimit,url
My First QR,,,https://example.com
```

- `qrName` → output file name
- `url` → QR content (scheme-less URLs are normalized to `https://`)
- `hostname` and `scanLimit` are accepted but ignored — scan limits and custom hostnames require a dynamic-QR redirect service, which a static generator cannot provide.

## A note on dot-styled finder corners

The original sample QR rendered the three finder corners as chains of dots. ZXing (the decoder inside most scanner apps) cannot reliably detect those, so this project renders data modules as dots but keeps the finder corners solid — same look, reliably scannable. This is verified automatically by `npm run verify` and the in-app badge.
