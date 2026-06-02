const { spawn } = require("child_process");
const path = require("path");

// Машиночитані маркери: дочірній скрипт може вивести рядок "@@TAG@@ {json}".
// Ми такі рядки НЕ показуємо в логах (вони службові), а збираємо у markers
// і повертаємо батьку, щоб він склав картку-зведення (diff). Решта stdout → ctx.log.
const MARKER_RE = /^@@([A-Z_]+)@@\s+(.*)$/;

// Запускає Node-скрипт як child process. stdout/stderr → ctx.log.
// Якщо в ctx є signal (AbortSignal) — при .abort() надсилає SIGTERM дочірньому процесу.
// Повертає promise → resolve({ markers }) при exit 0, reject при non-zero/aborted.
//   markers — масив { tag, data } розпарсених @@TAG@@-рядків.
function spawnTask(ctx, scriptPath, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const abs = path.resolve(scriptPath);
    ctx.log(`$ node ${path.relative(process.cwd(), abs)} ${args.join(" ")}`);
    const child = spawn(process.execPath, [abs, ...args], {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...opts.env },
    });

    // Зберігаємо PID у контексті, щоб JobRunner міг прибити при cancel.
    if (ctx.setChild) ctx.setChild(child);

    // AbortSignal → SIGTERM
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      try { child.kill("SIGTERM"); } catch (_) {}
      // якщо не помер через 5с — SIGKILL
      setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 5000);
    };
    if (ctx.signal) {
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener("abort", onAbort, { once: true });
    }

    const markers = [];
    const onLine = (buf) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = line.match(MARKER_RE);
        if (m) {
          try { markers.push({ tag: m[1], data: JSON.parse(m[2]) }); }
          catch (_) { ctx.log(line); } // невалідний JSON — лишаємо в логах для діагностики
          continue; // маркер не дублюємо в лог
        }
        ctx.log(line);
      }
    };
    child.stdout.on("data", onLine);
    child.stderr.on("data", onLine);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (ctx.clearChild) ctx.clearChild(child);
      if (ctx.signal) ctx.signal.removeEventListener("abort", onAbort);
      if (aborted || signal) return reject(new Error(`Скасовано (signal=${signal || "SIGTERM"})`));
      if (code === 0) resolve({ markers });
      else reject(new Error(`process exited with code ${code}`));
    });
  });
}
module.exports = { spawnTask };
