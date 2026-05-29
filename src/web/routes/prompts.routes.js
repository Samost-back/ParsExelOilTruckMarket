const { PromptsRepo } = require("../../integrations/openai/prompts-repo");

async function promptsRoutes(fastify, { db }) {
  const repo = new PromptsRepo(db);

  // === Список + новий ===
  fastify.get("/prompts", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const prompts = await repo.list();
    return reply.view("prompts.ejs", {
      title: "AI промпти",
      user: req.user,
      active: "prompts",
      prompts,
      flash: req.query.flash ? { type: "success", message: req.query.flash } : null,
    });
  });

  // === Сторінка створення ===
  fastify.get("/prompts/new", { preHandler: fastify.requireAuth }, async (req, reply) => {
    return reply.view("prompt-edit.ejs", {
      title: "Новий промпт",
      user: req.user,
      active: "prompts",
      prompt: { id: null, name: "", body: "", is_default: false },
      mode: "create",
    });
  });

  // === Створення ===
  fastify.post("/prompts", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const { name, body, makeDefault } = req.body || {};
    if (!name || !body) return reply.code(400).send("Потрібні: name + body");
    try {
      await repo.create({
        name: String(name).trim(),
        body: String(body),
        makeDefault: makeDefault === "on" || makeDefault === "true",
      });
    } catch (e) {
      if (/unique/i.test(e.message)) return reply.code(400).send("Промпт з такою назвою вже існує");
      throw e;
    }
    return reply.redirect("/prompts?flash=" + encodeURIComponent("Промпт створено"));
  });

  // === Сторінка редагування ===
  fastify.get("/prompts/:id/edit", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const prompt = await repo.findById(id);
    if (!prompt) return reply.code(404).send("Не знайдено");
    return reply.view("prompt-edit.ejs", {
      title: prompt.name,
      user: req.user,
      active: "prompts",
      prompt,
      mode: "edit",
    });
  });

  // === Оновлення ===
  fastify.post("/prompts/:id", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { name, body } = req.body || {};
    if (!name || !body) return reply.code(400).send("Потрібні: name + body");
    await repo.update(id, { name: String(name).trim(), body: String(body) });
    return reply.redirect("/prompts?flash=" + encodeURIComponent("Збережено"));
  });

  // === Зробити дефолтним ===
  fastify.post("/prompts/:id/default", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    await repo.setDefault(id);
    return reply.redirect("/prompts?flash=" + encodeURIComponent("Дефолтний промпт оновлено"));
  });

  // === Видалення ===
  fastify.post("/prompts/:id/delete", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const p = await repo.findById(id);
    if (p && p.is_default) return reply.code(400).send("Не можна видалити дефолтний промпт");
    await repo.delete(id);
    return reply.redirect("/prompts?flash=" + encodeURIComponent("Видалено"));
  });
}

module.exports = promptsRoutes;
