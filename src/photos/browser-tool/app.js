(() => {
  const CFG = window.BARREL_CONFIG;
  const TEMPLATES_DIR = 'templates';

  const $ = (id) => document.getElementById(id);
  const tabAuto = $('tab-auto');
  const tabManual = $('tab-manual');
  const panelAuto = $('panel-auto');
  const panelManual = $('panel-manual');
  const dropAuto = $('drop-auto');
  const dropManual = $('drop-manual');
  const fileInputAuto = $('fileInputAuto');
  const fileInputManual = $('fileInputManual');
  const templateSelect = $('templateSelect');
  const countrySelectAuto = $('countrySelectAuto');
  const countrySelectManual = $('countrySelectManual');
  const btnGenerate = $('generate');
  const btnDownloadAll = $('downloadAll');
  const btnClear = $('clear');
  const btnToggleLog = $('toggleLog');
  const logOverlay = $('logOverlay');
  const btnCloseLog = $('closeLog');
  const logEl = $('log');
  const statsEl = $('stats');
  const resultsEl = $('results');

  let mode = 'auto';
  let barrelFiles = [];
  let generated = [];
  let templateCache = null;
  let selectedTemplate = '';
  let selectedCountryAuto = '';
  let selectedCountryManual = '';

  // -------- core logic --------

  function resolveValue(code) {
    const last3 = code.slice(-3);
    if (
      code.charAt(0) === '7' &&
      CFG.KG_PREFIX7_MAP &&
      Object.prototype.hasOwnProperty.call(CFG.KG_PREFIX7_MAP, last3)
    ) {
      return { unit: 'kg', value: CFG.KG_PREFIX7_MAP[last3] };
    }
    if (Object.prototype.hasOwnProperty.call(CFG.KG_MAP, last3)) {
      return { unit: 'kg', value: CFG.KG_MAP[last3] };
    }
    if (Object.prototype.hasOwnProperty.call(CFG.LITERS_MAP, last3)) {
      return { unit: 'l', value: CFG.LITERS_MAP[last3] };
    }
    return null;
  }

  function findTemplateNames(mapping) {
    return Object.entries(CFG.TEMPLATES)
      .filter(([, c]) => c.unit === mapping.unit && c.value === mapping.value)
      .map(([name]) => name);
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
  }

  async function loadTemplates() {
    if (templateCache) return templateCache;
    templateCache = {};
    for (const name of Object.keys(CFG.TEMPLATES)) {
      let loaded = false;
      for (const ext of CFG.TEMPLATE_EXTS) {
        const url = `${TEMPLATES_DIR}/${name}.${ext}`;
        try {
          templateCache[name] = await loadImage(url);
          loaded = true;
          break;
        } catch (_) {}
      }
      if (!loaded) {
        log(`template missing: ${name}.{${CFG.TEMPLATE_EXTS.join('|')}}`, 'err');
      }
    }
    return templateCache;
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('invalid image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('file read error'));
      reader.readAsDataURL(file);
    });
  }

  function processBarrelImage(img, threshold) {
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cctx = c.getContext('2d');
    cctx.drawImage(img, 0, 0);
    const data = cctx.getImageData(0, 0, W, H);
    const px = data.data;

    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (px[i] >= threshold && px[i + 1] >= threshold && px[i + 2] >= threshold) {
          px[i + 3] = 0;
        } else if (px[i + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    cctx.putImageData(data, 0, 0);

    if (maxX < 0) {
      return { canvas: c, sx: 0, sy: 0, sw: W, sh: H };
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const padding = (CFG.BG_REMOVAL && CFG.BG_REMOVAL.cropPadding) || 0;
    const padX = Math.round(bw * padding);
    const padY = Math.round(bh * padding);
    const sx = Math.max(0, minX - padX);
    const sy = Math.max(0, minY - padY);
    const ex = Math.min(W, maxX + 1 + padX);
    const ey = Math.min(H, maxY + 1 + padY);
    return {
      canvas: c,
      sx,
      sy,
      sw: ex - sx,
      sh: ey - sy,
    };
  }

  function drawCountryText(ctx, country, bbox) {
    if (!country || !bbox) return;
    const cfg = CFG.COUNTRY_TEXT || {};
    const color = cfg.color || '#ffffff';
    const fontFamily = cfg.fontFamily || 'Inter, system-ui, sans-serif';
    const fontWeight = cfg.fontWeight || 700;
    const heightRatio = typeof cfg.heightRatio === 'number' ? cfg.heightRatio : 0.78;

    // Фіксований розмір шрифту від bbox.height — не залежить від довжини назви країни.
    // Текст лівої прив'язки: завжди стартує з bbox.left, тягнеться вправо.
    const fontSize = Math.max(6, bbox.height * heightRatio);
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      country,
      bbox.left,
      bbox.top + bbox.height / 2
    );
  }

  async function compose(templateImg, barrelImg, pos, country) {
    const canvas = document.createElement('canvas');
    canvas.width = templateImg.naturalWidth;
    canvas.height = templateImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(templateImg, 0, 0);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pos.left, pos.top, pos.width, pos.height);

    const bgr = CFG.BG_REMOVAL;
    let source, sx, sy, sw, sh;
    if (bgr && bgr.enabled) {
      const r = processBarrelImage(barrelImg, bgr.whiteThreshold || 245);
      source = r.canvas;
      sx = r.sx; sy = r.sy; sw = r.sw; sh = r.sh;
    } else {
      source = barrelImg;
      sx = 0; sy = 0;
      sw = barrelImg.naturalWidth;
      sh = barrelImg.naturalHeight;
    }

    const scale = Math.min(pos.width / sw, pos.height / sh);
    const w = sw * scale;
    const h = sh * scale;
    const x = pos.left + (pos.width - w) / 2;
    const y = pos.top + (pos.height - h) / 2;
    ctx.drawImage(source, sx, sy, sw, sh, x, y, w, h);

    drawCountryText(ctx, country, pos.country);

    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', CFG.JPG_QUALITY)
    );
  }

  // -------- UI helpers --------

  function log(msg, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = msg;
    logEl.appendChild(div);
  }

  const EMPTY_HTML = `
    <div class="empty">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3"></rect>
        <circle cx="9" cy="9" r="2"></circle>
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
      </svg>
      Ще нічого не згенеровано
    </div>`;

  function clearResults() {
    generated.forEach((g) => URL.revokeObjectURL(g.url));
    generated = [];
    resultsEl.innerHTML = EMPTY_HTML;
    logEl.innerHTML = '';
    logOverlay.classList.remove('open');
    statsEl.textContent = '';
    btnDownloadAll.disabled = true;
    btnToggleLog.disabled = true;
  }

  function renderCard(item) {
    const empty = resultsEl.querySelector('.empty');
    if (empty) empty.remove();
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb"><img src="${item.url}" alt="${item.outName}" /></div>
      <div class="meta">
        <span class="name" title="${item.folderPath}">${item.outName}</span>
        <a href="${item.url}" download="${item.outName}">Скачати</a>
      </div>
    `;
    resultsEl.appendChild(card);
  }

  function currentCountry() {
    return mode === 'auto' ? selectedCountryAuto : selectedCountryManual;
  }

  function updateGenerateButton() {
    const country = currentCountry();
    if (mode === 'auto') {
      btnGenerate.disabled = barrelFiles.length === 0 || !country;
    } else {
      btnGenerate.disabled = barrelFiles.length === 0 || !selectedTemplate || !country;
    }
  }

  function setStats() {
    if (!barrelFiles.length) {
      statsEl.textContent = '';
      return;
    }
    const country = currentCountry() || '—';
    if (mode === 'auto') {
      const folderName = barrelFiles[0].webkitRelativePath
        ? barrelFiles[0].webkitRelativePath.split('/')[0]
        : barrelFiles[0]._relativePath
        ? barrelFiles[0]._relativePath.split('/')[0]
        : '';
      statsEl.textContent = `Папка: ${folderName || '—'} | Країна: ${country} | Файлів: ${barrelFiles.length}`;
    } else {
      const tplCfg = selectedTemplate ? CFG.TEMPLATES[selectedTemplate] : null;
      const tplLabel = tplCfg ? tplCfg.value : '—';
      statsEl.textContent = `Літраж: ${tplLabel} | Країна: ${country} | Файлів: ${barrelFiles.length}`;
    }
  }

  function setBarrelFiles(files) {
    barrelFiles = Array.from(files).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    updateGenerateButton();
    setStats();
  }

  function populateTemplateSelect() {
    const entries = Object.entries(CFG.TEMPLATES);
    const liters = entries.filter(([, c]) => c.unit === 'l');
    const kgs = entries.filter(([, c]) => c.unit === 'kg');

    const byValue = (a, b) => parseFloat(a[1].value) - parseFloat(b[1].value);
    liters.sort(byValue);
    kgs.sort(byValue);

    templateSelect.innerHTML = '<option value="">— Оберіть —</option>';

    const addGroup = (label, items) => {
      if (!items.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const [name, c] of items) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = c.value;
        og.appendChild(opt);
      }
      templateSelect.appendChild(og);
    };
    addGroup('Літраж', liters);
    addGroup('Вага', kgs);
  }

  function populateCountrySelects() {
    const countries = CFG.COUNTRIES || [];
    for (const sel of [countrySelectAuto, countrySelectManual]) {
      if (!sel) continue;
      sel.innerHTML = '<option value="">— Оберіть —</option>';
      for (const c of countries) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      }
    }
  }

  function switchMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    tabAuto.classList.toggle('active', mode === 'auto');
    tabManual.classList.toggle('active', mode === 'manual');
    panelAuto.classList.toggle('active', mode === 'auto');
    panelManual.classList.toggle('active', mode === 'manual');
    barrelFiles = [];
    fileInputAuto.value = '';
    fileInputManual.value = '';
    updateGenerateButton();
    setStats();
  }

  // -------- folder / files reading --------

  function readAllEntries(reader) {
    return new Promise((resolve) => {
      const all = [];
      (function readBatch() {
        reader.readEntries((batch) => {
          if (batch.length === 0) resolve(all);
          else { all.push(...batch); readBatch(); }
        });
      })();
    });
  }

  async function readEntryRecursive(entry, path, result) {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file) => {
          Object.defineProperty(file, '_relativePath', {
            value: path ? path + '/' + file.name : file.name,
            writable: false,
          });
          result.push(file);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await readAllEntries(reader);
      for (const child of entries) {
        await readEntryRecursive(
          child,
          path ? path + '/' + entry.name : entry.name,
          result
        );
      }
    }
  }

  function getSubfolder(file) {
    if (file._relativePath) {
      const parts = file._relativePath.split('/');
      return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    }
    if (file.webkitRelativePath) {
      const parts = file.webkitRelativePath.split('/');
      return parts.length > 2 ? parts.slice(1, -1).join('/') : '';
    }
    return '';
  }

  // -------- dropzone wiring --------

  function wireDropzone(dropEl, onFiles, { allowFolders }) {
    ['dragenter', 'dragover'].forEach((ev) =>
      dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.add('drag'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.remove('drag'); })
    );

    dropEl.addEventListener('drop', async (e) => {
      const items = e.dataTransfer?.items;
      if (!items) {
        if (e.dataTransfer?.files) onFiles(e.dataTransfer.files);
        return;
      }
      const entries = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) entries.push(entry);
      }
      const hasDirs = entries.some((en) => en.isDirectory);
      if (allowFolders && entries.length && hasDirs) {
        const all = [];
        for (const entry of entries) await readEntryRecursive(entry, '', all);
        onFiles(all);
      } else if (entries.length) {
        // drop of multiple files (no folder) — collect file objects
        const files = [];
        for (const en of entries) {
          if (en.isFile) {
            await new Promise((res) => en.file((f) => { files.push(f); res(); }));
          }
        }
        onFiles(files);
      } else if (e.dataTransfer?.files) {
        onFiles(e.dataTransfer.files);
      }
    });
  }

  wireDropzone(dropAuto, setBarrelFiles, { allowFolders: true });
  wireDropzone(dropManual, setBarrelFiles, { allowFolders: false });

  fileInputAuto.addEventListener('change', (e) => setBarrelFiles(e.target.files));
  fileInputManual.addEventListener('change', (e) => setBarrelFiles(e.target.files));

  templateSelect.addEventListener('change', (e) => {
    selectedTemplate = e.target.value;
    updateGenerateButton();
    setStats();
  });

  countrySelectAuto.addEventListener('change', (e) => {
    selectedCountryAuto = e.target.value;
    updateGenerateButton();
    setStats();
  });

  countrySelectManual.addEventListener('change', (e) => {
    selectedCountryManual = e.target.value;
    updateGenerateButton();
    setStats();
  });

  tabAuto.addEventListener('click', () => switchMode('auto'));
  tabManual.addEventListener('click', () => switchMode('manual'));

  btnClear.addEventListener('click', () => {
    barrelFiles = [];
    fileInputAuto.value = '';
    fileInputManual.value = '';
    updateGenerateButton();
    clearResults();
  });

  // -------- generate --------

  btnGenerate.addEventListener('click', async () => {
    btnGenerate.disabled = true;
    clearResults();

    const country = currentCountry();
    const templates = await loadTemplates();
    let ok = 0, skipped = 0, failed = 0;

    if (mode === 'auto') {
      for (const file of barrelFiles) {
        const code = file.name.replace(/\.[^.]+$/, '');
        if (code.length < 3) {
          log(`[skip] ${file.name}: код < 3 символів`, 'skip');
          skipped++; continue;
        }
        const mapping = resolveValue(code);
        if (!mapping) {
          log(`[skip] ${file.name}: ${code.slice(-3)} немає у мапінгу`, 'skip');
          skipped++; continue;
        }
        const tplNames = findTemplateNames(mapping);
        if (tplNames.length === 0) {
          log(`[skip] ${file.name}: немає шаблону для ${mapping.unit}=${mapping.value}`, 'skip');
          skipped++; continue;
        }

        let barrelImg;
        try { barrelImg = await fileToImage(file); }
        catch (err) { log(`[err] ${file.name}: ${err.message}`, 'err'); failed++; continue; }

        const subfolder = getSubfolder(file);
        for (const tplName of tplNames) {
          if (!templates[tplName]) { failed++; continue; }
          const outName = `tm_${code}.jpg`;
          const folderPath = subfolder ? `${subfolder}/${outName}` : outName;
          try {
            const blob = await compose(templates[tplName], barrelImg, CFG.TEMPLATES[tplName], country);
            const url = URL.createObjectURL(blob);
            const item = { outName, folderPath, subfolder, blob, url };
            generated.push(item);
            renderCard(item);
            log(`[ok]  ${folderPath}`, 'ok');
            ok++;
          } catch (err) {
            log(`[err] ${outName}: ${err.message}`, 'err'); failed++;
          }
        }
      }
    } else {
      // manual mode
      const tplName = selectedTemplate;
      const tplCfg = CFG.TEMPLATES[tplName];
      if (!tplCfg) {
        statsEl.textContent = 'Оберіть літраж';
        btnGenerate.disabled = false;
        return;
      }
      if (!templates[tplName]) {
        log(`[err] немає шаблону ${tplName}`, 'err');
        statsEl.textContent = `Шаблон ${tplName} не знайдено`;
        btnGenerate.disabled = false;
        return;
      }

      for (const file of barrelFiles) {
        const baseName = file.name.replace(/\.[^.]+$/, '');
        let barrelImg;
        try { barrelImg = await fileToImage(file); }
        catch (err) { log(`[err] ${file.name}: ${err.message}`, 'err'); failed++; continue; }

        const outName = `tm_${baseName}.jpg`;
        const folderPath = outName;
        try {
          const blob = await compose(templates[tplName], barrelImg, tplCfg, country);
          const url = URL.createObjectURL(blob);
          const item = { outName, folderPath, subfolder: '', blob, url };
          generated.push(item);
          renderCard(item);
          log(`[ok]  ${outName}`, 'ok');
          ok++;
        } catch (err) {
          log(`[err] ${outName}: ${err.message}`, 'err'); failed++;
        }
      }
    }

    statsEl.textContent = `Готово. ok=${ok} skipped=${skipped} failed=${failed}`;
    updateGenerateButton();
    btnDownloadAll.disabled = generated.length === 0;
    btnToggleLog.disabled = false;
  });

  btnDownloadAll.addEventListener('click', async () => {
    if (generated.length === 0) return;
    btnDownloadAll.disabled = true;
    btnDownloadAll.textContent = 'Зберігаю...';

    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      for (const g of generated) {
        let targetDir = dirHandle;
        if (g.subfolder) {
          const parts = g.subfolder.split('/');
          for (const part of parts) {
            targetDir = await targetDir.getDirectoryHandle(part, { create: true });
          }
        }
        const fileHandle = await targetDir.getFileHandle(g.outName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(g.blob);
        await writable.close();
      }
      statsEl.textContent = `Збережено ${generated.length} файлів у папку`;
    } catch (err) {
      if (err.name !== 'AbortError') {
        statsEl.textContent = `Помилка збереження: ${err.message}`;
      }
    }

    btnDownloadAll.textContent = 'Скачати все';
    btnDownloadAll.disabled = false;
  });

  btnToggleLog.addEventListener('click', () => logOverlay.classList.add('open'));
  btnCloseLog.addEventListener('click', () => logOverlay.classList.remove('open'));
  logOverlay.addEventListener('click', (e) => {
    if (e.target === logOverlay) logOverlay.classList.remove('open');
  });

  populateTemplateSelect();
  populateCountrySelects();
})();
