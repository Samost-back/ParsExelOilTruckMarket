const { EventEmitter } = require("events");

// JobRunner запускає функцію у фоні:
//   1) пише статуси/лог у web_jobs через JobsRepo;
//   2) емітить події 'line' і 'done' через EventEmitter для SSE;
//   3) дозволяє скасовувати через cancel(jobId) → SIGTERM дочірнім процесам;
//   4) обмежує кількість одночасно активних jobs (semaphore).
//
// Виклик: runner.run({ kind, params, userId, fn })
//   де fn(ctx) → ctx.log(text); ctx.signal — AbortSignal; ctx.setChild(child) — реєстрація.

class JobRunner {
  constructor({ jobsRepo, maxConcurrent = parseInt(process.env.MAX_CONCURRENT_JOBS || "3", 10) }) {
    this.repo = jobsRepo;
    this.emitters = new Map();    // jobId → EventEmitter
    this.controllers = new Map(); // jobId → AbortController
    this.children = new Map();    // jobId → Set<ChildProcess>
    this.finishedAt = new Map();  // jobId → timestamp коли завершився (для розрізнення active vs already-cleaned)
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  emitterFor(jobId) {
    // Не створюємо емітер для job'ів, які вже завершились (захист від memory leak).
    if (!this.emitters.has(jobId) && !this.finishedAt.has(jobId)) {
      this.emitters.set(jobId, new EventEmitter());
    }
    // Для завершених повертаємо одноразовий емітер що одразу emit('done')
    if (this.finishedAt.has(jobId) && !this.emitters.has(jobId)) {
      const ee = new EventEmitter();
      // микрозатримка — підписники встигнуть приєднатись
      setImmediate(() => ee.emit("done", { status: "finished_before_subscribe" }));
      return ee;
    }
    return this.emitters.get(jobId);
  }

  cleanup(jobId) {
    this.controllers.delete(jobId);
    this.children.delete(jobId);
    this.finishedAt.set(jobId, Date.now());
    // Через 60с — повне очищення.
    setTimeout(() => {
      this.emitters.delete(jobId);
      this.finishedAt.delete(jobId);
    }, 60_000);
  }

  isRunning(jobId) {
    return this.controllers.has(jobId);
  }

  activeCount() {
    return this.controllers.size;
  }

  /**
   * Скасовує job. Шле SIGTERM усім зареєстрованим дочірнім процесам.
   * Повертає true якщо job був запущений (і cancel запрошено).
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
    // Semaphore: захист від лавини processes
    if (this.activeCount() >= this.maxConcurrent) {
      throw new Error(
        `Перевищено ліміт одночасних задач (${this.maxConcurrent}). ` +
        `Дочекайтесь завершення поточних або зупиніть якусь у /jobs.`
      );
    }

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
          setChild: async (child) => {
            this.children.get(jobId)?.add(child);
            try { await this.repo.setPid(jobId, child.pid); } catch (_) {}
          },
          clearChild: async (child) => {
            this.children.get(jobId)?.delete(child);
            try { await this.repo.setPid(jobId, null); } catch (_) {}
          },
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
