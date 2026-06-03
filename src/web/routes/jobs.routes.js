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

  // Легкий JSON-статус задачі — для підстраховки на фронті, коли SSE не
  // приєднався (сторінка опитує цей ендпоінт і перезавантажується, якщо
  // задача вже завершилась).
  fastify.get("/jobs/:id/status", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const job = await jobsRepo.findById(id);
    if (!job) return reply.code(404).send({ error: "not found" });
    return { id: job.id, status: job.status };
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

    // hijack() — кажемо Fastify НЕ керувати цією відповіддю: ми самі пишемо в
    // reply.raw і тримаємо сокет відкритим. Без цього Fastify вважає запит
    // обробленим (async-хендлер зарезолвився) і закриває/буферить потік — через
    // що події SSE не доходять до браузера в реальному часі.
    reply.hijack();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Початковий коментар + ретрай — браузер одразу вважає з'єднання відкритим.
    reply.raw.write(": connected\nretry: 3000\n\n");

    const send = (event, data) => {
      try { reply.raw.write(`event: ${event}\ndata: ${data}\n\n`); } catch (_) {}
    };
    const onLine = (line) => send("line", line.replace(/\n/g, "\\n"));
    const onSummary = (summary) => send("summary", JSON.stringify(summary));
    const onDone = (info) => {
      send("done", JSON.stringify(info));
      try { reply.raw.end(); } catch (_) {}
    };

    emitter.on("line", onLine);
    emitter.on("summary", onSummary);
    emitter.on("done", onDone);

    // Heartbeat кожні 15с — тримає з'єднання живим крізь проксі/таймаути.
    const ping = setInterval(() => {
      try { reply.raw.write(": ping\n\n"); } catch (_) {}
    }, 15000);

    req.raw.on("close", () => {
      clearInterval(ping);
      emitter.off("line", onLine);
      emitter.off("summary", onSummary);
      emitter.off("done", onDone);
    });
  });
}
module.exports = jobsRoutes;
