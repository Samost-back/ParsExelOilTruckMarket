// Імпорт фото для інтеграції Manager.
// Структура папки:  <Бренд>/<Тип>/<файли>
//   де ім'я файлу = <артикул><об'єм>, напр.:
//     Mobil/Мооторна/157376208.webp  → артикул 157376, об'єм 208 л
//     Delo/Моторне/804369DEE208.webp → артикул 804369DEE, об'єм 208 л
//     Aral/Моторнк/15870E020.jpg     → артикул 15870E,    об'єм 20 л
//
// Логіка: беремо бренд (папка) і тип (підпапка) для контексту, але ЗІСТАВЛЯЄМО
// СУТО за артикулом+об'ємом проти Manager-олив у БД. Не знайшли артикул —
// значить такого товару немає, тихо пропускаємо (Castrol/Total — без артикулів,
// тож їхні фото просто не зматчаться → ігноруються).
//
// Використання:
//   node src/photos/import-manager/index.js "<шлях до папки з фото>"

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const INTEGRATION_CODE = "ManagerIntegration";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"]);

// Нормалізує "208"→208, "020"/"20"→20, "1000"→1000. Повертає число або null.
function normVolume(s) {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// Розбирає base-ім'я файлу (без пробілів) на можливі (артикул, об'єм).
// Підхід керований БД: для кожної відомої оливи перевіряємо, чи ім'я =
// articulNoSpace + volSuffix. Тут лише готуємо нормалізоване base-ім'я.
function cleanBase(filename) {
  return path
    .basename(filename, path.extname(filename))
    .replace(/\s+/g, "")        // прибрати пробіли: "804369DEE 208" → "804369DEE208"
    .toUpperCase();
}

// Чи suffix відповідає об'єму олії: "208"→208, "020"/"20"→20.
function suffixMatchesVolume(suffix, volume) {
  const v = normVolume(suffix);
  return v != null && v === Math.round(Number(volume));
}

function walk(dir, brand, type, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 1-й рівень = бренд, 2-й = тип
      if (brand == null) walk(full, entry.name, null, out);
      else walk(full, brand, type == null ? entry.name : type, out);
    } else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push({ full, brand, type, name: entry.name });
    }
  }
  return out;
}

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node src/photos/import-manager/index.js "<папка з фото>"');
    process.exit(1);
  }
  const root = path.resolve(arg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Не папка або не існує: ${root}`);
    process.exit(1);
  }

  const files = walk(root, null, null, []);
  console.log(`✓ Знайдено файлів зображень: ${files.length}`);

  const db = new Client({
    host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT, 10),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  await db.connect();
  console.log("✓ DB connected");

  // Усі Manager-оливи: артикул (uppercase, без пробілів) → [{id, volume, brand, articul}]
  const { rows } = await db.query(
    `SELECT o.id, o.articul, o.packaging_volume, o.brand
       FROM olivs o
       JOIN integrations i ON i.id = o.integration_id
      WHERE i.code = $1`,
    [INTEGRATION_CODE],
  );
  const byArticul = new Map();
  for (const r of rows) {
    const key = String(r.articul).replace(/\s+/g, "").toUpperCase();
    if (!byArticul.has(key)) byArticul.set(key, []);
    byArticul.get(key).push(r);
  }
  console.log(`✓ Manager-олив у БД: ${rows.length}\n`);

  const stats = { linked: 0, dup: 0, matched: 0, unmatched: [], brandMismatch: [] };

  for (const f of files) {
    const base = cleanBase(f.full); // напр. "157376208" або "804369DEE208"
    // Шукаємо артикул-префікс: серед відомих артикулів беремо ті, з яких
    // починається base, і де залишок (суфікс) = об'єм цієї оливи.
    let match = null;
    for (const [artKey, oils] of byArticul) {
      if (!base.startsWith(artKey)) continue;
      const suffix = base.slice(artKey.length);
      for (const oil of oils) {
        if (suffix === "" || suffixMatchesVolume(suffix, oil.packaging_volume)) {
          // надаємо перевагу довшому артикулу (точніший збіг) — оновлюємо якщо краще
          if (!match || artKey.length > match.artKey.length) match = { oil, artKey, suffix };
        }
      }
    }

    if (!match) {
      stats.unmatched.push({ brand: f.brand, type: f.type, name: f.name });
      continue;
    }
    stats.matched++;
    // Звіряємо бренд із папки з брендом у БД (лише попередження, не блокує).
    if (f.brand && match.oil.brand && f.brand.toLowerCase() !== String(match.oil.brand).toLowerCase()) {
      stats.brandMismatch.push({ file: f.name, folderBrand: f.brand, dbBrand: match.oil.brand });
    }

    try {
      const res = await db.query(
        `INSERT INTO oils_images (oils_id, file_path, sort_order)
         VALUES ($1, $2, 0)
         ON CONFLICT (oils_id, file_path) DO NOTHING
         RETURNING id`,
        [match.oil.id, f.full],
      );
      if (res.rows.length) stats.linked++; else stats.dup++;
    } catch (e) {
      console.log(`  ✗ olivs.id=${match.oil.id} "${f.name}": ${e.message}`);
    }
  }

  console.log("========== ПІДСУМОК ==========");
  console.table([
    { stat: "Файлів усього", value: files.length },
    { stat: "Зматчено (артикул+об'єм)", value: stats.matched },
    { stat: "Нових зв'язків", value: stats.linked },
    { stat: "Дублів (вже були)", value: stats.dup },
    { stat: "Не зматчено (немає артикулу)", value: stats.unmatched.length },
  ]);

  if (stats.unmatched.length) {
    console.log(`\nНе зматчені файли (немає такого артикулу в БД — пропущено):`);
    for (const u of stats.unmatched) console.log(`  - ${u.brand}/${u.type}/${u.name}`);
  }
  if (stats.brandMismatch.length) {
    console.log(`\n⚠ Бренд папки ≠ бренд у БД:`);
    for (const b of stats.brandMismatch) console.log(`  - ${b.file}: папка=${b.folderBrand}, БД=${b.dbBrand}`);
  }

  // Машиночитаний маркер для web job (картка-зведення).
  console.log("@@PHOTOLINK@@ " + JSON.stringify({
    files: files.length,
    matched: stats.matched,
    linked: stats.linked,
    dup: stats.dup,
    unmatched: stats.unmatched.length,
  }));

  await db.end();
  console.log("\n✓ Готово");
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
