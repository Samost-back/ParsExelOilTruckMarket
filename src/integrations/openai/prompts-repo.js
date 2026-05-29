// Репозиторій AI-промптів. Один із них помічений is_default=true
// і використовується сервісом описів.
class PromptsRepo {
  constructor(db) { this.db = db; }

  list() {
    return this.db.query(
      `SELECT id, name, body, is_default, created_at, updated_at
         FROM ai_prompts ORDER BY is_default DESC, name`,
    ).then(r => r.rows);
  }

  findById(id) {
    return this.db.query(`SELECT * FROM ai_prompts WHERE id = $1`, [id])
      .then(r => r.rows[0] || null);
  }

  findDefault() {
    return this.db.query(`SELECT * FROM ai_prompts WHERE is_default LIMIT 1`)
      .then(r => r.rows[0] || null);
  }

  async create({ name, body, makeDefault }) {
    const r = await this.db.query(
      `INSERT INTO ai_prompts (name, body) VALUES ($1, $2) RETURNING id`,
      [name, body],
    );
    if (makeDefault) await this.setDefault(r.rows[0].id);
    return r.rows[0].id;
  }

  async update(id, { name, body }) {
    await this.db.query(
      `UPDATE ai_prompts SET name = $2, body = $3, updated_at = NOW() WHERE id = $1`,
      [id, name, body],
    );
  }

  async setDefault(id) {
    // Транзакція: скинути попередній + встановити новий
    await this.db.query("BEGIN");
    try {
      await this.db.query(`UPDATE ai_prompts SET is_default = false WHERE is_default`);
      await this.db.query(`UPDATE ai_prompts SET is_default = true WHERE id = $1`, [id]);
      await this.db.query("COMMIT");
    } catch (e) {
      await this.db.query("ROLLBACK");
      throw e;
    }
  }

  async delete(id) {
    await this.db.query(`DELETE FROM ai_prompts WHERE id = $1`, [id]);
  }
}

module.exports = { PromptsRepo };
