/* Tessel — single + batch QR generation with qr-code-styling */
(() => {
  "use strict";

  const { normalizeUrl, safeFilename, quietZoneMargin, moduleCount } = window.Tessel;

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
      // ISO/IEC 18004: quiet zone of at least 4 modules on every side
      margin: quietZoneMargin(size, data || " ", state.ecc),
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

  function refreshPreview(designChanged = true) {
    // Recreate the instance instead of update(): update() deep-merges
    // options, so removed keys (e.g. a disabled gradient) would linger.
    previewEl.textContent = "";
    new QRCodeStyling(buildOptions({ size: 300 })).append(previewEl);
    clearTimeout(scanCheckTimer);
    scanCheckTimer = setTimeout(runScanCheck, 500);
    // batch codes share the design, so a design change makes any per-row
    // "verified" claim stale — content-only changes (designChanged=false) don't
    if (designChanged && state.batchRows.some((r) => r.verified !== undefined)) {
      state.batchRows.forEach((r) => { delete r.verified; });
      if (!$("batch-preview").classList.contains("hidden")) renderBatchPreview();
    }
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
    off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 11v5"/></svg>',
  };

  function setBadge(stateName, title, advice) {
    scanBadge.hidden = false;
    scanBadge.className = `scan-badge ${stateName}`;
    scanBadge.setAttribute("aria-busy", String(stateName === "checking"));
    $("scan-icon").innerHTML = BADGE_ICONS[stateName];
    $("scan-title").textContent = title;
    $("scan-advice").textContent = advice;
  }

  // Guideline cautions that apply even when the code decodes: ZXing reads
  // inverted codes (tryInvert), but many scanner apps only handle
  // dark-on-light, and transparency depends on the surface behind the code.
  function relativeLuminance(hex) {
    const [r, g, b] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function guidelineCaution() {
    const dotsLum = state.dotsGradient
      ? (relativeLuminance(state.dotsColor) + relativeLuminance(state.dotsColor2)) / 2
      : relativeLuminance(state.dotsColor);
    if (state.bgTransparent) {
      return " Note: with a transparent background, place the code on a light surface.";
    }
    if (dotsLum > relativeLuminance(state.bgColor)) {
      return " Caution: light-on-dark codes fail in some scanner apps — the guideline is dark modules on a light background.";
    }
    return "";
  }

  async function loadZxing() {
    if (zxingReader || zxingFailed) return zxingReader;
    try {
      zxingReader = await import(
        "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/es/reader/index.js"
      );
    } catch {
      zxingFailed = true;
      // A trust product must say when verification is off, not just vanish it
      setBadge("off", "Verification unavailable",
        "The ZXing decoder could not load (offline?). Codes still generate, but are not machine-verified.");
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
        setBadge("ok", "Verified scannable", `Decoded correctly at ${state.size}px export size.${guidelineCaution()}`);
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
  function syncContentState() {
    const empty = !state.content;
    $("btn-download-png").disabled = empty;
    $("btn-download-svg").disabled = empty;
    $("btn-copy-png").disabled = empty;
    // Dense-code guideline: long content means small modules that scan
    // poorly in print — surface it before the user finds out at the printer.
    const hint = $("content-hint");
    if (!empty && state.content.length > 200) {
      const n = moduleCount(state.content, state.ecc);
      hint.textContent = `Long content produces a dense ${n}×${n} code that is harder to scan in print — consider a shorter URL.`;
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  // Select the seeded example on first focus so typing replaces it directly
  let contentPristine = true;
  $("qr-content").addEventListener("focus", (e) => {
    if (contentPristine) e.target.select();
  });

  $("qr-content").addEventListener("input", (e) => {
    contentPristine = false;
    state.content = e.target.value.trim();
    syncContentState();
    refreshPreview(false);
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
      let v = hexInput.value.trim();
      // accept #rgb shorthand
      if (/^#[0-9a-fA-F]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
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
  function setSegmented(containerId, datasetKey, value) {
    $(containerId).querySelectorAll(".seg-btn").forEach((b) => {
      const on = b.dataset[datasetKey] === value;
      b.classList.toggle("active", on);
      if (b.getAttribute("role") === "radio") b.setAttribute("aria-checked", String(on));
    });
  }

  function bindSegmented(containerId, datasetKey, apply) {
    $(containerId).addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      setSegmented(containerId, datasetKey, btn.dataset[datasetKey]);
      apply(btn.dataset[datasetKey]);
    });
  }

  bindSegmented("corner-square-style", "value", (v) => { state.cornersSquareType = v; refreshPreview(); });
  bindSegmented("corner-dot-style", "value", (v) => { state.cornersDotType = v; refreshPreview(); });
  bindSegmented("size-options", "size", (v) => { state.size = parseInt(v, 10); refreshPreview(); });
  bindSegmented("batch-format", "format", (v) => { state.batchFormat = v; });

  // ---------- ECC ----------
  function setEcc(level) {
    state.ecc = level;
    document.querySelectorAll(".ecc-card").forEach((c) => {
      const active = c.dataset.ecc === level;
      c.classList.toggle("active", active);
      c.setAttribute("aria-checked", String(active));
    });
    syncContentState();
  }

  $("ecc-grid").addEventListener("click", (e) => {
    const card = e.target.closest(".ecc-card");
    if (!card) return;
    setEcc(card.dataset.ecc);
    refreshPreview();
  });

  // ---------- Logo ----------
  $("logo-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast("Logo must be 2MB or smaller.", "error");
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
      if (state.ecc !== "H") setEcc("H");
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
  function triggerDownload(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
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

  // ---------- Copy to clipboard ----------
  if (!(navigator.clipboard && window.ClipboardItem)) {
    $("btn-copy-png").classList.add("hidden"); // no clipboard-image support
  }
  $("btn-copy-png").addEventListener("click", async () => {
    try {
      const qr = new QRCodeStyling(buildOptions());
      const blob = await qr.getRawData("png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("PNG copied to clipboard");
    } catch {
      showToast("Copy failed — try downloading instead", "error");
    }
  });

  // ---------- Reset design ----------
  const DESIGN_DEFAULTS = {
    dotsType: "dots",
    dotsColor: "#000000",
    dotsColor2: "#0D9488",
    dotsGradient: false,
    bgColor: "#ffffff",
    bgTransparent: false,
    cornersSquareType: "extra-rounded",
    cornersDotType: "dot",
    ecc: "H",
    logo: null,
    logoSize: 0.3,
    logoHideDots: true,
  };

  $("btn-reset-design").addEventListener("click", () => {
    Object.assign(state, DESIGN_DEFAULTS);
    styleGrid.querySelectorAll(".style-option").forEach((b) => {
      const on = b.dataset.value === state.dotsType;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    });
    $("dots-color").value = state.dotsColor;
    $("dots-color-hex").value = state.dotsColor;
    $("dots-color2").value = state.dotsColor2;
    $("dots-color2-hex").value = state.dotsColor2;
    $("bg-color").value = state.bgColor;
    $("bg-color-hex").value = state.bgColor;
    $("dots-gradient-toggle").checked = false;
    $("dots-color2-wrap").classList.add("hidden");
    $("bg-transparent").checked = false;
    $("bg-color-row").style.opacity = "1";
    setSegmented("corner-square-style", "value", state.cornersSquareType);
    setSegmented("corner-dot-style", "value", state.cornersDotType);
    setEcc(state.ecc);
    $("logo-input").value = "";
    $("logo-chip").classList.add("hidden");
    $("logo-options").classList.add("hidden");
    $("logo-size").value = "30";
    $("logo-size-val").textContent = "30%";
    $("logo-hide-dots").checked = true;
    refreshPreview();
    showToast("Design reset to defaults");
  });

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message, variant = "ok") {
    const toast = $("toast");
    toast.innerHTML = `${BADGE_ICONS[variant === "error" ? "bad" : "ok"]}<span></span>`;
    toast.querySelector("span").textContent = message;
    toast.className = variant === "error" ? "toast toast-error show" : "toast show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), variant === "error" ? 4000 : 2600);
  }


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
    triggerDownload(new Blob([csv], { type: "text/csv" }), "qr-batch-template.csv");
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

  function parseCsvFile(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: ({ data, meta }) => {
        if (!meta.fields || !meta.fields.includes("url")) {
          showToast('CSV needs a "url" column — download the template for the format.', "error");
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
      error: (err) => showToast(`Could not parse CSV: ${err.message}`, "error"),
    });
  }

  let batchSort = { key: "index", dir: 1 };
  let batchFileName = "";

  const ROW_ICONS = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>',
    bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    dot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg>',
  };

  // Per-row status: pending rows are neutral; after generation each row is
  // marked verified (decoded back to its URL) or failed.
  function rowBadgeState(row) {
    if (!row.valid) return { cls: "bad", icon: ROW_ICONS.bad, text: "skipped" };
    if (row.verified === true) return { cls: "ok", icon: ROW_ICONS.ok, text: "verified" };
    if (row.verified === false) return { cls: "bad", icon: ROW_ICONS.bad, text: "failed scan" };
    return { cls: "neutral", icon: ROW_ICONS.dot, text: "ready" };
  }

  function renderBatchPreview() {
    const rows = state.batchRows;
    const validCount = rows.filter((r) => r.valid).length;
    // Build with DOM APIs: the file name is user-controlled and must never
    // reach innerHTML (a file named "<img onerror=…>.csv" is valid on disk).
    const summary = $("batch-summary");
    summary.textContent = "";
    const nameEl = document.createElement("strong");
    nameEl.textContent = batchFileName;
    summary.append(nameEl, ` — ${validCount} of ${rows.length} row${rows.length === 1 ? "" : "s"} ready to generate.`);

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

      const tdIndex = document.createElement("td");
      tdIndex.className = "mono";
      tdIndex.textContent = String(row.index);
      tr.appendChild(tdIndex);

      // bridge to the Single tab: inspect any row without retyping its URL
      const tdName = document.createElement("td");
      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "link-btn";
      nameBtn.textContent = row.name;
      nameBtn.title = row.valid ? `Preview “${row.name}” in the Single tab` : row.name;
      nameBtn.disabled = !row.valid;
      nameBtn.addEventListener("click", () => previewRow(row));
      tdName.appendChild(nameBtn);
      tr.appendChild(tdName);

      const tdUrl = document.createElement("td");
      tdUrl.className = "mono";
      tdUrl.textContent = row.url || "(missing url)";
      tdUrl.title = tdUrl.textContent;
      tr.appendChild(tdUrl);
      const tdBadge = document.createElement("td");
      const badge = document.createElement("span");
      const badgeState = rowBadgeState(row);
      badge.className = `row-badge ${badgeState.cls}`;
      badge.innerHTML = `${badgeState.icon}<span></span>`;
      badge.querySelector("span").textContent = badgeState.text;
      tdBadge.appendChild(badge);
      tr.appendChild(tdBadge);
      tbody.appendChild(tr);
    });

    $("batch-preview").classList.remove("hidden");
    $("btn-batch-generate").disabled = validCount === 0;
  }

  function previewRow(row) {
    state.content = row.url;
    state.fileName = row.name;
    $("qr-content").value = row.url;
    $("qr-name").value = row.name;
    contentPristine = false;
    setTab("single");
    syncContentState();
    refreshPreview(false);
    showToast(`Previewing “${row.name}”`);
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
  let batchAbort = false;
  $("btn-batch-cancel").addEventListener("click", () => {
    batchAbort = true;
    $("btn-batch-cancel").disabled = true;
  });

  $("btn-batch-generate").addEventListener("click", async () => {
    const rows = state.batchRows.filter((r) => r.valid);
    if (!rows.length) return;

    const btn = $("btn-batch-generate");
    const progress = $("batch-progress");
    const bar = $("batch-progress-bar");
    const label = $("batch-progress-label");

    btn.disabled = true;
    batchAbort = false;
    $("btn-batch-cancel").disabled = false;
    progress.classList.remove("hidden");

    try {
      const zip = new JSZip();
      const wantPng = state.batchFormat !== "svg";
      const wantSvg = state.batchFormat !== "png";
      const usedNames = new Map();
      // The trust promise covers batch too: decode every generated code
      const reader = await loadZxing(); // null when the decoder is unavailable
      let failed = 0;

      for (let i = 0; i < rows.length; i++) {
        if (batchAbort) break;
        const row = rows[i];
        bar.style.width = `${Math.round((i / rows.length) * 100)}%`;
        label.textContent = `Generating ${i + 1} of ${rows.length}: ${row.name}`;

        // de-duplicate file names
        const count = usedNames.get(row.name) || 0;
        usedNames.set(row.name, count + 1);
        const base = count === 0 ? row.name : `${row.name} (${count + 1})`;

        const qr = new QRCodeStyling(buildOptions({ data: row.url }));
        if (wantSvg) zip.file(`${base}.svg`, await qr.getRawData("svg"));
        // PNG is always rendered: it is also the verification medium
        const pngBlob = await qr.getRawData("png");
        if (wantPng) zip.file(`${base}.png`, pngBlob);

        if (reader) {
          try {
            const results = await reader.readBarcodes(pngBlob, { formats: ["QRCode"], tryHarder: true });
            row.verified = Boolean(results.length && results[0].isValid && results[0].text === row.url);
          } catch {
            row.verified = undefined;
          }
          if (row.verified === false) failed++;
        }
      }

      if (batchAbort) {
        label.textContent = "Cancelled — nothing was downloaded.";
      } else {
        bar.style.width = "100%";
        label.textContent = "Packaging ZIP…";
        const blob = await zip.generateAsync({ type: "blob" });
        triggerDownload(blob, "qr-codes.zip");
        renderBatchPreview(); // surface per-row verification results
        const codes = `${rows.length} QR code${rows.length === 1 ? "" : "s"}`;
        const note = !reader
          ? "verification unavailable"
          : failed
            ? `${failed} failed verification`
            : "all verified scannable";
        label.textContent = `Done — ${codes} downloaded, ${note}.`;
        if (failed) showToast(`${failed} code${failed === 1 ? "" : "s"} failed scan verification — check the table`, "error");
        else showToast(`qr-codes.zip — ${codes} downloaded`);
      }
    } catch (err) {
      label.textContent = `Failed: ${err.message}`;
    } finally {
      btn.disabled = false;
      $("btn-batch-cancel").disabled = true;
    }
  });

  // ---------- Keyboard: WAI-ARIA radiogroup pattern ----------
  // Arrow keys move and select within every radiogroup (shapes, corners,
  // correction level, export size, batch format).
  document.querySelectorAll('[role="radiogroup"]').forEach((group) => {
    group.addEventListener("keydown", (e) => {
      const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!delta) return;
      const radios = [...group.querySelectorAll('[role="radio"]')];
      const i = radios.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      const next = radios[(i + delta + radios.length) % radios.length];
      next.focus();
      next.click();
    });
  });

  // ---------- Init ----------
  syncContentState();
  refreshPreview();
})();
