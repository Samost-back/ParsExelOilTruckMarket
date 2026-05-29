import { describe, it, expect, vi } from "vitest";
const { JobRunner } = require("../../../src/web/services/job-runner");

function makeRepo() {
  let nextId = 1;
  const lines = new Map();
  const statuses = new Map();
  return {
    create: vi.fn(async () => nextId++),
    start: vi.fn(async (id) => { statuses.set(id, "running"); }),
    appendLog: vi.fn(async (id, line) => {
      lines.set(id, (lines.get(id) || "") + line + "\n");
    }),
    finishDone: vi.fn(async (id) => statuses.set(id, "done")),
    finishFailed: vi.fn(async (id, err) => statuses.set(id, "failed:" + err)),
    finishCancelled: vi.fn(async (id) => statuses.set(id, "cancelled")),
    setPid: vi.fn(async () => {}),
    _statuses: statuses,
    _lines: lines,
  };
}

// utility: чекає поки emitter не emit'не "done"
function waitForDone(runner, jobId, timeout = 5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), timeout);
    runner.emitterFor(jobId).once("done", (info) => { clearTimeout(t); res(info); });
  });
}

describe("JobRunner", () => {
  it("успішний job: статуси running → done, emit('done')", async () => {
    const repo = makeRepo();
    const runner = new JobRunner({ jobsRepo: repo, maxConcurrent: 5 });
    const jobId = await runner.run({
      kind: "test", params: {}, userId: 1,
      fn: async (ctx) => { await ctx.log("line1"); await ctx.log("line2"); },
    });
    const info = await waitForDone(runner, jobId);
    expect(info.status).toBe("done");
    expect(repo._statuses.get(jobId)).toBe("done");
    expect(repo._lines.get(jobId)).toContain("line1");
    expect(repo._lines.get(jobId)).toContain("line2");
  });

  it("fn throw → status failed з повідомленням", async () => {
    const repo = makeRepo();
    const runner = new JobRunner({ jobsRepo: repo, maxConcurrent: 5 });
    const jobId = await runner.run({
      kind: "test", params: {}, userId: 1,
      fn: async () => { throw new Error("oops"); },
    });
    const info = await waitForDone(runner, jobId);
    expect(info.status).toBe("failed");
    expect(info.error).toBe("oops");
    expect(repo._statuses.get(jobId)).toBe("failed:oops");
  });

  it("cancel: status cancelled + signal aborted", async () => {
    const repo = makeRepo();
    const runner = new JobRunner({ jobsRepo: repo, maxConcurrent: 5 });
    const jobId = await runner.run({
      kind: "test", params: {}, userId: 1,
      fn: async (ctx) => {
        await new Promise((res, rej) => {
          const t = setTimeout(res, 1000);
          ctx.signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); });
        });
      },
    });
    // Чекаємо щоб job стартанув
    await new Promise(r => setTimeout(r, 20));
    const ok = runner.cancel(jobId);
    expect(ok).toBe(true);
    const info = await waitForDone(runner, jobId);
    expect(info.status).toBe("cancelled");
    expect(repo._statuses.get(jobId)).toBe("cancelled");
  });

  it("cancel неіснуючого → false", () => {
    const runner = new JobRunner({ jobsRepo: makeRepo(), maxConcurrent: 5 });
    expect(runner.cancel(9999)).toBe(false);
  });

  it("isRunning + activeCount", async () => {
    const repo = makeRepo();
    const runner = new JobRunner({ jobsRepo: repo, maxConcurrent: 5 });
    const id = await runner.run({
      kind: "t", params: {}, userId: 1,
      fn: () => new Promise(r => setTimeout(r, 50)),
    });
    await new Promise(r => setTimeout(r, 5));
    expect(runner.isRunning(id)).toBe(true);
    expect(runner.activeCount()).toBe(1);
    await waitForDone(runner, id);
    // невелика затримка щоб cleanup() відпрацював
    await new Promise(r => setTimeout(r, 10));
    expect(runner.isRunning(id)).toBe(false);
    expect(runner.activeCount()).toBe(0);
  });

  it("semaphore: при перевищенні maxConcurrent → throw", async () => {
    const repo = makeRepo();
    const runner = new JobRunner({ jobsRepo: repo, maxConcurrent: 2 });
    await runner.run({ kind: "t", params: {}, userId: 1, fn: () => new Promise(r => setTimeout(r, 200)) });
    await runner.run({ kind: "t", params: {}, userId: 1, fn: () => new Promise(r => setTimeout(r, 200)) });
    await expect(
      runner.run({ kind: "t", params: {}, userId: 1, fn: () => Promise.resolve() })
    ).rejects.toThrow(/Перевищено ліміт/);
  });

  it("emitter після завершення лишається доступним 60c (cleanup затримка)", async () => {
    const repo = makeRepo();
    const runner = new JobRunner({ jobsRepo: repo, maxConcurrent: 5 });
    const id = await runner.run({
      kind: "t", params: {}, userId: 1,
      fn: () => Promise.resolve(),
    });
    await waitForDone(runner, id);
    // controllers очищаються одразу, emitter — через 60s setTimeout
    expect(runner.controllers.has(id)).toBe(false);
    expect(runner.emitters.has(id)).toBe(true);
  });
});
