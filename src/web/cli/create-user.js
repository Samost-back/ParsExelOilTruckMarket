// CLI: створює нового user'а для веб-частини.
// Запуск: node src/web/cli/create-user.js <username> <password>

require("dotenv").config();
const bcrypt = require("bcrypt");
const { withDb } = require("../../shared/infra/db");
const { UsersRepo } = require("../repositories/users-repo");

(async () => {
  const [, , username, password] = process.argv;
  if (!username || !password) {
    console.error("Usage: node src/web/cli/create-user.js <username> <password>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 chars");
    process.exit(1);
  }

  await withDb(async (db) => {
    const repo = new UsersRepo(db);
    const existing = await repo.findByUsername(username);
    if (existing) {
      console.error(`User "${username}" already exists (id=${existing.id})`);
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 12);
    const id = await repo.create(username, hash);
    console.log(`✓ Created user "${username}" (id=${id})`);
  });
})().catch((e) => { console.error(e); process.exit(1); });
