// Fastify web server.
// Запуск: node src/web/server.js   (PORT з .env, дефолт 3000)

require("dotenv").config();
const path = require("path");
const Fastify = require("fastify");
const ejs = require("ejs");

const { getPool, closePool } = require("../shared/infra/db");
const { UsersRepo } = require("./repositories/users-repo");
const { JobsRepo } = require("./repositories/jobs-repo");
const { JobRunner } = require("./services/job-runner");

const authPlugin = require("./plugins/auth");
const viewHelpers = require("./view-helpers");

async function buildServer() {
  // trustProxy — ОБОВ'ЯЗКОВО на prod за reverse-proxy (HTTPS-термінація на
  // nginx/Caddy/Traefik). Дозволяє Fastify довіряти X-Forwarded-* (Proto/For),
  // щоб req.protocol був "https" і secure-cookie виставлялись коректно.
  // TRUST_PROXY: "true"/"false" або кількість проксі-хопів / список IP.
  const trustProxyEnv = process.env.TRUST_PROXY;
  const trustProxy =
    trustProxyEnv === undefined
      ? process.env.NODE_ENV === "production" // дефолт: увімкнено на prod
      : trustProxyEnv === "true"
        ? true
        : trustProxyEnv === "false"
          ? false
          : /^\d+$/.test(trustProxyEnv)
            ? parseInt(trustProxyEnv, 10)
            : trustProxyEnv; // список IP/CIDR через кому

  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || "info" },
    trustProxy,
  });

  // 1. DB pool — share через все приложение, SSE не блокує інші запити.
  const db = getPool();
  fastify.addHook("onClose", async () => closePool());

  const usersRepo = new UsersRepo(db);
  const jobsRepo = new JobsRepo(db);
  const runner = new JobRunner({
    jobsRepo,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_JOBS || "3", 10),
  });

  // Reaper: підбираємо orphans після рестарту (їхні child-процеси точно мертві)
  const reaped = await jobsRepo.reapOrphans();
  if (reaped.length) {
    console.log(`✓ Reaped ${reaped.length} orphan job(s): ${reaped.map(j => `#${j.id} ${j.kind}`).join(", ")}`);
    await db.query(`
      UPDATE olivs SET truck_status = 'pending', truck_error = NULL, truck_at = NULL
       WHERE truck_status = 'in_progress'`);
  }

  // 2. Plugins
  await fastify.register(require("@fastify/formbody"));
  await fastify.register(require("@fastify/multipart"), {
    limits: {
      // MAX_UPLOAD_BYTES з .env (дефолт 500 MB на файл).
      // Папка з фото може мати багато файлів — це ліміт ПО ФАЙЛУ, не загальний.
      fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || String(500 * 1024 * 1024), 10),
    },
  });
  await fastify.register(require("@fastify/view"), {
    engine: { ejs },
    root: path.join(__dirname, "views"),
    layout: "layout.ejs",
    // Хелпери (переклад статусів, форматування дат у Київському часі) — у
    // defaultContext, тож доступні в кожному шаблоні без передачі вручну.
    defaultContext: { user: null, flash: null, active: null, ...viewHelpers },
    propertyName: "view",
  });
  await fastify.register(require("@fastify/static"), {
    root: path.join(__dirname, "public"),
    prefix: "/public/",
  });
  await fastify.register(authPlugin, {
    sessionSecret: process.env.SESSION_SECRET,
    cookieSecure: process.env.NODE_ENV === "production",
    usersRepo,
  });

  // Глобальний error handler: дає user-friendly 429 при перевищенні ліміту jobs.
  fastify.setErrorHandler(async (err, req, reply) => {
    if (/Перевищено ліміт одночасних задач/.test(err.message)) {
      reply.code(429);
      // Якщо це fetch — повертаємо текст, якщо HTML form — рендеримо просту сторінку
      if ((req.headers.accept || "").includes("text/html")) {
        return reply.view("error.ejs", {
          title: "Забагато активних задач",
          user: req.user || null,
          active: null,
          code: 429,
          message: err.message,
        });
      }
      return { error: err.message };
    }
    req.log.error(err);
    reply.code(err.statusCode || 500);
    return { error: err.message };
  });

  // 3. Health endpoint (без auth, для docker healthcheck)
  fastify.get("/health", async () => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", jobs_active: runner.activeCount() };
    } catch (e) {
      return { status: "degraded", error: e.message };
    }
  });

  // 4. Routes
  await fastify.register(require("./routes/auth.routes"));
  await fastify.register(require("./routes/dashboard.routes"), { db, jobsRepo });
  await fastify.register(require("./routes/import.routes"), { db, runner });
  await fastify.register(require("./routes/companies.routes"), { db, runner });
  await fastify.register(require("./routes/oils.routes"), { db, runner });
  await fastify.register(require("./routes/prompts.routes"), { db });
  await fastify.register(require("./routes/integrations.routes"), { runner, jobsRepo });
  await fastify.register(require("./routes/jobs.routes"), { jobsRepo, runner });

  return fastify;
}

(async () => {
  const fastify = await buildServer();
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";
  await fastify.listen({ port, host });
  console.log(`✓ Web running on http://${host}:${port}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
