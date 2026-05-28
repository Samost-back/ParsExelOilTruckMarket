// Обробляє фото з oils_images через логіку PhotoTruckMarket:
//   1) визначає літраж/вагу по останніх 3 цифрах артикула (KG_MAP/LITERS_MAP);
//   2) знаходить шаблон у PhotoTruckMarket/templates/;
//   3) видаляє білий фон вихідної фотки, кропить bbox, вписує в pos шаблона;
//   4) пише назву країни ("Німеччина") у заданому прямокутнику;
//   5) зберігає JPG у photos_storage/processed/ і апдейтить oils_images.
//
// Запуск:
//   node src/photos/process-photos.js [limit]   (за замовч. — всі pending)
//   node src/photos/process-photos.js --reprocess [limit]  — переобробити ВСЕ (включно з done)
//
// Колонки в oils_images, які заповнює скрипт:
//   processed_path   — шлях до результуючого jpg
//   processed_status — done | failed | skipped
//   processed_error  — причина (для failed/skipped)
//   processed_at     — now()

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { Client } = require("pg");
const CFG = require("../../PhotoTruckMarket/config.cjs");

const COUNTRY_FALLBACK = "Німеччина";
const TEMPLATES_DIR = path.resolve(__dirname, "..", "..", "PhotoTruckMarket", "templates");
const OUTPUT_ROOT = path.resolve(__dirname, "..", "..", "photos_storage", "processed");

// === допоміжне ===

function resolveMapping(articul) {
  if (!articul || articul.length < 3) return null;
  const last3 = articul.slice(-3);
  if (articul.charAt(0) === "7" && CFG.KG_PREFIX7_MAP[last3]) {
    return { unit: "kg", value: CFG.KG_PREFIX7_MAP[last3] };
  }
  if (CFG.KG_MAP[last3]) return { unit: "kg", value: CFG.KG_MAP[last3] };
  if (CFG.LITERS_MAP[last3]) return { unit: "l", value: CFG.LITERS_MAP[last3] };
  return null;
}

function findTemplateName(mapping) {
  for (const [name, c] of Object.entries(CFG.TEMPLATES)) {
    if (c.unit === mapping.unit && c.value === mapping.value) return name;
  }
  return null;
}

async function findTemplateFile(name) {
  for (const ext of CFG.TEMPLATE_EXTS) {
    const p = path.join(TEMPLATES_DIR, `${name}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Видаляє білий фон (alpha=0 для пікселів, де R,G,B >= threshold)
// і повертає { buffer, bbox } — PNG-буфер з прозорим фоном і bbox непрозорих пікселів.
async function removeWhiteBgAndBbox(inputPath, threshold) {
  const img = sharp(inputPath).ensureAlpha();
  const meta = await img.metadata();
  const W = meta.width, H = meta.height;
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });

  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold) {
        data[i + 3] = 0;
      } else if (data[i + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  let bbox;
  if (maxX < 0) {
    bbox = { left: 0, top: 0, width: W, height: H };
  } else {
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const padX = Math.round(bw * (CFG.BG_REMOVAL.cropPadding || 0));
    const padY = Math.round(bh * (CFG.BG_REMOVAL.cropPadding || 0));
    bbox = {
      left: Math.max(0, minX - padX),
      top: Math.max(0, minY - padY),
      width: Math.min(W, maxX + 1 + padX) - Math.max(0, minX - padX),
      height: Math.min(H, maxY + 1 + padY) - Math.max(0, minY - padY),
    };
  }

  const buffer = await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
  return { buffer, bbox };
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

async function processOne({ srcPath, articul, country, outDir }) {
  const mapping = resolveMapping(articul);
  if (!mapping) {
    return { status: "skipped", error: `немає мапінгу для last3="${articul.slice(-3)}"` };
  }
  const tplName = findTemplateName(mapping);
  if (!tplName) {
    return { status: "skipped", error: `немає шаблона для ${mapping.unit}=${mapping.value}` };
  }
  const tplFile = await findTemplateFile(tplName);
  if (!tplFile) {
    return { status: "skipped", error: `файл шаблона ${tplName}.{${CFG.TEMPLATE_EXTS.join("|")}} відсутній` };
  }
  if (!fs.existsSync(srcPath)) {
    return { status: "failed", error: `вихідний файл не існує: ${srcPath}` };
  }

  const pos = CFG.TEMPLATES[tplName];
  const tplMeta = await sharp(tplFile).metadata();
  const canvasW = tplMeta.width, canvasH = tplMeta.height;

  let barrelPng, bbox;
  try {
    const r = await removeWhiteBgAndBbox(srcPath, CFG.BG_REMOVAL.whiteThreshold || 245);
    barrelPng = r.buffer; bbox = r.bbox;
  } catch (e) {
    return { status: "failed", error: `bg-remove: ${e.message}` };
  }

  // Вирізаємо bbox + ресайз із збереженням пропорцій під pos
  const fitted = await sharp(barrelPng)
    .extract(bbox)
    .resize({
      width: pos.width,
      height: pos.height,
      fit: "inside",
      withoutEnlargement: false,
    })
    .toBuffer({ resolveWithObject: true });

  const fittedW = fitted.info.width;
  const fittedH = fitted.info.height;
  const offsetX = Math.round(pos.left + (pos.width - fittedW) / 2);
  const offsetY = Math.round(pos.top + (pos.height - fittedH) / 2);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `tm_${articul}.jpg`);

  // Порядок шарів важливий: 1) шаблон → 2) білий прямокутник (overlay svg містить його перед текстом) → 3) бочка → 4) текст
  // Але SVG в одному шарі містить і прямокутник, і текст — тому композимо: tpl → svgRect → barrel → svgText.
  // Простіше зробити дві окремі SVG.
  const svgRect = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">` +
      `<rect x="${pos.left}" y="${pos.top}" width="${pos.width}" height="${pos.height}" fill="#ffffff"/>` +
    `</svg>`, "utf-8");

  const countryShiftX = CFG.COUNTRY_TEXT.offsetX || 0;
  const countryLeft = pos.country.left + countryShiftX;
  const fontSize = Math.max(6, pos.country.height * (CFG.COUNTRY_TEXT.heightRatio || 0.78));
  const ty = pos.country.top + pos.country.height / 2;

  // Прапор країни — три (або скільки задано) горизонтальні смуги зліва від тексту.
  // Перекриває чорний кружок-плейсхолдер на оригінальному шаблоні.
  let flagSvg = "";
  const flagCfg = CFG.FLAG;
  const stripes = CFG.COUNTRY_FLAGS && CFG.COUNTRY_FLAGS[country];
  if (flagCfg && flagCfg.enabled && stripes && stripes.length) {
    const fh = Math.round(pos.country.height * (flagCfg.heightRatio || 1));
    const fw = Math.round(fh * (flagCfg.aspectRatio || 5 / 3));
    const fx = countryLeft - fw - (flagCfg.gap || 4);
    const fy = Math.round(pos.country.top + (pos.country.height - fh) / 2);
    const stripeH = fh / stripes.length;
    let rects = "";
    for (let i = 0; i < stripes.length; i++) {
      rects += `<rect x="${fx}" y="${(fy + i * stripeH).toFixed(2)}" ` +
               `width="${fw}" height="${stripeH.toFixed(2)}" fill="${stripes[i]}"/>`;
    }
    if (flagCfg.border && flagCfg.border.width > 0) {
      rects += `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" ` +
               `fill="none" stroke="${flagCfg.border.color}" stroke-width="${flagCfg.border.width}"/>`;
    }
    flagSvg = rects;
  }

  const svgText = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">` +
      flagSvg +
      `<text x="${countryLeft}" y="${ty}" ` +
      `font-family="${CFG.COUNTRY_TEXT.fontFamily}" font-weight="${CFG.COUNTRY_TEXT.fontWeight}" ` +
      `font-size="${fontSize}" fill="${CFG.COUNTRY_TEXT.color}" ` +
      `text-anchor="start" dominant-baseline="middle">${escapeXml(country)}</text>` +
    `</svg>`, "utf-8");

  try {
    await sharp(tplFile)
      .composite([
        { input: svgRect, top: 0, left: 0 },
        { input: fitted.data, top: offsetY, left: offsetX },
        { input: svgText, top: 0, left: 0 },
      ])
      .jpeg({ quality: CFG.JPG_QUALITY })
      .toFile(outPath);
  } catch (e) {
    return { status: "failed", error: `composite: ${e.message}` };
  }

  return { status: "done", outPath, tpl: tplName };
}

// === main ===

(async () => {
  const args = process.argv.slice(2);
  const reprocess = args.includes("--reprocess");
  const limitArg = args.find((a) => /^\d+$/.test(a));
  const LIMIT = limitArg ? parseInt(limitArg, 10) : null;

  const db = new Client({
    host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  await db.connect();
  console.log("✓ DB connected");
  console.log(`✓ Країна: з company_olivs.country (fallback="${COUNTRY_FALLBACK}")`);
  console.log(`✓ Templates: ${TEMPLATES_DIR}`);
  console.log(`✓ Output:    ${OUTPUT_ROOT}`);
  console.log(`✓ Режим: ${reprocess ? "REPROCESS (всі)" : "тільки pending"}${LIMIT ? `, limit=${LIMIT}` : ""}\n`);

  const sql = `
    SELECT i.id, i.oils_id, i.file_path, o.articul, o.name_type_oil, o.name,
           c.country AS company_country
      FROM oils_images i
      JOIN olivs o ON o.id = i.oils_id
      JOIN company_olivs c ON c.id = o.company_id
     ${reprocess ? "" : "WHERE i.processed_status IS NULL OR i.processed_status = 'pending' OR i.processed_status = 'failed'"}
  ORDER BY i.id
     ${LIMIT ? `LIMIT ${LIMIT}` : ""}
  `;
  const { rows } = await db.query(sql);
  console.log(`✓ До обробки: ${rows.length} зображень\n`);

  const stats = { done: 0, failed: 0, skipped: 0 };
  const errors = [];

  for (const r of rows) {
    const head = `[oils_images.id=${r.id}, olivs.id=${r.oils_id}, articul=${r.articul}]`;
    let res;
    try {
      res = await processOne({
        srcPath: r.file_path,
        articul: r.articul,
        country: r.company_country || COUNTRY_FALLBACK,
        outDir: OUTPUT_ROOT,
      });
    } catch (e) {
      res = { status: "failed", error: `unexpected: ${e.message}` };
    }

    if (res.status === "done") {
      console.log(`  ✓ ${head} → ${res.tpl} → ${path.basename(res.outPath)}`);
      stats.done++;
      await db.query(
        `UPDATE oils_images
            SET processed_path = $1, processed_status = 'done',
                processed_error = NULL, processed_at = NOW()
          WHERE id = $2`,
        [res.outPath, r.id],
      );
    } else if (res.status === "skipped") {
      console.log(`  ⊘ ${head} skip — ${res.error}`);
      stats.skipped++;
      errors.push({ id: r.id, articul: r.articul, status: "skipped", error: res.error });
      await db.query(
        `UPDATE oils_images
            SET processed_status = 'skipped', processed_error = $1, processed_at = NOW()
          WHERE id = $2`,
        [res.error, r.id],
      );
    } else {
      console.log(`  ✗ ${head} failed — ${res.error}`);
      stats.failed++;
      errors.push({ id: r.id, articul: r.articul, status: "failed", error: res.error });
      await db.query(
        `UPDATE oils_images
            SET processed_status = 'failed', processed_error = $1, processed_at = NOW()
          WHERE id = $2`,
        [res.error, r.id],
      );
    }
  }

  console.log("\n========== ПІДСУМОК ==========");
  console.table([
    { status: "✓ done",    count: stats.done },
    { status: "⊘ skipped", count: stats.skipped },
    { status: "✗ failed",  count: stats.failed },
  ]);

  if (errors.length) {
    console.log("\nПерші 20 проблемних:");
    for (const e of errors.slice(0, 20)) {
      console.log(`  - id=${e.id} articul=${e.articul} [${e.status}]: ${e.error}`);
    }
    if (errors.length > 20) console.log(`  ... та ще ${errors.length - 20}`);
  }

  await db.end();
  console.log("\n✓ Готово");
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
