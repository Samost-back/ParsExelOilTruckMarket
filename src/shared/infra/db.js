const { Client, Pool } = require("pg");

// Конфіг з .env. Один pool на процес — Fastify розшарить його через всі роути.
// pg.Pool автоматично менеджить connections — SSE не блокує інші запити.
function getConfig() {
  return {
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT, 10),
    database: process.env.PG_DB,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  };
}

// Лiнивий singleton — створюється при першому виклику.
let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({
      ...getConfig(),
      max: parseInt(process.env.PG_POOL_MAX || "10", 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _pool.on("error", (err) => {
      console.error("PG pool error:", err.message);
    });
  }
  return _pool;
}

async function closePool() {
  if (_pool) {
    await _pool.end().catch(() => {});
    _pool = null;
  }
}

// Сумісність для CLI-скриптів: createDbClient + withDb тепер обгортки навколо Pool.
// Кожен виклик повертає клієнт з пулу, повертає його у пул після end().
function createDbClient() {
  // Залишено для CLI (parser/index.js, photos/import тощо), які мають свій життєвий цикл.
  // Створює standalone Client — після CLI завершить .end().
  return new Client(getConfig());
}

async function withDb(fn) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = { createDbClient, withDb, getPool, closePool };
