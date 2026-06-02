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
    // Кнопка "Зупинити" видима для будь-якого активного job — у memory runner-а
    // або orphan (running у БД після рестарту, але PID живий).
    const canCancel = runner.isRunning(id)
      || (job.status === "running" || job.status === "pending");
    return reply.view("job.ejs", {
      title: `Job #${job.id}`,
      user: req.user,
      active: "jobs",
      job,
      canCancel,
    });
  });

  // === Зупинити job ===
  // 1) Спочатку через in-memory runner (нормальний випадок)
  // 2) Інакше — fallback: SIGTERM по PID з БД, і ручне marking 'cancelled'
  fastify.post("/jobs/:id/cancel", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);

    // Гарячий шлях
    if (runner.cancel(id)) {
      return reply.redirect(`/jobs/${id}`);
    }

    // Orphan fallback
    const job = await jobsRepo.findById(id);
    if (!job) return reply.code(404).send("Job не знайдено");
    if (job.status !== "running" && job.status !== "pending") {
      return reply.code(409).send(`Job вже завершився (status=${job.status})`);
    }

    let killed = false;
    if (job.pid) {
      try { process.kill(job.pid, "SIGTERM"); killed = true; } catch (_) {}
    }
    await jobsRepo.appendLog(id,
      killed ? `⊘ Зупинено (kill PID=${job.pid})`
             : `⊘ Зупинено (runner orphan${job.pid ? `, PID=${job.pid} вже мертвий` : ", PID невідомий"})`,
    );
    await jobsRepo.finishCancelled(id);
    // Якщо є оливо в стані in_progress — відкатуємо їх у pending
    if (req.server) {
      // No-op
    }
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
    const onSummary = (summary) =>
      reply.raw.write(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
    const onDone = (info) => {
      reply.raw.write(`event: done\ndata: ${JSON.stringify(info)}\n\n`);
      reply.raw.end();
    };

    emitter.on("line", onLine);
    emitter.on("summary", onSummary);
    emitter.on("done", onDone);

    req.raw.on("close", () => {
      emitter.off("line", onLine);
      emitter.off("summary", onSummary);
      emitter.off("done", onDone);
    });
  });
}
module.exports = jobsRoutes;
