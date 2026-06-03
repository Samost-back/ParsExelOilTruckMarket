// Експорт усіх даних з БД у JSON.
// Читає список таблиць з information_schema (public) і дампить кожну повністю.
// Результат: один JSON-файл { meta, tables: { <table>: [...rows] } }.
//
// Запуск:
//   node scripts/export-db-json.js [outfile]
// Дефолтний outfile: db-export.json (у поточній директорії).
//
// Примітки:
//   - Порядок рядків стабільний (ORDER BY первинним ключем, якщо є, інакше за всіма колонками).
//   - bigint/numeric повертаються драйвером pg як рядки — лишаємо як є (без втрати точності).
//   - timestamp серіалізується у ISO-8601 (JSON.stringify Date).

require("dotenv").config();
const fs = require("fs");
const { getPool } = require("../src/shared/infra/db");

async function listTables(db) {
  const r = await db.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return r.rows.map((x) => x.table_name);
}

// Колонки первинного ключа таблиці (для стабільного ORDER BY).
async function pkColumns(db, table) {
  const r = await db.query(
    `SELECT a.attname AS col
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ('public.' || $1)::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [table],
  );
  return r.rows.map((x) => x.col);
}

async function allColumns(db, table) {
  const r = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

(async () => {
  const outfile = process.argv[2] || "db-export.json";
  const db = getPool();

  const tables = await listTables(db);
  const out = {
    meta: {
      // Час дампа підставляємо ззовні (через make), щоб не залежати від
      // системного годинника тут; якщо нема — null.
      exported_at: process.env.EXPORT_AT || null,
      database: process.env.PG_DB || null,
      table_count: tables.length,
    },
    tables: {},
  };

  let totalRows = 0;
  for (const t of tables) {
    const pk = await pkColumns(db, t);
    const orderBy = (pk.length ? pk : await allColumns(db, t))
      .map((c) => `"${c}"`)
      .join(", ");
    const r = await db.query(`SELECT * FROM public."${t}"${orderBy ? ` ORDER BY ${orderBy}` : ""}`);
    out.tables[t] = r.rows;
    totalRows += r.rows.length;
    console.log(`  ${t}: ${r.rows.length} рядків`);
  }
  out.meta.total_rows = totalRows;

  fs.writeFileSync(outfile, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n✓ Експортовано ${tables.length} таблиць, ${totalRows} рядків → ${outfile}`);
  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
