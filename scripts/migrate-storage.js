// Одноразова міграція файлів з локального диска у S3 + перепис шляхів у БД на key.
//
// Що робить:
//   1) Читає oils_images, де file_path / processed_path — АБСОЛЮТНИЙ локальний шлях.
//   2) Для кожного файла, що існує на диску, заливає його в S3 під стабільним key:
//        file_path      → originals/<basename>      (або originals/manager/<...> якщо вже там)
//        processed_path → processed/<basename>
//      Якщо basename не унікальний — додаємо oils_id-префікс, щоб уникнути колізій.
//   3) Оновлює відповідну колонку в БД на key.
//
// БЕЗПЕЧНО запускати повторно: рядки, де вже лежить key (не абсолютний шлях),
// пропускаються. Локальні файли НЕ видаляються (підчистите вручну після перевірки).
//
// Передумови: STORAGE_DRIVER=s3 + S3_* змінні в .env (заливаємо саме в S3).
//
// Запуск:
//   node scripts/migrate-storage.js            — виконати
//   node scripts/migrate-storage.js --dry-run  — лише показати, що буде зроблено

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { createStorage } = require("../src/shared/infra/storage");

const DRY = process.argv.includes("--dry-run");

function isAbsoluteLegacy(p) {
  return !!p && (path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p));
}

// Будує key з абсолютного шляху. kind: "originals" | "processed".
function keyFor(absPath, kind, oilsId) {
  const base = path.basename(absPath);
  // processed: tm_<articul>.jpg уже унікальний; для originals додаємо oils_id,
  // щоб два однойменні файли різних олив не перетёрли один одного.
  return kind === "processed"
    ? `processed/${base}`
    : `originals/${oilsId}/${base}`;
}

(async () => {
  if ((process.env.STORAGE_DRIVER || "local").toLowerCase() !== "s3") {
    console.error("✗ STORAGE_DRIVER має бути 's3' для міграції в S3. Перервано.");
    process.exit(1);
  }
  const storage = createStorage(process.env);
  console.log(`✓ Storage: driver=${storage.driver}, bucket=${process.env.S3_BUCKET}${DRY ? "  (DRY-RUN)" : ""}`);

  const db = new Client({
    host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT, 10),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  await db.connect();
  console.log("✓ DB connected\n");

  const { rows } = await db.query(
    `SELECT id, oils_id, file_path, processed_path FROM oils_images ORDER BY id`,
  );

  const stats = { uploaded: 0, rewritten: 0, missingFile: 0, alreadyKey: 0, errors: 0 };

  // (колонка, kind) пари для обробки
  const cols = [
    { col: "file_path", kind: "originals" },
    { col: "processed_path", kind: "processed" },
  ];

  for (const r of rows) {
    for (const { col, kind } of cols) {
      const val = r[col];
      if (!val) continue;
      if (!isAbsoluteLegacy(val)) { stats.alreadyKey++; continue; }
      if (!fs.existsSync(val)) {
        console.log(`  ⚠ id=${r.id} ${col}: файл відсутній на диску — ${val}`);
        stats.missingFile++;
        continue;
      }
      const key = keyFor(val, kind, r.oils_id);
      if (DRY) {
        console.log(`  [dry] id=${r.id} ${col}: ${val} → s3:${key}`);
        stats.uploaded++; stats.rewritten++;
        continue;
      }
      try {
        const buffer = await fs.promises.readFile(val);
        await storage.save(key, buffer);
        stats.uploaded++;
        await db.query(`UPDATE oils_images SET ${col} = $1 WHERE id = $2`, [key, r.id]);
        stats.rewritten++;
        console.log(`  ✓ id=${r.id} ${col} → s3:${key}`);
      } catch (e) {
        console.log(`  ✗ id=${r.id} ${col}: ${e.message}`);
        stats.errors++;
      }
    }
  }

  console.log("\n========== ПІДСУМОК ==========");
  console.table([
    { stat: "Залито в S3", value: stats.uploaded },
    { stat: "Переписано шляхів у БД", value: stats.rewritten },
    { stat: "Вже key (пропущено)", value: stats.alreadyKey },
    { stat: "Файл відсутній на диску", value: stats.missingFile },
    { stat: "Помилки", value: stats.errors },
  ]);
  if (DRY) console.log("\n(DRY-RUN — нічого не змінено)");

  await db.end();
  console.log("\n✓ Готово");
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
