const { Client } = require("pg");

// Єдина точка створення підключення до БД з .env-конфігу.
// Викликати через `await withDb(async (db) => ...)` — гарантує end() навіть при помилці.
function createDbClient() {
  return new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT, 10),
    database: process.env.PG_DB,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  });
}

async function withDb(fn) {
  const db = createDbClient();
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

module.exports = { createDbClient, withDb };
