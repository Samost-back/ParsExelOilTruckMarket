const { spawnTask } = require("../tasks/spawn-task");

async function integrationsRoutes(fastify, { runner, jobsRepo }) {
  fastify.get("/integrations", { preHandler: fastify.requireAuth }, async (req, reply) => {
    // Шукаємо активний integrations-run, щоб показати кнопку "Зупинити"
    const recent = await jobsRepo.listRecent(20);
    const active = recent.find((j) => j.kind === "integrations-run"
      && (j.status === "running" || j.status === "pending"));

    return reply.view("integrations.ejs", {
      title: "Інтеграції",
      user: req.user,
      active: "integrations",
      activeJob: active || null,
    });
  });

  fastify.post("/integrations/truckmarket/run", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const jobId = await runner.run({
      kind: "integrations-run",
      params: {},
      userId: req.user.id,
      fn: async (ctx) => {
        await spawnTask(ctx, "src/integrations/truckmarket/run.js", []);
      },
    });
    return reply.redirect(`/jobs/${jobId}`);
  });
}
module.exports = integrationsRoutes;
