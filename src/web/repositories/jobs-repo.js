// Репозиторій web_jobs. Job — фонова задача (parse/photos/integrations).
class JobsRepo {
  constructor(db) { this.db = db; }

  async create({ kind, params, userId }) {
    const r = await this.db.query(
      `INSERT INTO web_jobs (kind, params, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [kind, params || {}, userId || null],
    );
    return r.rows[0].id;
  }

  findById(id) {
    return this.db.query(
      `SELECT * FROM web_jobs WHERE id = $1`,
      [id],
    ).then(r => r.rows[0] || null);
  }

  async start(id) {
    await this.db.query(
      `UPDATE web_jobs SET status='running', started_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async setPid(id, pid) {
    await this.db.query(`UPDATE web_jobs SET pid = $2 WHERE id = $1`, [id, pid || null]);
  }

  /**
   * Позначає всі залишені 'running'/'pending' jobs як 'cancelled'.
   * Викликається при старті server.js — якщо контейнер перезапустився,
   * їхні child-процеси точно мертві.
   */
  async reapOrphans() {
    const r = await this.db.query(`
      UPDATE web_jobs
         SET status = 'cancelled',
             finished_at = NOW(),
             log = log || E'\n⊘ Reaped (server restart)'
       WHERE status IN ('running', 'pending')
   RETURNING id, kind`);
    return r.rows;
  }

  async appendLog(id, line) {
    await this.db.query(
      `UPDATE web_jobs SET log = log || $2 || E'\n' WHERE id = $1`,
      [id, line],
    );
  }

  async finishDone(id) {
    await this.db.query(
      `UPDATE web_jobs SET status='done', finished_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async finishFailed(id, error) {
    await this.db.query(
      `UPDATE web_jobs SET status='failed', error = $2, finished_at = NOW() WHERE id = $1`,
      [id, error],
    );
  }

  async finishCancelled(id) {
    await this.db.query(
      `UPDATE web_jobs SET status='cancelled', finished_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  listRecent(limit = 20) {
    return this.db.query(
      `SELECT id, kind, status, started_at, finished_at, created_at
         FROM web_jobs ORDER BY id DESC LIMIT $1`,
      [limit],
    ).then(r => r.rows);
  }
}
module.exports = { JobsRepo };
