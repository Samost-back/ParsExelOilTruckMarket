const { spawnTask } = require("../tasks/spawn-task");

async function integrationsRoutes(fastify, { runner }) {
  fastify.post("/integrations/truckmarket/run", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const limit = (req.body && req.body.limit) ? String(req.body.limit) : "10";
    const noAi = req.body && (req.body.noAi === "on" || req.body.noAi === "true");
    const args = [limit];
    if (noAi) args.push("--no-ai");

    const jobId = await runner.run({
      kind: "integrations-run",
      params: { limit, noAi: !!noAi },
      userId: req.user.id,
      fn: async (ctx) => {
        await spawnTask(ctx, "src/integrations/truckmarket/run.js", args);
      },
    });

    return reply.redirect(`/jobs/${jobId}`);
  });
}
module.exports = integrationsRoutes;
