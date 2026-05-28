// Репозиторій web_users.
class UsersRepo {
  constructor(db) { this.db = db; }
  findByUsername(username) {
    return this.db.query(
      `SELECT id, username, password_hash FROM web_users WHERE username = $1`,
      [username],
    ).then(r => r.rows[0] || null);
  }
  findById(id) {
    return this.db.query(
      `SELECT id, username FROM web_users WHERE id = $1`,
      [id],
    ).then(r => r.rows[0] || null);
  }
  async create(username, passwordHash) {
    const r = await this.db.query(
      `INSERT INTO web_users (username, password_hash) VALUES ($1, $2) RETURNING id`,
      [username, passwordHash],
    );
    return r.rows[0].id;
  }
}
module.exports = { UsersRepo };
