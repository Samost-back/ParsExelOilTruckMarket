// Імпорт фотографій оливо в БД.
// Бере шлях до архіву (zip) або вже розпакованої папки, сканує файли,
// витягує артикул з імені, прив'язує до olivs через таблицю oils_images.
//
// Використання:
//   node src/photos/import-photos.js "PRODUCT FOTO-20260303T175405Z-3-001.zip"
//   node src/photos/import-photos.js path/to/extracted_folder
//
// Якщо передано zip — розпакує в photos_storage/<basename>/ і збереже шляхи
// до тих файлів. Якщо передано папку — використає її як є.
//
// Ім'я файла → артикул: усе до першого пробілу, підкреслення або крапки.
//   "13010_Auffangwanne_208L.tif" → "13010"
//   "13025 PIUSI_Flipper.jpg"     → "13025"
//   "000309.png"                  → "000309"
//
// Артикул співставляється з olivs.articul СТРОГО (без нормалізації нулів),
// бо в БД артикули зберігаються як рядки і провідні нулі значимі.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("pg");
const { getStorage } = require("../../shared/infra/storage");

// Префікс storage key для оригіналів. На local фактично лягають у
// photos_storage/originals/<basename>; на s3 — у бакет під цим же key.
const ORIGINALS_PREFIX = "originals";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"]);

function extractArticulFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  // Беремо все до першого пробілу, _, -, .
  const m = base.match(/^([^\s_\-.]+)/);
  return m ? m[1] : base;
}

function walkDir(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, out);
    else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function unzipIfNeeded(inputPath) {
  const abs = path.resolve(inputPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Не знайдено: ${abs}`);
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    console.log(`✓ Вхід: папка ${abs}`);
    return abs;
  }
  if (path.extname(abs).toLowerCase() !== ".zip") {
    throw new Error(`Очікую .zip або папку, отримав: ${abs}`);
  }

  const storageRoot = path.resolve(__dirname, "..", "..", "photos_storage");
  if (!fs.existsSync(storageRoot)) fs.mkdirSync(storageRoot, { recursive: true });
  const dest = path.join(storageRoot, path.basename(abs, ".zip"));
  if (fs.existsSync(dest)) {
    console.log(`✓ Архів вже розпакований у ${dest} — використовую його`);
    return dest;
  }
  console.log(`→ Розпаковую ${abs} → ${dest}`);
  // Використовуємо штатний PowerShell Expand-Archive (без додаткових залежностей).
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${abs.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit" },
  );
  return dest;
}

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node src/photos/import-photos.js <zip_or_folder>");
    process.exit(1);
  }

  const rootDir = unzipIfNeeded(arg);
  const files = walkDir(rootDir);
  console.log(`✓ Знайдено файлів зображень: ${files.length}\n`);

  const db = new Client({
    host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  await db.connect();
  console.log("✓ DB connected");

  // Передзавантажуємо мапу articul → [oils_id...]
  const { rows: oilsRows } = await db.query("SELECT id, articul FROM public.olivs");
  const byArticul = new Map();
  for (const r of oilsRows) {
    if (!byArticul.has(r.articul)) byArticul.set(r.articul, []);
    byArticul.get(r.articul).push(r.id);
  }
  console.log(`✓ Олив у БД: ${oilsRows.length}, унікальних артикулів: ${byArticul.size}\n`);

  const stats = {
    linked: 0,           // успішно прив'язано (oils_id, file) пар
    duplicated: 0,       // вже існував такий зв'язок — пропущено через UNIQUE
    no_oil: [],          // фото без відповідної оливи в БД
    matched_files: 0,    // файлів, для яких знайшовся хоча б один olivs
    multi_match: 0,      // файлів, що збігаються з 2+ оливо (різні компанії)
  };

  const storage = getStorage();
  console.log(`✓ Storage: driver=${storage.driver}, key-prefix="${ORIGINALS_PREFIX}/"\n`);

  for (const fullPath of files) {
    const articul = extractArticulFromFilename(fullPath);
    const oilsIds = byArticul.get(articul);
    if (!oilsIds || oilsIds.length === 0) {
      stats.no_oil.push({ articul, file: path.basename(fullPath) });
      continue;
    }
    stats.matched_files++;
    if (oilsIds.length > 1) stats.multi_match++;

    // Зберігаємо оригінал у сховище під стабільним key. На local це означає
    // копію в photos_storage/originals/<rel>; на s3 — об'єкт у бакеті. У БД
    // лягає key, а не абсолютний шлях — однаково для обох backend'ів.
    // <rel> — шлях відносно кореня архіву (унікальний у межах батча).
    const rel = path.relative(rootDir, fullPath).split(path.sep).join("/");
    const key = `${ORIGINALS_PREFIX}/${rel}`;
    let storedKey;
    try {
      const buffer = await fs.promises.readFile(fullPath);
      const saved = await storage.save(key, buffer);
      storedKey = saved.key;
    } catch (e) {
      console.log(`  ✗ storage.save "${fullPath}": ${e.message}`);
      continue;
    }

    for (const oilsId of oilsIds) {
      try {
        const res = await db.query(
          `INSERT INTO public.oils_images (oils_id, file_path, sort_order)
           VALUES ($1, $2, 0)
           ON CONFLICT (oils_id, file_path) DO NOTHING
           RETURNING id`,
          [oilsId, storedKey],
        );
        if (res.rows.length) stats.linked++;
        else stats.duplicated++;
      } catch (e) {
        console.log(`  ✗ olivs.id=${oilsId} file="${storedKey}": ${e.message}`);
      }
    }
  }

  // Олив без фото
  const { rows: noPhotoRows } = await db.query(`
    SELECT o.id, o.articul, o.name, o.name_type_oil
      FROM public.olivs o
 LEFT JOIN public.oils_images i ON i.oils_id = o.id
     WHERE i.id IS NULL
  ORDER BY o.name_type_oil, o.id
  `);

  console.log("\n========== ПІДСУМОК ==========");
  console.table([
    { stat: "Файлів у архіві",                  value: files.length },
    { stat: "Файлів зі співпадінням артикула",  value: stats.matched_files },
    { stat: "Файлів без оливо в БД",            value: stats.no_oil.length },
    { stat: "Multi-match (артикул у кількох)",  value: stats.multi_match },
    { stat: "Нових зв'язків (oils_id × file)",  value: stats.linked },
    { stat: "Дублів (вже були)",                value: stats.duplicated },
    { stat: "Олив без жодного фото",            value: noPhotoRows.length },
  ]);

  if (stats.no_oil.length) {
    console.log(`\nПерші 15 фото без оливо в БД (артикули):`);
    for (const x of stats.no_oil.slice(0, 15)) {
      console.log(`  - ${x.articul}  (${x.file})`);
    }
    if (stats.no_oil.length > 15) console.log(`  ... та ще ${stats.no_oil.length - 15}`);
  }

  if (noPhotoRows.length) {
    console.log(`\nПерші 15 олив без фото:`);
    for (const r of noPhotoRows.slice(0, 15)) {
      console.log(`  - olivs.id=${r.id} articul=${r.articul} (${r.name_type_oil}) — ${r.name}`);
    }
    if (noPhotoRows.length > 15) console.log(`  ... та ще ${noPhotoRows.length - 15}`);
  }

  // Машиночитаний маркер для web job (картка-зведення).
  console.log("@@PHOTOLINK@@ " + JSON.stringify({
    files: files.length,
    matched: stats.matched_files,
    linked: stats.linked,
    dup: stats.duplicated,
    unmatched: stats.no_oil.length,
    oilsWithoutPhoto: noPhotoRows.length,
  }));

  await db.end();
  console.log("\n✓ Готово");
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
