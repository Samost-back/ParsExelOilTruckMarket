const { spawn } = require("child_process");
const path = require("path");

// Запускає Node-скрипт як child process. stdout/stderr → ctx.log.
// Якщо в ctx є signal (AbortSignal) — при .abort() надсилає SIGTERM дочірньому процесу.
// Повертає promise → resolve при exit 0, reject при non-zero/aborted.
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

    const onLine = (buf) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) ctx.log(line);
      }
    };
    child.stdout.on("data", onLine);
    child.stderr.on("data", onLine);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (ctx.clearChild) ctx.clearChild(child);
      if (ctx.signal) ctx.signal.removeEventListener("abort", onAbort);
      if (aborted || signal) return reject(new Error(`Скасовано (signal=${signal || "SIGTERM"})`));
      if (code === 0) resolve();
      else reject(new Error(`process exited with code ${code}`));
    });
  });
}
module.exports = { spawnTask };
