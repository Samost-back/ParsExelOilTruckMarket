import { describe, it, expect } from "vitest";
const { spawnTask } = require("../../src/web/tasks/spawn-task");

// ctx-заглушка: збирає рядки логу. spawnTask не показує @@TAG@@-рядки в лог,
// а збирає їх у markers і повертає у resolve({ markers }).
function makeCtx() {
  const lines = [];
  return { log: (l) => lines.push(l), _lines: lines };
}

describe("spawnTask маркери", () => {
  it("збирає @@DIFF@@/@@PHOTODIFF@@ і НЕ дублює їх у лог", async () => {
    const ctx = makeCtx();
    // Друкуємо: звичайний рядок, DIFF-маркер, ще рядок, PHOTODIFF-маркер.
    const script = [
      'console.log("звичайний рядок");',
      'console.log("@@DIFF@@ " + JSON.stringify({ inserted: 3, updated: 5, pricesSet: 2 }));',
      'console.log("ще рядок");',
      'console.log("@@PHOTODIFF@@ " + JSON.stringify({ done: 7, skipped: 1, failed: 0 }));',
    ].join("");
    // node -e <script>: передаємо як args, scriptPath = "-e".
    const res = await spawnTaskInline(ctx, script);

    expect(res.markers).toHaveLength(2);
    const diff = res.markers.find((m) => m.tag === "DIFF");
    const photo = res.markers.find((m) => m.tag === "PHOTODIFF");
    expect(diff.data).toEqual({ inserted: 3, updated: 5, pricesSet: 2 });
    expect(photo.data).toEqual({ done: 7, skipped: 1, failed: 0 });

    // У лозі — лише НЕ-маркерні рядки.
    const log = ctx._lines.join("\n");
    expect(log).toContain("звичайний рядок");
    expect(log).toContain("ще рядок");
    expect(log).not.toContain("@@DIFF@@");
    expect(log).not.toContain("@@PHOTODIFF@@");
  });

  it("невалідний JSON у маркері → лишається в лозі (для діагностики)", async () => {
    const ctx = makeCtx();
    const script = 'console.log("@@DIFF@@ not-json{{{");';
    const res = await spawnTaskInline(ctx, script);
    expect(res.markers).toHaveLength(0);
    expect(ctx._lines.join("\n")).toContain("@@DIFF@@ not-json");
  });

  it("без маркерів → markers порожній, лог цілий", async () => {
    const ctx = makeCtx();
    const res = await spawnTaskInline(ctx, 'console.log("a");console.log("b");');
    expect(res.markers).toEqual([]);
    expect(ctx._lines).toContain("a");
    expect(ctx._lines).toContain("b");
  });
});

// Хелпер: spawnTask запускає файл-скрипт. Пишемо код у тимчасовий .js,
// запускаємо через справжній spawnTask (щоб тестувати реальний парсер маркерів),
// після завершення прибираємо файл.
function spawnTaskInline(ctx, code) {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const tmp = path.join(os.tmpdir(), `spawntask_test_${process.pid}_${Math.round(performance.now())}.js`);
  fs.writeFileSync(tmp, code, "utf8");
  return spawnTask(ctx, tmp, []).finally(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
}
