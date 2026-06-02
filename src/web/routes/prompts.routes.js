const path = require("path");
const ejs = require("ejs");
const { PromptsRepo } = require("../../integrations/openai/prompts-repo");
const { DescriptionGenerator } = require("../../integrations/openai/description-generator");
const { OpenAIClient } = require("../../integrations/openai/openai-client");

const VIEWS_DIR = path.join(__dirname, "..", "views");
// renderFile повертає Promise — викликаємо з await на місці використання.
const renderFragment = (name, data) =>
  ejs.renderFile(path.join(VIEWS_DIR, name), data, { async: false });

// Повний рядок оливо для симуляції (поля, які споживає DescriptionGenerator).
async function fetchOilForSim(db, oilsId) {
  const r = await db.query(`
    SELECT o.id, o.name_type_oil, o.name, o.type_oil, o.viscosity_sae,
           o.low_level_saps, o.packaging_volume, o.articul, o.acea, o.api,
           o.manufacturers_tolerances, o.car_brand, o.quantity,
           o.iso_vg_viscosity_grade, o.color_liquid, o.dot, o.brand,
           c.name_company AS company_name
      FROM olivs o JOIN company_olivs c ON c.id = o.company_id
     WHERE o.id = $1`, [oilsId]);
  return r.rows[0] || null;
}

async function promptsRoutes(fastify, { db }) {
  const repo = new PromptsRepo(db);

  // Список олив для селектора симулятора (id + людська мітка).
  async function oilsForSelect() {
    const r = await db.query(`
      SELECT o.id, o.name, o.articul, c.name_company
        FROM olivs o JOIN company_olivs c ON c.id = o.company_id
    ORDER BY o.id DESC LIMIT 500`);
    return r.rows;
  }

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
      oils: await oilsForSelect(),
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
      oils: await oilsForSelect(),
    });
  });

  // === AI-симулятор: попередній перегляд опису без збереження в БД ===
  // Приймає oils_id + body (текст промпту з редактора). Будує генератор з ЦИМ
  // промптом (не з БД), генерує опис і повертає HTML-фрагмент. Нічого не пише.
  fastify.post("/prompts/simulate", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const { oils_id, body } = req.body || {};
    const id = parseInt(oils_id, 10);
    const promptBody = (body == null ? "" : String(body)).trim();
    const send = async (data) =>
      reply.type("text/html").send(await renderFragment("_prompt-sim-result.ejs", data));

    if (!id) return send({ ok: false, error: "Виберіть оливу" });
    if (!promptBody) return send({ ok: false, error: "Текст промпту порожній" });
    if (!process.env.OPENAI_API_KEY) {
      return send({ ok: false, error: "OPENAI_API_KEY не налаштований — симуляція недоступна" });
    }
    const row = await fetchOilForSim(db, id);
    if (!row) return send({ ok: false, error: "Оливу не знайдено" });

    try {
      const client = new OpenAIClient();
      const generator = new DescriptionGenerator({ client, systemPrompt: promptBody });
      const text = await generator.generateForOil(row);
      return send({ ok: true, text, oilName: row.name });
    } catch (e) {
      return send({ ok: false, error: `Помилка генерації: ${e.message}` });
    }
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
