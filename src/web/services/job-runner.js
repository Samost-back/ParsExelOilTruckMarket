const { EventEmitter } = require("events");

// JobRunner запускає функцію у фоні і:
//   1) пише статуси/лог у web_jobs через JobsRepo;
//   2) емітить події 'line' і 'done' через EventEmitter для SSE;
//   3) дозволяє скасовувати через cancel(jobId) → SIGTERM дочірнім процесам.
// Виклик: runner.run({ kind, params, userId, fn })
//   де fn(ctx) → ctx.log(text); ctx.signal — AbortSignal; ctx.setChild(child) — реєстрація.

class JobRunner {
  constructor({ jobsRepo }) {
    this.repo = jobsRepo;
    this.emitters = new Map();   // jobId → EventEmitter
    this.controllers = new Map(); // jobId → AbortController
    this.children = new Map();    // jobId → Set<ChildProcess>
  }

  emitterFor(jobId) {
    if (!this.emitters.has(jobId)) this.emitters.set(jobId, new EventEmitter());
    return this.emitters.get(jobId);
  }

  cleanup(jobId) {
    this.controllers.delete(jobId);
    this.children.delete(jobId);
    setTimeout(() => this.emitters.delete(jobId), 60_000);
  }

  isRunning(jobId) {
    return this.controllers.has(jobId);
  }

  /**
   * Скасовує job. Шле SIGTERM усім зареєстрованим дочірнім процесам.
   * Повертає true якщо job був запущений (і cancel запрошено), false — якщо ні.
   */
  cancel(jobId) {
    const ctrl = this.controllers.get(jobId);
    if (!ctrl) return false;
    ctrl.abort();
    const kids = this.children.get(jobId);
    if (kids) for (const c of kids) { try { c.kill("SIGTERM"); } catch (_) {} }
    return true;
  }

  async run({ kind, params, userId, fn }) {
    const jobId = await this.repo.create({ kind, params, userId });
    const emitter = this.emitterFor(jobId);
    const ctrl = new AbortController();
    this.controllers.set(jobId, ctrl);
    this.children.set(jobId, new Set());

    setImmediate(async () => {
      try {
        await this.repo.start(jobId);
        const ctx = {
          jobId,
          signal: ctrl.signal,
          log: async (line) => {
            const text = typeof line === "string" ? line : JSON.stringify(line);
            await this.repo.appendLog(jobId, text);
            emitter.emit("line", text);
          },
          setChild: (child) => { this.children.get(jobId)?.add(child); },
          clearChild: (child) => { this.children.get(jobId)?.delete(child); },
        };
        await fn(ctx);
        if (ctrl.signal.aborted) {
          await this.repo.finishCancelled(jobId);
          emitter.emit("done", { status: "cancelled" });
        } else {
          await this.repo.finishDone(jobId);
          emitter.emit("done", { status: "done" });
        }
      } catch (e) {
        if (ctrl.signal.aborted) {
          await this.repo.appendLog(jobId, `⊘ Скасовано: ${e.message}`);
          await this.repo.finishCancelled(jobId);
          emitter.emit("done", { status: "cancelled" });
        } else {
          await this.repo.appendLog(jobId, `✗ FATAL: ${e.message}`);
          await this.repo.finishFailed(jobId, e.message);
          emitter.emit("done", { status: "failed", error: e.message });
        }
      } finally {
        this.cleanup(jobId);
      }
    });
    return jobId;
  }
}

module.exports = { JobRunner };
