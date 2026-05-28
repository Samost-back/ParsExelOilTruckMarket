// Перенаправляє console.log/.error всередині await fn() у ctx.log.
// Дозволяє переюзати CLI-скрипти без переписування.
async function withCapturedStdout(ctx, fn) {
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => {
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    ctx.log(line);
    origLog(...args);
  };
  console.error = (...args) => {
    const line = "ERR: " + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    ctx.log(line);
    origErr(...args);
  };
  try {
    return await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}
module.exports = { withCapturedStdout };
