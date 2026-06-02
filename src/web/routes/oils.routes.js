const path = require("path");
const ejs = require("ejs");
const { TruckMarketClient } = require("../../integrations/truckmarket/client");

// Рендер EJS-партіала БЕЗ глобального layout (для HTMX-фрагментів рядків).
// @fastify/view з глобальним layout завжди обгортає в layout.ejs і не дає його
// вимкнути per-render, тож фрагменти рендеримо напряму через ejs.renderFile.
const VIEWS_DIR = path.join(__dirname, "..", "views");
function renderFragment(name, data) {
  return ejs.renderFile(path.join(VIEWS_DIR, name), data, { async: false });
}
const { OilsRepo } = require("../../integrations/truckmarket/repositories/oils-repo");
const { ListingPublishService } = require("../../integrations/truckmarket/services/listing-publish-service");
const { PhotoUploadService } = require("../../integrations/truckmarket/services/photo-upload-service");
const { TruckMarketHandler } = require("../../integrations/truckmarket/handlers/truckmarket-handler");
const { DescriptionService } = require("../../integrations/openai/description-service");
const { DescriptionGenerator } = require("../../integrations/openai/description-generator");
const { OpenAIClient } = require("../../integrations/openai/openai-client");
const { PromptsRepo } = require("../../integrations/openai/prompts-repo");

// ---- список з фільтрами ----
async function listOils(db, { company, type, status, search, integration, limit = 100, offset = 0 } = {}) {
  const where = [];
  const values = [];
  if (company) { values.push(parseInt(company, 10)); where.push(`o.company_id = $${values.length}`); }
  if (type)    { values.push(type);                    where.push(`o.name_type_oil = $${values.length}`); }
  if (integration) { values.push(parseInt(integration, 10)); where.push(`o.integration_id = $${values.length}`); }
  if (search)  {
    values.push(`%${search}%`);
    where.push(`(o.name ILIKE $${values.length} OR o.articul ILIKE $${values.length})`);
  }
  if (status) {
    if (status === "pending") where.push(`(o.truck_status IS NULL OR o.truck_status = 'pending')`);
    else { values.push(status); where.push(`o.truck_status = $${values.length}`); }
  }
  values.push(limit, offset);
  const r = await db.query(`
    SELECT o.id, o.name_type_oil, o.name, o.articul, o.packaging_volume,
           o.brand, o.city,
           o.truck_listing_id, o.truck_status, o.truck_error, o.truck_at,
           c.name_company AS company_name,
           ig.name AS integration_name,
           (SELECT p.price FROM oils_price p
              WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price,
           (SELECT count(*) FROM oils_images i WHERE i.oils_id = o.id) AS img_total,
           (SELECT count(*) FROM oils_images i
              WHERE i.oils_id = o.id AND i.processed_status = 'done') AS img_done
      FROM olivs o
      JOIN company_olivs c ON c.id = o.company_id
 LEFT JOIN integrations ig ON ig.id = o.integration_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
  ORDER BY o.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);
  return r.rows;
}

async function countOils(db, { company, type, status, search, integration } = {}) {
  const where = [];
  const values = [];
  if (company) { values.push(parseInt(company, 10)); where.push(`company_id = $${values.length}`); }
  if (type)    { values.push(type);                    where.push(`name_type_oil = $${values.length}`); }
  if (integration) { values.push(parseInt(integration, 10)); where.push(`integration_id = $${values.length}`); }
  if (search)  {
    values.push(`%${search}%`);
    where.push(`(name ILIKE $${values.length} OR articul ILIKE $${values.length})`);
  }
  if (status) {
    if (status === "pending") where.push(`(truck_status IS NULL OR truck_status = 'pending')`);
    else { values.push(status); where.push(`truck_status = $${values.length}`); }
  }
  const r = await db.query(
    `SELECT count(*) AS c FROM olivs ${where.length ? "WHERE " + where.join(" AND ") : ""}`,
    values,
  );
  return Number(r.rows[0].c);
}

async function fetchFacets(db) {
  const r = await db.query(`
    SELECT id, name_company FROM company_olivs ORDER BY name_company
  `);
  const t = await db.query(`
    SELECT DISTINCT name_type_oil FROM olivs ORDER BY name_type_oil
  `);
  const ig = await db.query(`
    SELECT id, name FROM integrations ORDER BY name
  `);
  return { companies: r.rows, types: t.rows.map(x => x.name_type_oil), integrations: ig.rows };
}

async function statusCounts(db) {
  const r = await db.query(`
    SELECT
      count(*) FILTER (WHERE truck_status IS NULL OR truck_status = 'pending') AS pending,
      count(*) FILTER (WHERE truck_status = 'in_progress') AS in_progress,
      count(*) FILTER (WHERE truck_status = 'done')        AS done,
      count(*) FILTER (WHERE truck_status = 'outdated')    AS outdated,
      count(*) FILTER (WHERE truck_status = 'failed')      AS failed,
      count(*) AS total
    FROM olivs
  `);
  return r.rows[0];
}

// ---- single oil publish handler (shared з оркестратором) ----
async function buildSingleOilHandler(db) {
  const repo = new OilsRepo(db);
  const promptsRepo = new PromptsRepo(db);
  const api = new TruckMarketClient();
  const publishService = new ListingPublishService({ api, repo });
  const photoService   = new PhotoUploadService({ api, repo });

  let descService = null;
  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAIClient();
    const generator = new DescriptionGenerator({
      client,
      promptResolver: async () => {
        const p = await promptsRepo.findDefault();
        return p ? p.body : null;
      },
    });
    descService = new DescriptionService({ generator, repo });
  }

  const handler = new TruckMarketHandler({
    publishService, photoService, descriptionService: descService, oilsRepo: repo,
  });
  return { handler, repo, api };
}

// ---- fetch повний row для одного olivs (як у SELECT_PENDING) ----
async function fetchOilRow(db, oilsId) {
  const r = await db.query(`
    SELECT o.id, o.name_type_oil, o.name, o.type_oil, o.viscosity_sae,
           o.low_level_saps, o.packaging_volume, o.articul, o.acea, o.api,
           o.manufacturers_tolerances, o.car_brand, o.quantity,
           o.iso_vg_viscosity_grade, o.color_liquid, o.dot,
           o.ai_description, o.brand, o.city,
           o.truck_listing_id, o.truck_status,
           c.name_company AS company_name, c.city AS company_city,
           (SELECT p.price FROM oils_price p
              WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price
      FROM olivs o
      JOIN company_olivs c ON c.id = o.company_id
     WHERE o.id = $1`, [oilsId]);
  return r.rows[0] || null;
}

// Один рядок у shape списку (listOils) — для HTMX-фрагмента після save/cancel.
async function fetchListRow(db, oilsId) {
  const r = await db.query(`
    SELECT o.id, o.name_type_oil, o.name, o.articul, o.packaging_volume,
           o.brand, o.city,
           o.truck_listing_id, o.truck_status, o.truck_error, o.truck_at,
           c.name_company AS company_name,
           ig.name AS integration_name,
           (SELECT p.price FROM oils_price p
              WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price,
           (SELECT count(*) FROM oils_images i WHERE i.oils_id = o.id) AS img_total,
           (SELECT count(*) FROM oils_images i
              WHERE i.oils_id = o.id AND i.processed_status = 'done') AS img_done
      FROM olivs o
      JOIN company_olivs c ON c.id = o.company_id
 LEFT JOIN integrations ig ON ig.id = o.integration_id
     WHERE o.id = $1`, [oilsId]);
  return r.rows[0] || null;
}

// Повний рядок для форми редагування (усі редаговані поля + поточна ціна).
async function fetchEditRow(db, oilsId) {
  const r = await db.query(`
    SELECT o.id, o.name_type_oil, o.name, o.brand, o.city, o.packaging_volume,
           o.quantity, o.viscosity_sae, o.acea, o.api, o.manufacturers_tolerances,
           o.dot, o.iso_vg_viscosity_grade, o.color_liquid,
           (SELECT p.price FROM oils_price p
              WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price
      FROM olivs o WHERE o.id = $1`, [oilsId]);
  return r.rows[0] || null;
}

const TABLE_COLS = 13; // к-сть колонок таблиці олив (для colspan рядка-редактора)

// Оновлює активну ціну з історією + позначає 'outdated' для опублікованих.
// Повертає true, якщо ціна реально змінилась.
async function applyPriceChange(db, oilsId, newPrice) {
  const cur = await db.query(
    `SELECT price FROM oils_price WHERE oils_id = $1 AND valid_to IS NULL LIMIT 1`,
    [oilsId],
  );
  const prev = cur.rows.length ? cur.rows[0].price : null;
  if (prev === newPrice) return false;
  await db.query(
    `UPDATE oils_price SET valid_to = NOW() WHERE oils_id = $1 AND valid_to IS NULL`,
    [oilsId],
  );
  await db.query(
    `INSERT INTO oils_price (oils_id, price, valid_from, valid_to) VALUES ($1, $2, NOW(), NULL)`,
    [oilsId, newPrice],
  );
  // Якщо опублікована на TM (done + listing_id) — стає outdated.
  await db.query(
    `UPDATE olivs SET truck_status = 'outdated', truck_at = NOW()
      WHERE id = $1 AND truck_status = 'done' AND truck_listing_id IS NOT NULL`,
    [oilsId],
  );
  return true;
}

async function oilsRoutes(fastify, { db, runner }) {

  // Відповідь після запуску фонової задачі:
  //  - HTMX-запит → лишаємось на сторінці, показуємо toast (без редіректу на /jobs);
  //  - звичайна форма → редірект назад із ?flash=... (теж toast, не сторінка задачі).
  function respondJob(req, reply, jobId, message) {
    if (req.headers["hx-request"]) {
      reply.header("HX-Trigger", JSON.stringify({ toast: { message, type: "info" } }));
      return reply.code(204).send();
    }
    const back = req.headers.referer || "/oils";
    const sep = back.includes("?") ? "&" : "?";
    return reply.redirect(`${back}${sep}flash=${encodeURIComponent(message)}&flash_type=info`);
  }

  // === Список з фільтрами ===
  fastify.get("/oils", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const company = req.query.company || "";
    const type    = req.query.type    || "";
    const status  = req.query.status  || "";
    const integration = req.query.integration || "";
    const search  = (req.query.search || "").trim();
    const page    = Math.max(1, parseInt(req.query.page || "1", 10));
    const perPage = 50;

    const [oils, total, facets, counts] = await Promise.all([
      listOils(db, { company, type, status, search, integration, limit: perPage, offset: (page - 1) * perPage }),
      countOils(db, { company, type, status, search, integration }),
      fetchFacets(db),
      statusCounts(db),
    ]);

    return reply.view("oils.ejs", {
      title: "Усі оливи",
      user: req.user,
      active: "oils",
      oils, total, page, perPage,
      facets, counts,
      filters: { company, type, status, search, integration },
    });
  });

  // === Видалити одне оголошення з TM ===
  fastify.post("/oils/:id/unpublish", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const r = await db.query(
      `SELECT id, truck_listing_id FROM olivs WHERE id = $1`,
      [id],
    );
    const oil = r.rows[0];
    if (!oil) return reply.code(404).send("Не знайдено");
    if (!oil.truck_listing_id) return reply.code(400).send("Оголошення не опубліковане");

    const jobId = await runner.run({
      kind: "tm-delete",
      params: { oils_id: id, listing_id: Number(oil.truck_listing_id) },
      userId: req.user.id,
      fn: async (ctx) => {
        const { repo, api } = await buildSingleOilHandler(db);
        ctx.log(`DELETE /listings/${oil.truck_listing_id} (olivs.id=${id})`);
        try {
          const res = await api.deleteListing(Number(oil.truck_listing_id));
          ctx.log(`TM reply: ${JSON.stringify(res)}`);
        } catch (e) {
          ctx.log(`TM error: ${e.message} — все одно скидаю прив'язку у БД`);
        }
        await repo.clearListingId(id);
        await db.query(
          `UPDATE oils_images SET uploaded_at = NULL, upload_error = NULL
            WHERE oils_id = $1`,
          [id],
        );
        ctx.log("✓ Готово: listing видалений, БД скинута, фото готові до повторної заливки");
      },
    });
    return respondJob(req, reply, jobId, "Задача на видалення з TruckMarket запущена");
  });

  // === Опублікувати одне оливо ===
  fastify.post("/oils/:id/publish", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await fetchOilRow(db, id);
    if (!row) return reply.code(404).send("Не знайдено");

    const jobId = await runner.run({
      kind: "tm-publish-one",
      params: { oils_id: id, name: row.name },
      userId: req.user.id,
      fn: async (ctx) => {
        ctx.log(`Публікація olivs.id=${id} (${row.name})`);
        const { handler } = await buildSingleOilHandler(db);
        const result = await handler.handle(row);
        ctx.log(`\nResult: ${JSON.stringify(result, null, 2)}`);
        if (result.status !== "created") throw new Error(result.reason || "publish failed");
      },
    });
    return respondJob(req, reply, jobId, "Задача на публікацію запущена");
  });

  // === Оновити одне оголошення на TM (для статусу 'outdated' — ціна змінилась) ===
  fastify.post("/oils/:id/sync-tm", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await fetchOilRow(db, id);
    if (!row) return reply.code(404).send("Не знайдено");
    if (!row.truck_listing_id) return reply.code(400).send("Оголошення не опубліковане");

    const jobId = await runner.run({
      kind: "tm-update-one",
      params: { oils_id: id, name: row.name, listing_id: Number(row.truck_listing_id) },
      userId: req.user.id,
      fn: async (ctx) => {
        ctx.log(`Оновлення listing #${row.truck_listing_id} (olivs.id=${id}, ${row.name})`);
        const { handler } = await buildSingleOilHandler(db);
        const result = await handler.handleUpdate(row);
        ctx.log(`\nResult: ${JSON.stringify(result, null, 2)}`);
        if (result.status !== "updated") throw new Error(result.reason || "update failed");
      },
    });
    return respondJob(req, reply, jobId, "Задача на оновлення TM запущена");
  });

  // === Оновити ВСІ outdated одним прогоном ===
  fastify.post("/oils/sync-outdated", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const jobId = await runner.run({
      kind: "tm-update-outdated",
      params: {},
      userId: req.user.id,
      fn: async (ctx) => {
        const { handler, repo } = await buildSingleOilHandler(db);
        const eligible = await db.query(
          `SELECT DISTINCT name_type_oil FROM olivs WHERE truck_status = 'outdated'`,
        );
        const types = eligible.rows.map((r) => r.name_type_oil);
        if (!types.length) { ctx.log("Немає олив у статусі 'outdated'."); return; }
        const rows = await repo.findOutdated(1000, types);
        ctx.log(`Знайдено ${rows.length} outdated. Оновлюю на TruckMarket…`);
        let ok = 0, fail = 0;
        for (const row of rows) {
          const result = await handler.handleUpdate(row);
          if (result.status === "updated") { ok++; ctx.log(`  ✓ #${result.listingId} ${row.articul}`); }
          else { fail++; ctx.log(`  ✗ ${row.articul}: ${result.reason}`); }
        }
        ctx.log(`\nГотово: оновлено ${ok}, помилок ${fail}`);
        if (fail) throw new Error(`${fail} оновлень з помилкою`);
      },
    });
    return respondJob(req, reply, jobId, "Задача на оновлення всіх застарілих запущена");
  });

  // === HTMX: рядок-редактор ===
  fastify.get("/oils/:id/edit-row", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const o = await fetchEditRow(db, id);
    if (!o) return reply.code(404).send("Не знайдено");
    const t = await db.query(`SELECT DISTINCT name_type_oil FROM olivs ORDER BY name_type_oil`);
    const html = await renderFragment("_oil-edit-row.ejs", {
      o, types: t.rows.map((x) => x.name_type_oil), TABLE_COLS,
    });
    return reply.type("text/html").send(html);
  });

  // === HTMX: звичайний рядок (скасування / після збереження) ===
  fastify.get("/oils/:id/row", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const o = await fetchListRow(db, parseInt(req.params.id, 10));
    if (!o) return reply.code(404).send("Не знайдено");
    return reply.type("text/html").send(await renderFragment("_oil-row.ejs", { o }));
  });

  // === HTMX: зберегти редаговані поля оливи ===
  fastify.patch("/oils/:id", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const exists = await db.query(`SELECT id FROM olivs WHERE id = $1`, [id]);
    if (!exists.rows.length) return reply.code(404).send("Не знайдено");

    const str = (v) => { const s = (v == null ? "" : String(v)).trim(); return s === "" ? null : s; };
    const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };

    const name = str(b.name);
    if (!name) return reply.code(400).send("Назва обов'язкова");

    await db.query(
      `UPDATE olivs SET
         name = $2, brand = $3, city = $4, name_type_oil = $5,
         packaging_volume = COALESCE($6, packaging_volume),
         quantity = $7, viscosity_sae = $8, acea = $9, api = $10,
         manufacturers_tolerances = $11, dot = $12,
         iso_vg_viscosity_grade = $13, color_liquid = $14
       WHERE id = $1`,
      [
        id, name, str(b.brand), str(b.city), str(b.name_type_oil) || "моторне оливо",
        num(b.packaging_volume),
        b.quantity != null && String(b.quantity).trim() !== "" ? Math.round(num(b.quantity)) : null,
        str(b.viscosity_sae), str(b.acea), str(b.api),
        str(b.manufacturers_tolerances), str(b.dot),
        str(b.iso_vg_viscosity_grade), str(b.color_liquid),
      ],
    );
    const priceNum = b.price != null && String(b.price).trim() !== "" ? Math.round(num(b.price)) : null;
    if (priceNum != null) await applyPriceChange(db, id, priceNum);

    const o = await fetchListRow(db, id);
    return reply.type("text/html").send(await renderFragment("_oil-row.ejs", { o }));
  });

  // === HTMX: швидка зміна ціни з рядка ===
  fastify.post("/oils/:id/price", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const raw = (req.body || {}).price;
    const exists = await db.query(`SELECT id FROM olivs WHERE id = $1`, [id]);
    if (!exists.rows.length) return reply.code(404).send("Не знайдено");
    if (raw != null && String(raw).trim() !== "") {
      const n = Math.round(parseFloat(String(raw).replace(",", ".")));
      if (Number.isFinite(n) && n >= 0) await applyPriceChange(db, id, n);
    }
    const o = await fetchListRow(db, id);
    return reply.type("text/html").send(await renderFragment("_oil-row.ejs", { o }));
  });

  // === HTMX: видалити оливу з БД ===
  fastify.delete("/oils/:id", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    // Якщо опублікована на TM — спершу зняти оголошення, потім видаляти.
    const r = await db.query(`SELECT truck_listing_id FROM olivs WHERE id = $1`, [id]);
    if (!r.rows.length) return reply.code(404).send("Не знайдено");
    const listingId = r.rows[0].truck_listing_id;
    if (listingId) {
      try {
        const { api } = await buildSingleOilHandler(db);
        await api.deleteListing(Number(listingId));
      } catch (_) { /* TM-помилку ігноруємо — все одно чистимо БД */ }
    }
    await db.query(`DELETE FROM oils_images WHERE oils_id = $1`, [id]);
    await db.query(`DELETE FROM oils_price WHERE oils_id = $1`, [id]);
    await db.query(`DELETE FROM olivs WHERE id = $1`, [id]);
    // Порожня відповідь + hx-swap outerHTML видалить рядок із таблиці.
    return reply.header("HX-Trigger", "oilDeleted").send("");
  });
}

module.exports = oilsRoutes;
