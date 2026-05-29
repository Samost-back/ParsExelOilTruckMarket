// Integration-тест HttpClient + TruckTokenProvider через локальний HTTP-сервер.
// Не використовує реальні axios mock'и — підіймає справжній http.Server.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
const { HttpClient } = require("../../../src/shared/infra/http-client");
const { TruckTokenProvider } = require("../../../src/integrations/truckmarket/truck-token-provider");

let server;
let baseUrl;
let calls = [];
let authToken = "TOKEN_1";

function start() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        calls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
        const url = req.url;

        // /auth
        if (url === "/intapi/v1/auth") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { token: authToken } }));
          return;
        }
        // /always401 — для тестування 401 retry
        if (url === "/always401") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "expired" }));
          return;
        }
        // /once401 — перший раз 401, потім 200
        if (url === "/once401") {
          const expired = calls.filter(c => c.url === "/once401").length === 1;
          if (expired) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: "expired" }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          }
          return;
        }
        // /500
        if (url === "/500") {
          res.writeHead(500);
          res.end(JSON.stringify({ err: "boom" }));
          return;
        }
        // /ok
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ echo: body || null, url }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

beforeAll(start);
afterAll(() => new Promise((r) => server.close(r)));

function makeProvider() {
  return new TruckTokenProvider({ baseUrl, keyId: "k", secret: "s" });
}

describe("HttpClient + TruckTokenProvider (integration)", () => {
  it("auth → токен з відповіді /intapi/v1/auth", async () => {
    calls = [];
    const p = makeProvider();
    expect(await p.get()).toBe("TOKEN_1");
    expect(calls.some(c => c.url === "/intapi/v1/auth" && c.method === "POST")).toBe(true);
  });

  it("HttpClient.send: успіх повертає data", async () => {
    calls = [];
    const c = new HttpClient({ baseUrl, tokenProvider: makeProvider() });
    const r = await c.send({ method: "POST", path: "/ok", json: { x: 1 } });
    expect(r.url).toBe("/ok");
    // Bearer header передався
    const okCall = calls.find(c => c.url === "/ok");
    expect(okCall.auth).toBe("Bearer TOKEN_1");
  });

  it("401 → invalidate token + retry один раз", async () => {
    calls = [];
    authToken = "T1";
    const provider = makeProvider();
    const c = new HttpClient({ baseUrl, tokenProvider: provider });

    // Зміна токена щоб після retry був інший
    setTimeout(() => { authToken = "T2"; }, 0);

    const r = await c.send({ method: "GET", path: "/once401" });
    expect(r).toEqual({ ok: true });
    // 2 запити /once401 (один 401, другий 200)
    expect(calls.filter(c => c.url === "/once401")).toHaveLength(2);
  });

  it("401 двічі поспіль → throw", async () => {
    calls = [];
    const c = new HttpClient({ baseUrl, tokenProvider: makeProvider() });
    await expect(c.send({ method: "GET", path: "/always401" })).rejects.toThrow(/401/);
  });

  it("500 → throw з тілом", async () => {
    calls = [];
    const c = new HttpClient({ baseUrl, tokenProvider: makeProvider() });
    await expect(c.send({ method: "GET", path: "/500" })).rejects.toThrow(/500.*boom/);
  });

  it("TokenProvider закешує — другий get() без HTTP-виклику", async () => {
    calls = [];
    const p = makeProvider();
    await p.get();
    await p.get();
    await p.get();
    expect(calls.filter(c => c.url === "/intapi/v1/auth")).toHaveLength(1);
  });

  it("invalidate → новий /auth запит", async () => {
    calls = [];
    const p = makeProvider();
    await p.get();
    p.invalidate();
    await p.get();
    expect(calls.filter(c => c.url === "/intapi/v1/auth")).toHaveLength(2);
  });
});
