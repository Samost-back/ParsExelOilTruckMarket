import { describe, it, expect, afterEach } from "vitest";
const http = require("http");
const Fastify = require("fastify");
const { EventEmitter } = require("events");
const jobsRoutes = require("../../src/web/routes/jobs.routes");

// Мінімальний runner-стаб: тримає емітер, дозволяє «жити» поки тест емітить.
function makeRunner() {
  const emitters = new Map();
  return {
    _emitters: emitters,
    emitterFor(id) {
      if (!emitters.has(id)) emitters.set(id, new EventEmitter());
      return emitters.get(id);
    },
    isRunning: () => true,
    cancel: () => true,
  };
}
const jobsRepoStub = {
  findById: async (id) => ({ id, kind: "import", status: "running", log: "" }),
};

let app;
afterEach(async () => { if (app) await app.close(); app = null; });

// Слухає SSE через справжній http.get; повертає { events, raw, close }.
function listenSSE(port, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, headers: { Cookie: cookie || "" } }, (res) => {
      let raw = "";
      const events = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
        // парсимо повні SSE-блоки "event: X\ndata: Y\n\n"
        let idx;
        while ((idx = raw.indexOf("\n\n")) !== -1) {
          const block = raw.slice(0, idx);
          raw = raw.slice(idx + 2);
          const m = block.match(/event: (\w+)\ndata: (.*)/s);
          if (m) events.push({ event: m[1], data: m[2] });
        }
      });
      res.on("error", reject);
      resolve({ events, res, close: () => req.destroy() });
    });
    req.on("error", reject);
  });
}

describe("SSE /jobs/:id/stream — реальне стрімінг (hijack)", () => {
  it("події line/summary/done доходять у реальному часі (без рефрешу)", async () => {
    const runner = makeRunner();
    app = Fastify();
    // requireAuth-стаб — пропускаємо.
    app.decorate("requireAuth", async () => {});
    await app.register(jobsRoutes, { jobsRepo: jobsRepoStub, runner });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = app.server.address().port;

    const sub = await listenSSE(port, "/jobs/42/stream");
    // дамо з'єднанню встановитись
    await new Promise((r) => setTimeout(r, 100));

    const emitter = runner.emitterFor(42);
    emitter.emit("line", "перший рядок");
    emitter.emit("summary", { mode: "xlsx", steps: [] });
    emitter.emit("line", "другий рядок");
    emitter.emit("done", { status: "done" });

    // чекаємо доставки
    await new Promise((r) => setTimeout(r, 200));

    const kinds = sub.events.map((e) => e.event);
    expect(kinds).toContain("line");
    expect(kinds).toContain("summary");
    expect(kinds).toContain("done");

    const lines = sub.events.filter((e) => e.event === "line").map((e) => e.data);
    expect(lines).toContain("перший рядок");
    expect(lines).toContain("другий рядок");

    const summary = sub.events.find((e) => e.event === "summary");
    expect(JSON.parse(summary.data).mode).toBe("xlsx");

    const done = sub.events.find((e) => e.event === "done");
    expect(JSON.parse(done.data).status).toBe("done");

    sub.close();
  });

  it("преамбула ': connected' приходить одразу при підключенні", async () => {
    const runner = makeRunner();
    app = Fastify();
    app.decorate("requireAuth", async () => {});
    await app.register(jobsRoutes, { jobsRepo: jobsRepoStub, runner });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = app.server.address().port;

    const got = await new Promise((resolve, reject) => {
      const req = http.get({ port, path: "/jobs/1/stream" }, (res) => {
        res.setEncoding("utf8");
        res.once("data", (chunk) => { req.destroy(); resolve(chunk); });
        res.on("error", reject);
      });
      req.on("error", reject);
      setTimeout(() => { req.destroy(); resolve(""); }, 1000);
    });
    expect(got).toContain(": connected");
  });
});
