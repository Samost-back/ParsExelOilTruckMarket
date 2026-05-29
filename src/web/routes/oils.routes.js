const { TruckMarketClient } = require("../../integrations/truckmarket/client");
const { OilsRepo } = require("../../integrations/truckmarket/repositories/oils-repo");
const { ListingPublishService } = require("../../integrations/truckmarket/services/listing-publish-service");
const { PhotoUploadService } = require("../../integrations/truckmarket/services/photo-upload-service");
const { TruckMarketHandler } = require("../../integrations/truckmarket/handlers/truckmarket-handler");
const { DescriptionService } = require("../../integrations/openai/description-service");
const { DescriptionGenerator } = require("../../integrations/openai/description-generator");
const { OpenAIClient } = require("../../integrations/openai/openai-client");
const { PromptsRepo } = require("../../integrations/openai/prompts-repo");

// ---- список з фільтрами ----
async function listOils(db, { company, type, status, search, limit = 100, offset = 0 } = {}) {
  const where = [];
  const values = [];
  if (company) { values.push(parseInt(company, 10)); where.push(`o.company_id = $${values.length}`); }
  if (type)    { values.push(type);                    where.push(`o.name_type_oil = $${values.length}`); }
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
           o.truck_listing_id, o.truck_status, o.truck_error, o.truck_at,
           c.name_company AS company_name,
           (SELECT p.price FROM oils_price p
              WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price,
           (SELECT count(*) FROM oils_images i WHERE i.oils_id = o.id) AS img_total,
           (SELECT count(*) FROM oils_images i
              WHERE i.oils_id = o.id AND i.processed_status = 'done') AS img_done
      FROM olivs o
      JOIN company_olivs c ON c.id = o.company_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
  ORDER BY o.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);
  return r.rows;
}

async function countOils(db, { company, type, status, search } = {}) {
  const where = [];
  const values = [];
  if (company) { values.push(parseInt(company, 10)); where.push(`company_id = $${values.length}`); }
  if (type)    { values.push(type);                    where.push(`name_type_oil = $${values.length}`); }
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
  return { companies: r.rows, types: t.rows.map(x => x.name_type_oil) };
}

async function statusCounts(db) {
  const r = await db.query(`
    SELECT
      count(*) FILTER (WHERE truck_status IS NULL OR truck_status = 'pending') AS pending,
      count(*) FILTER (WHERE truck_status = 'in_progress') AS in_progress,
      count(*) FILTER (WHERE truck_status = 'done')        AS done,
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
           o.ai_description,
           c.name_company AS company_name,
           (SELECT p.price FROM oils_price p
              WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price
      FROM olivs o
      JOIN company_olivs c ON c.id = o.company_id
     WHERE o.id = $1`, [oilsId]);
  return r.rows[0] || null;
}

async function oilsRoutes(fastify, { db, runner }) {

  // === Список з фільтрами ===
  fastify.get("/oils", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const company = req.query.company || "";
    const type    = req.query.type    || "";
    const status  = req.query.status  || "";
    const search  = (req.query.search || "").trim();
    const page    = Math.max(1, parseInt(req.query.page || "1", 10));
    const perPage = 50;

    const [oils, total, facets, counts] = await Promise.all([
      listOils(db, { company, type, status, search, limit: perPage, offset: (page - 1) * perPage }),
      countOils(db, { company, type, status, search }),
      fetchFacets(db),
      statusCounts(db),
    ]);

    return reply.view("oils.ejs", {
      title: "Усі оливи",
      user: req.user,
      active: "oils",
      oils, total, page, perPage,
      facets, counts,
      filters: { company, type, status, search },
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
    return reply.redirect(`/jobs/${jobId}`);
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
    return reply.redirect(`/jobs/${jobId}`);
  });
}

module.exports = oilsRoutes;
