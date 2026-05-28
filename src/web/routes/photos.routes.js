const { spawnTask } = require("../tasks/spawn-task");

async function photosRoutes(fastify, { runner }) {
  fastify.post("/photos/process", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const limit = (req.body && req.body.limit) ? String(req.body.limit) : null;
    const args = limit ? [limit] : [];

    const jobId = await runner.run({
      kind: "photos-process",
      params: { limit },
      userId: req.user.id,
      fn: async (ctx) => {
        await spawnTask(ctx, "src/photos/process/index.js", args);
      },
    });

    return reply.redirect(`/jobs/${jobId}`);
  });
}
module.exports = photosRoutes;
