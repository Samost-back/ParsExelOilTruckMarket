// Діагностика: що лежить у olivs.type_oil по типах оливи + чи мапиться воно
// у TruckMarket-опції. Тимчасовий дослідницький скрипт.
require("dotenv").config();
const { getPool } = require("../src/shared/infra/db");
const {
  TYPE_OIL_TO_TRUCKMARKET_CATEGORY,
  TRUCKMARKET_FIELD_OPTIONS,
  TRUCKMARKET_CATEGORY_FIELDS,
} = require("../src/integrations/truckmarket/constants");

(async () => {
  const db = getPool();

  // 1) Розподіл type_oil по name_type_oil
  const r = await db.query(`
    SELECT name_type_oil,
           COALESCE(type_oil, '∅ NULL') AS type_oil,
           count(*)::int AS n
      FROM olivs
  GROUP BY name_type_oil, COALESCE(type_oil, '∅ NULL')
  ORDER BY name_type_oil, n DESC
  `);

  console.log("=== Розподіл type_oil по типах оливи ===");
  let cur = null;
  for (const row of r.rows) {
    if (row.name_type_oil !== cur) { cur = row.name_type_oil; console.log(`\n[${cur}]`); }
    console.log(`   type_oil="${row.type_oil}"  →  ${row.n} шт`);
  }

  // 2) Для кожного name_type_oil показуємо, у яке f-поле йде "Тип оливи"
  //    і які значення словник вміє мапити.
  console.log("\n=== Мапінг поля «Тип оливи» по категоріях ===");
  const seenTypes = [...new Set(r.rows.map((x) => x.name_type_oil))];
  for (const nto of seenTypes) {
    const cat = TYPE_OIL_TO_TRUCKMARKET_CATEGORY[nto];
    if (!cat) { console.log(`\n[${nto}] → немає мапінгу категорії (не публікується)`); continue; }
    const fields = TRUCKMARKET_CATEGORY_FIELDS[cat] || {};
    const typeField = fields["Тип оливи"];
    const opts = typeField ? (TRUCKMARKET_FIELD_OPTIONS[cat] || {})[typeField] : null;
    console.log(`\n[${nto}] cat=${cat}`);
    if (!typeField) { console.log(`   ⚠ у цієї категорії НЕМАЄ поля «Тип оливи»`); continue; }
    console.log(`   поле «Тип оливи» → ${typeField}`);
    console.log(`   словник опцій: ${opts ? JSON.stringify(opts) : "(нема — free-text)"}`);
  }

  // 3) Конкретно трансмісійні: які реальні type_oil НЕ мапляться
  console.log("\n=== Трансмісійні: чи кожен type_oil мапиться у f2 ===");
  const cat = 4264;
  const opts = (TRUCKMARKET_FIELD_OPTIONS[cat] || {}).f2 || {};
  const tr = await db.query(`
    SELECT DISTINCT COALESCE(type_oil,'∅ NULL') AS type_oil
      FROM olivs WHERE name_type_oil = 'трансмісійне оливо'`);
  if (!tr.rows.length) console.log("   (трансмісійних у БД нема)");
  for (const row of tr.rows) {
    const t = row.type_oil === "∅ NULL" ? null : row.type_oil;
    const mapped = t == null ? "—" : (opts[t] !== undefined ? `f2=${opts[t]}` : "✗ НЕ в опціях");
    console.log(`   "${row.type_oil}"  →  ${mapped}`);
  }

  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
