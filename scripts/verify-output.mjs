// Decodes every PNG in output/ with jsQR and prints the embedded URL.
// Usage: node scripts/verify-output.mjs [outputDir]
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { readBarcodes } from "zxing-wasm/reader";

const outDir = process.argv[2] ?? "output";
let failures = 0;
for (const file of fs.readdirSync(outDir).filter(f => f.endsWith(".png")).sort()) {
  const png = PNG.sync.read(fs.readFileSync(path.join(outDir, file)));
  const results = await readBarcodes(
    { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height },
    { formats: ["QRCode"] }
  );
  if (results.length && results[0].isValid) console.log(`✓ ${file}  →  ${results[0].text}`);
  else { console.error(`✗ ${file}  →  FAILED TO DECODE`); failures++; }
}
process.exit(failures ? 1 : 0);
