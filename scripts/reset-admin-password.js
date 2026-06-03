// Скидає пароль існуючого web-юзера на новий випадковий (або заданий).
// Запуск:  node scripts/reset-admin-password.js [username] [password]
//   без аргументів → username=admin, згенерований випадковий пароль.
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { getPool } = require("../src/shared/infra/db");

(async () => {
  const username = process.argv[2] || "admin";
  const password =
    process.argv[3] ||
    crypto.randomBytes(12).toString("base64").replace(/[+/=]/g, "").slice(0, 16);

  const hash = await bcrypt.hash(password, 12);
  const r = await getPool().query(
    "UPDATE web_users SET password_hash = $1 WHERE username = $2 RETURNING id",
    [hash, username],
  );
  if (!r.rowCount) {
    console.error(`✗ Юзера "${username}" не знайдено`);
    process.exit(1);
  }
  console.log("✓ Пароль оновлено");
  console.log(`LOGIN    = ${username}`);
  console.log(`PASSWORD = ${password}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
