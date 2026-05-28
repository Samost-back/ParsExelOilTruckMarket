const { spawn } = require("child_process");
const path = require("path");

// Запускає Node-скрипт як child process. stdout/stderr → ctx.log.
// Повертає promise → resolve при exit 0, reject при non-zero.
function spawnTask(ctx, scriptPath, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const abs = path.resolve(scriptPath);
    ctx.log(`$ node ${path.relative(process.cwd(), abs)} ${args.join(" ")}`);
    const child = spawn(process.execPath, [abs, ...args], {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...opts.env },
    });
    const onLine = (buf) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) ctx.log(line);
      }
    };
    child.stdout.on("data", onLine);
    child.stderr.on("data", onLine);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`process exited with code ${code}`));
    });
  });
}
module.exports = { spawnTask };
