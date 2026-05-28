const { EventEmitter } = require("events");

// JobRunner запускає функцію у фоні і:
//   1) пише статуси/лог у web_jobs через JobsRepo;
//   2) емітить події 'line' і 'done' через EventEmitter для SSE.
// Виклик: runner.run({ kind, params, userId, fn })
//   де fn(ctx) → ctx.log(text); за помилки кидає throw.

class JobRunner {
  constructor({ jobsRepo }) {
    this.repo = jobsRepo;
    this.emitters = new Map(); // jobId → EventEmitter
  }

  emitterFor(jobId) {
    if (!this.emitters.has(jobId)) this.emitters.set(jobId, new EventEmitter());
    return this.emitters.get(jobId);
  }

  cleanup(jobId) {
    setTimeout(() => this.emitters.delete(jobId), 60_000);
  }

  async run({ kind, params, userId, fn }) {
    const jobId = await this.repo.create({ kind, params, userId });
    const emitter = this.emitterFor(jobId);
    setImmediate(async () => {
      try {
        await this.repo.start(jobId);
        const ctx = {
          jobId,
          log: async (line) => {
            const text = typeof line === "string" ? line : JSON.stringify(line);
            await this.repo.appendLog(jobId, text);
            emitter.emit("line", text);
          },
        };
        await fn(ctx);
        await this.repo.finishDone(jobId);
        emitter.emit("done", { status: "done" });
      } catch (e) {
        await this.repo.appendLog(jobId, `✗ FATAL: ${e.message}`);
        await this.repo.finishFailed(jobId, e.message);
        emitter.emit("done", { status: "failed", error: e.message });
      } finally {
        this.cleanup(jobId);
      }
    });
    return jobId;
  }
}

module.exports = { JobRunner };
