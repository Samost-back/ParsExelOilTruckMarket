async function jobsRoutes(fastify, { jobsRepo, runner }) {
  fastify.get("/jobs", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const jobs = await jobsRepo.listRecent(100);
    return reply.view("jobs.ejs", {
      title: "Задачі",
      user: req.user,
      active: "jobs",
      jobs,
    });
  });

  fastify.get("/jobs/:id", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const job = await jobsRepo.findById(id);
    if (!job) return reply.code(404).send("Job not found");
    return reply.view("job.ejs", {
      title: `Job #${job.id}`,
      user: req.user,
      active: "jobs",
      job,
      canCancel: runner.isRunning(id),
    });
  });

  // === Зупинити job ===
  fastify.post("/jobs/:id/cancel", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const ok = runner.cancel(id);
    if (!ok) return reply.code(409).send("Job не запущений або вже завершився");
    return reply.redirect(`/jobs/${id}`);
  });

  // SSE — live стрим логів. Працює лише поки job в пам'яті (емітер).
  fastify.get("/jobs/:id/stream", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const emitter = runner.emitterFor(id);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const onLine = (line) => reply.raw.write(`event: line\ndata: ${line.replace(/\n/g, "\\n")}\n\n`);
    const onDone = (info) => {
      reply.raw.write(`event: done\ndata: ${JSON.stringify(info)}\n\n`);
      reply.raw.end();
    };

    emitter.on("line", onLine);
    emitter.on("done", onDone);

    req.raw.on("close", () => {
      emitter.off("line", onLine);
      emitter.off("done", onDone);
    });
  });
}
module.exports = jobsRoutes;
