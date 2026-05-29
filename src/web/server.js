// Fastify web server.
// Запуск: node src/web/server.js   (PORT з .env, дефолт 3000)

require("dotenv").config();
const path = require("path");
const Fastify = require("fastify");
const ejs = require("ejs");

const { createDbClient } = require("../shared/infra/db");
const { UsersRepo } = require("./repositories/users-repo");
const { JobsRepo } = require("./repositories/jobs-repo");
const { JobRunner } = require("./services/job-runner");

const authPlugin = require("./plugins/auth");

async function buildServer() {
  const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

  // 1. DB connection (shared для всього додатку)
  const db = createDbClient();
  await db.connect();
  fastify.addHook("onClose", async () => db.end().catch(() => {}));

  const usersRepo = new UsersRepo(db);
  const jobsRepo = new JobsRepo(db);
  const runner = new JobRunner({ jobsRepo });

  // 2. Plugins
  await fastify.register(require("@fastify/formbody"));
  await fastify.register(require("@fastify/multipart"), {
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB
  });
  await fastify.register(require("@fastify/view"), {
    engine: { ejs },
    root: path.join(__dirname, "views"),
    layout: "layout.ejs",
    defaultContext: { user: null, flash: null, active: null },
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

  // 3. Routes
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
