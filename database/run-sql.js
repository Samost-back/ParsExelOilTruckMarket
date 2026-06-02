// Виконує SQL-файл проти БД (з конфігу .env). Для seed/міграцій із Makefile.
// Запуск: node database/run-sql.js <path-to.sql>
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node database/run-sql.js <file.sql>");
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`Not found: ${abs}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(abs, "utf8");
  const c = new Client({
    host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT, 10),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  await c.connect();
  try {
    await c.query(sql);
    console.log(`✓ applied ${path.basename(abs)}`);
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
