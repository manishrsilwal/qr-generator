/* Tessel — single + batch QR generation with qr-code-styling */
(() => {
  "use strict";

  // ---------- State ----------
  const state = {
    content: "https://example.com",
    fileName: "",
    size: 1024,
    dotsType: "dots",
    dotsColor: "#000000",
    dotsColor2: "#0D9488",
    dotsGradient: false,
    bgColor: "#ffffff",
    bgTransparent: false,
    cornersSquareType: "extra-rounded",
    cornersDotType: "dot",
    ecc: "H",
    logo: null, // data URL
    logoSize: 0.3,
    logoHideDots: true,
    batchRows: [],
    batchFormat: "both",
  };

  const $ = (id) => document.getElementById(id);

  const DOT_STYLES = [
    { value: "square", label: "Square" },
    { value: "dots", label: "Dots" },
    { value: "rounded", label: "Rounded" },
    { value: "extra-rounded", label: "Extra round" },
    { value: "classy", label: "Classy" },
    { value: "classy-rounded", label: "Classy round" },
  ];

  // ---------- Options builder ----------
  function buildOptions({ data = state.content, size = state.size } = {}) {
    const opts = {
      width: size,
      height: size,
      type: "svg",
      data: data || " ",
      margin: Math.round(size * 0.04),
      qrOptions: { errorCorrectionLevel: state.ecc },
      dotsOptions: { type: state.dotsType },
      backgroundOptions: {
        color: state.bgTransparent ? "rgba(255,255,255,0)" : state.bgColor,
      },
      cornersSquareOptions: { type: state.cornersSquareType },
      cornersDotOptions: { type: state.cornersDotType },
    };

    if (state.dotsGradient) {
      const gradient = {
        type: "linear",
        rotation: Math.PI / 4,
        colorStops: [
          { offset: 0, color: state.dotsColor },
          { offset: 1, color: state.dotsColor2 },
        ],
      };
      opts.dotsOptions.gradient = gradient;
      opts.cornersSquareOptions.gradient = gradient;
      opts.cornersDotOptions.gradient = gradient;
    } else {
      opts.dotsOptions.color = state.dotsColor;
      opts.cornersSquareOptions.color = state.dotsColor;
      opts.cornersDotOptions.color = state.dotsColor;
    }

    if (state.logo) {
      opts.image = state.logo;
      opts.imageOptions = {
        crossOrigin: "anonymous",
        margin: Math.round(size * 0.008),
        imageSize: state.logoSize,
        hideBackgroundDots: state.logoHideDots,
      };
    }

    return opts;
  }

  // ---------- Live preview ----------
  const previewEl = $("qr-preview");
  let scanCheckTimer = null;

  function refreshPreview() {
    // Recreate the instance instead of update(): update() deep-merges
    // options, so removed keys (e.g. a disabled gradient) would linger.
    previewEl.textContent = "";
    new QRCodeStyling(buildOptions({ size: 300 })).append(previewEl);
    clearTimeout(scanCheckTimer);
    scanCheckTimer = setTimeout(runScanCheck, 500);
  }

  // ---------- Scannability check (best effort, via zxing-wasm) ----------
  const scanBadge = $("scan-badge");
  let zxingReader = null;
  let zxingFailed = false;
  let scanRunId = 0;

  const BADGE_ICONS = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12.5 2.5 2.5L16 9.5"/></svg>',
    bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    checking: '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>',
  };

  function setBadge(stateName, title, advice) {
    scanBadge.hidden = false;
    scanBadge.className = `scan-badge ${stateName}`;
    scanBadge.setAttribute("aria-busy", String(stateName === "checking"));
    $("scan-icon").innerHTML = BADGE_ICONS[stateName];
    $("scan-title").textContent = title;
    $("scan-advice").textContent = advice;
  }

  async function loadZxing() {
    if (zxingReader || zxingFailed) return zxingReader;
    try {
      zxingReader = await import(
        "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/es/reader/index.js"
      );
    } catch {
      zxingFailed = true;
      scanBadge.hidden = true;
    }
    return zxingReader;
  }

  async function runScanCheck() {
    const runId = ++scanRunId;
    const reader = await loadZxing();
    if (!reader) return;

    // Anti-flash: keep the settled state dimmed, and only swap to the
    // spinner if the decode is still running after 350ms.
    const hasSettledState = !scanBadge.hidden && !scanBadge.classList.contains("checking");
    if (hasSettledState) scanBadge.classList.add("stale");
    const checkingTimer = setTimeout(() => {
      if (runId === scanRunId) {
        setBadge("checking", "Verifying scannability…", "Decoding the export-size image with ZXing.");
      }
    }, hasSettledState ? 350 : 0);

    try {
      // Verify at export size so the result reflects the real download
      const qr = new QRCodeStyling(buildOptions());
      const blob = await qr.getRawData("png");
      const results = await reader.readBarcodes(blob, {
        formats: ["QRCode"],
        tryHarder: true,
      });
      if (runId !== scanRunId) return; // stale check, newer one is running
      clearTimeout(checkingTimer);
      const decoded = results.length && results[0].isValid ? results[0].text : null;
      if (decoded === (state.content || " ")) {
        setBadge("ok", "Verified scannable", `Decoded correctly at ${state.size}px export size.`);
      } else {
        setBadge("bad", "Hard to scan", "Increase contrast, reduce the logo size, or raise the correction level.");
      }
    } catch {
      clearTimeout(checkingTimer);
      if (runId === scanRunId) scanBadge.hidden = true;
    }
  }

  // ---------- Dot style grid with mini previews ----------
  const styleGrid = $("dot-style-grid");
  DOT_STYLES.forEach(({ value, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "style-option" + (value === state.dotsType ? " active" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(value === state.dotsType));
    btn.dataset.value = value;

    const thumb = document.createElement("span");
    thumb.className = "thumb";
    const name = document.createElement("span");
    name.className = "style-name";
    name.textContent = label;
    btn.append(thumb, name);
    styleGrid.appendChild(btn);

    new QRCodeStyling({
      width: 96,
      height: 96,
      type: "svg",
      data: "QR",
      margin: 0,
      qrOptions: { errorCorrectionLevel: "L" },
      dotsOptions: { type: value, color: "#0f172a" },
      backgroundOptions: { color: "transparent" },
      cornersSquareOptions: { type: value === "square" ? "square" : "extra-rounded", color: "#0f172a" },
      cornersDotOptions: { type: value === "square" ? "square" : "dot", color: "#0f172a" },
    }).append(thumb);

    btn.addEventListener("click", () => {
      styleGrid.querySelectorAll(".style-option").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-checked", String(b === btn));
      });
      state.dotsType = value;
      refreshPreview();
    });
  });

  // ---------- Content inputs ----------
  $("qr-content").addEventListener("input", (e) => {
    state.content = e.target.value.trim();
    refreshPreview();
  });

  $("qr-name").addEventListener("input", (e) => {
    state.fileName = e.target.value.trim();
  });

  // ---------- Colour controls ----------
  function bindColorPair(colorId, hexId, key) {
    const colorInput = $(colorId);
    const hexInput = $(hexId);
    colorInput.addEventListener("input", () => {
      state[key] = colorInput.value;
      hexInput.value = colorInput.value;
      refreshPreview();
    });
    hexInput.addEventListener("input", () => {
      const v = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        state[key] = v;
        colorInput.value = v;
        refreshPreview();
      }
    });
  }

  bindColorPair("dots-color", "dots-color-hex", "dotsColor");
  bindColorPair("dots-color2", "dots-color2-hex", "dotsColor2");
  bindColorPair("bg-color", "bg-color-hex", "bgColor");

  $("dots-gradient-toggle").addEventListener("change", (e) => {
    state.dotsGradient = e.target.checked;
    $("dots-color2-wrap").classList.toggle("hidden", !state.dotsGradient);
    refreshPreview();
  });

  $("bg-transparent").addEventListener("change", (e) => {
    state.bgTransparent = e.target.checked;
    $("bg-color-row").style.opacity = state.bgTransparent ? "0.4" : "1";
    refreshPreview();
  });

  $("btn-invert").addEventListener("click", () => {
    const dots = state.dotsColor;
    state.dotsColor = state.bgColor;
    state.bgColor = dots;
    $("dots-color").value = state.dotsColor;
    $("dots-color-hex").value = state.dotsColor;
    $("bg-color").value = state.bgColor;
    $("bg-color-hex").value = state.bgColor;
    refreshPreview();
  });

  // ---------- Segmented helpers ----------
  function bindSegmented(containerId, datasetKey, apply) {
    const container = $(containerId);
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      container.querySelectorAll(".seg-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
        if (b.getAttribute("role") === "radio") b.setAttribute("aria-checked", String(b === btn));
      });
      apply(btn.dataset[datasetKey]);
    });
  }

  bindSegmented("corner-square-style", "value", (v) => { state.cornersSquareType = v; refreshPreview(); });
  bindSegmented("corner-dot-style", "value", (v) => { state.cornersDotType = v; refreshPreview(); });
  bindSegmented("size-options", "size", (v) => { state.size = parseInt(v, 10); refreshPreview(); });
  bindSegmented("batch-format", "format", (v) => { state.batchFormat = v; });

  // ---------- ECC ----------
  $("ecc-grid").addEventListener("click", (e) => {
    const card = e.target.closest(".ecc-card");
    if (!card) return;
    document.querySelectorAll(".ecc-card").forEach((c) => c.classList.toggle("active", c === card));
    state.ecc = card.dataset.ecc;
    refreshPreview();
  });

  // ---------- Logo ----------
  $("logo-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Logo must be 2MB or smaller.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.logo = reader.result;
      $("logo-thumb").src = state.logo;
      $("logo-chip").classList.remove("hidden");
      $("logo-options").classList.remove("hidden");
      // A logo hides modules; H gives the most headroom to stay scannable
      if (state.ecc !== "H") {
        state.ecc = "H";
        document.querySelectorAll(".ecc-card").forEach((c) =>
          c.classList.toggle("active", c.dataset.ecc === "H"));
      }
      refreshPreview();
    };
    reader.readAsDataURL(file);
  });

  $("btn-logo-remove").addEventListener("click", () => {
    state.logo = null;
    $("logo-input").value = "";
    $("logo-chip").classList.add("hidden");
    $("logo-options").classList.add("hidden");
    refreshPreview();
  });

  $("logo-size").addEventListener("input", (e) => {
    state.logoSize = parseInt(e.target.value, 10) / 100;
    $("logo-size-val").textContent = `${e.target.value}%`;
    refreshPreview();
  });

  $("logo-hide-dots").addEventListener("change", (e) => {
    state.logoHideDots = e.target.checked;
    refreshPreview();
  });

  // ---------- Downloads (single) ----------
  function safeFilename(name) {
    return (name || "").trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").slice(0, 120);
  }

  function singleFileName() {
    return safeFilename(state.fileName) || "qr-code";
  }

  async function downloadSingle(extension) {
    const qr = new QRCodeStyling(buildOptions());
    await qr.download({ name: singleFileName(), extension });
    showToast(`Downloaded ${singleFileName()}.${extension}`);
  }

  $("btn-download-png").addEventListener("click", () => downloadSingle("png"));
  $("btn-download-svg").addEventListener("click", () => downloadSingle("svg"));

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message) {
    const toast = $("toast");
    toast.innerHTML = `${BADGE_ICONS.ok}<span></span>`;
    toast.querySelector("span").textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  // ---------- Theme toggle ----------
  const themeBtn = $("theme-toggle");

  function effectiveTheme() {
    return document.documentElement.dataset.theme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  function syncThemeLabel() {
    themeBtn.setAttribute(
      "aria-label",
      effectiveTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
  }

  themeBtn.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("tessel-theme", next); } catch {}
    syncThemeLabel();
  });
  syncThemeLabel();

  // ---------- Tabs ----------
  const tabSingle = $("tab-single");
  const tabBatch = $("tab-batch");

  function setTab(tab) {
    const single = tab === "single";
    tabSingle.classList.toggle("active", single);
    tabBatch.classList.toggle("active", !single);
    tabSingle.setAttribute("aria-selected", String(single));
    tabBatch.setAttribute("aria-selected", String(!single));
    $("panel-single").classList.toggle("hidden", !single);
    $("panel-batch").classList.toggle("hidden", single);
  }

  tabSingle.addEventListener("click", () => setTab("single"));
  tabBatch.addEventListener("click", () => setTab("batch"));

  // ---------- Batch: CSV template ----------
  $("btn-template").addEventListener("click", () => {
    const csv = "qrName,hostname,scanLimit,url\nMy First QR,,,https://example.com\nMy Second QR,,,https://example.org\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "qr-batch-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- Batch: CSV upload ----------
  const dropzone = $("dropzone");
  const csvInput = $("csv-input");

  dropzone.addEventListener("click", () => csvInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); csvInput.click(); }
  });
  ["dragover", "dragenter"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) parseCsvFile(file);
  });
  csvInput.addEventListener("change", (e) => {
    if (e.target.files[0]) parseCsvFile(e.target.files[0]);
  });

  function normalizeUrl(url) {
    const trimmed = (url || "").trim();
    if (!trimmed) return "";
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  function parseCsvFile(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: ({ data, meta }) => {
        if (!meta.fields || !meta.fields.includes("url")) {
          alert('CSV must contain a "url" column. Download the template for the expected format.');
          return;
        }
        state.batchRows = data.map((row, i) => {
          const url = normalizeUrl(row.url);
          return {
            index: i + 1,
            name: safeFilename(row.qrName) || `qr-${i + 1}`,
            url,
            valid: Boolean(url),
          };
        });
        batchSort = { key: "index", dir: 1 };
        batchFileName = file.name;
        renderBatchPreview();
      },
      error: (err) => alert(`Could not parse CSV: ${err.message}`),
    });
  }

  let batchSort = { key: "index", dir: 1 };
  let batchFileName = "";

  const ROW_ICONS = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>',
    bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  };

  function renderBatchPreview() {
    const rows = state.batchRows;
    const validCount = rows.filter((r) => r.valid).length;
    $("batch-summary").innerHTML =
      `<strong>${batchFileName}</strong> — ${validCount} of ${rows.length} row${rows.length === 1 ? "" : "s"} ready to generate.`;

    // sorted view for the table only; generation keeps CSV order
    const view = [...rows].sort((a, b) => {
      const { key, dir } = batchSort;
      const av = a[key], bv = b[key];
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av === bv ? 0 : av < bv ? -1 : 1) * dir;
    });

    document.querySelectorAll("#batch-table th").forEach((th) => {
      if (th.dataset.sort === batchSort.key) {
        th.setAttribute("aria-sort", batchSort.dir === 1 ? "ascending" : "descending");
      } else {
        th.removeAttribute("aria-sort");
      }
    });

    const tbody = $("batch-table").querySelector("tbody");
    tbody.textContent = "";
    view.forEach((row) => {
      const tr = document.createElement("tr");
      [
        [String(row.index), "mono"],
        [row.name, ""],
        [row.url || "(missing url)", "mono"],
      ].forEach(([text, cls]) => {
        const td = document.createElement("td");
        if (cls) td.className = cls;
        td.textContent = text;
        td.title = text;
        tr.appendChild(td);
      });
      const tdBadge = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `row-badge ${row.valid ? "ok" : "bad"}`;
      badge.innerHTML = `${row.valid ? ROW_ICONS.ok : ROW_ICONS.bad}<span></span>`;
      badge.querySelector("span").textContent = row.valid ? "ready" : "skipped";
      tdBadge.appendChild(badge);
      tr.appendChild(tdBadge);
      tbody.appendChild(tr);
    });

    $("batch-preview").classList.remove("hidden");
    $("btn-batch-generate").disabled = validCount === 0;
  }

  $("batch-table").querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th || !state.batchRows.length) return;
    const key = th.dataset.sort;
    batchSort = {
      key,
      dir: batchSort.key === key ? -batchSort.dir : 1,
    };
    renderBatchPreview();
  });

  // ---------- Batch: generate ZIP ----------
  $("btn-batch-generate").addEventListener("click", async () => {
    const rows = state.batchRows.filter((r) => r.valid);
    if (!rows.length) return;

    const btn = $("btn-batch-generate");
    const progress = $("batch-progress");
    const bar = $("batch-progress-bar");
    const label = $("batch-progress-label");

    btn.disabled = true;
    progress.classList.remove("hidden");

    try {
      const zip = new JSZip();
      const wantPng = state.batchFormat !== "svg";
      const wantSvg = state.batchFormat !== "png";
      const usedNames = new Map();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        bar.style.width = `${Math.round((i / rows.length) * 100)}%`;
        label.textContent = `Generating ${i + 1} of ${rows.length}: ${row.name}`;

        // de-duplicate file names
        const count = usedNames.get(row.name) || 0;
        usedNames.set(row.name, count + 1);
        const base = count === 0 ? row.name : `${row.name} (${count + 1})`;

        const qr = new QRCodeStyling(buildOptions({ data: row.url }));
        if (wantSvg) zip.file(`${base}.svg`, await qr.getRawData("svg"));
        if (wantPng) zip.file(`${base}.png`, await qr.getRawData("png"));
      }

      bar.style.width = "100%";
      label.textContent = "Packaging ZIP…";
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "qr-codes.zip";
      a.click();
      URL.revokeObjectURL(a.href);
      label.textContent = `Done — ${rows.length} QR code${rows.length === 1 ? "" : "s"} downloaded.`;
      showToast(`qr-codes.zip — ${rows.length} code${rows.length === 1 ? "" : "s"} downloaded`);
    } catch (err) {
      label.textContent = `Failed: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Init ----------
  refreshPreview();
})();
