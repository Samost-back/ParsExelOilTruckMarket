const fs = require("fs");
const path = require("path");
const { TruckMarketClient } = require("../../integrations/truckmarket/client");
const { spawnTask } = require("../tasks/spawn-task");

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

async function listCompanies(db) {
  const r = await db.query(`
    SELECT c.id, c.name_company, c.country, c.xlsx_path, c.xlsx_at,
           c.photos_dir, c.photos_at,
           (SELECT count(*) FROM olivs o WHERE o.company_id = c.id) AS oils_count,
           (SELECT count(*) FROM olivs o
              JOIN oils_images i ON i.oils_id = o.id
             WHERE o.company_id = c.id AND i.processed_status = 'done') AS processed_count,
           (SELECT count(*) FROM olivs o
             WHERE o.company_id = c.id AND o.truck_listing_id IS NOT NULL) AS published_count
      FROM company_olivs c
  ORDER BY c.id`);
  return r.rows;
}

async function listCompanyOils(db, companyId, { search, status } = {}) {
  const where = ["o.company_id = $1"];
  const values = [companyId];
  if (search) {
    where.push(`(o.name ILIKE $${values.length + 1} OR o.articul ILIKE $${values.length + 1})`);
    values.push(`%${search}%`);
  }
  if (status) {
    if (status === "pending") {
      where.push("(o.truck_status IS NULL OR o.truck_status = 'pending')");
    } else {
      where.push(`o.truck_status = $${values.length + 1}`);
      values.push(status);
    }
  }
  const r = await db.query(`
    SELECT o.id, o.name_type_oil, o.name, o.articul, o.packaging_volume,
           o.truck_listing_id, o.truck_status, o.truck_error, o.truck_at,
           (SELECT p.price FROM oils_price p
              WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price,
           (SELECT count(*) FROM oils_images i WHERE i.oils_id = o.id) AS img_total,
           (SELECT count(*) FROM oils_images i
              WHERE i.oils_id = o.id AND i.processed_status = 'done') AS img_done,
           (SELECT i.processed_path FROM oils_images i
              WHERE i.oils_id = o.id AND i.processed_status = 'done'
            ORDER BY i.sort_order, i.id LIMIT 1) AS thumb_path
      FROM olivs o
     WHERE ${where.join(" AND ")}
  ORDER BY o.name_type_oil, o.name
  `, values);
  return r.rows;
}

async function fetchTruckStatusCounts(db, companyId) {
  const r = await db.query(`
    SELECT
      count(*) FILTER (WHERE truck_status IS NULL OR truck_status = 'pending') AS pending,
      count(*) FILTER (WHERE truck_status = 'in_progress') AS in_progress,
      count(*) FILTER (WHERE truck_status = 'done')        AS done,
      count(*) FILTER (WHERE truck_status = 'failed')      AS failed,
      count(*) AS total
    FROM olivs WHERE company_id = $1`, [companyId]);
  return r.rows[0];
}

async function findCompany(db, id) {
  const r = await db.query(`SELECT * FROM company_olivs WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function findOilImages(db, oilsId) {
  const r = await db.query(`
    SELECT id, file_path, processed_path, processed_status, sort_order
      FROM oils_images
     WHERE oils_id = $1
  ORDER BY sort_order, id`, [oilsId]);
  return r.rows;
}

// Безпечне видалення файла (ігнорує помилки доступу).
function safeUnlink(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) { /* noop */ }
}

// Видаляє папку рекурсивно, ігноруючи помилки. Робиться тільки якщо
// шлях знаходиться всередині $UPLOAD_DIR або $PHOTOS_STORAGE — захист від
// випадкового RM поза цими каталогами (вони мапляться в volume).
function safeRmDir(p) {
  if (!p) return;
  const abs = path.resolve(p);
  const allowed = [
    path.resolve(process.cwd(), "uploads"),
    path.resolve(process.cwd(), "photos_storage"),
  ];
  if (!allowed.some((root) => abs.startsWith(root + path.sep) || abs === root)) {
    return;
  }
  try { fs.rmSync(abs, { recursive: true, force: true }); } catch (_) {}
}

async function companiesRoutes(fastify, { db, runner }) {
  // === Список компаній ===
  fastify.get("/companies", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const companies = await listCompanies(db);
    return reply.view("companies.ejs", {
      title: "Компанії",
      user: req.user,
      active: "companies",
      companies,
    });
  });

  // === Деталі компанії ===
  fastify.get("/companies/:id", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const company = await findCompany(db, id);
    if (!company) return reply.code(404).send("Не знайдено");
    const search = (req.query.search || "").trim();
    const status = (req.query.status || "").trim();
    const [oils, counts] = await Promise.all([
      listCompanyOils(db, id, { search, status }),
      fetchTruckStatusCounts(db, id),
    ]);
    return reply.view("company.ejs", {
      title: company.name_company,
      user: req.user,
      active: "companies",
      company,
      oils,
      counts,
      search,
      status,
    });
  });

  // === Перегляд фото оливо (модалка) ===
  fastify.get("/oils/:id/images", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const r = await db.query(
      `SELECT o.id, o.name, o.articul, c.name_company
         FROM olivs o JOIN company_olivs c ON c.id = o.company_id
        WHERE o.id = $1`, [id]);
    const oil = r.rows[0];
    if (!oil) return reply.code(404).send("Не знайдено");
    const images = await findOilImages(db, id);
    return reply.view("oil-images.ejs", {
      title: `${oil.name}`,
      user: req.user,
      active: "companies",
      oil,
      images,
    });
  });

  // === Сирий файл фото (оригінал чи processed) — стрім через сервер ===
  // imgId може бути числом або "first" (перший processed-фото оливо).
  fastify.get("/oils/:id/image/:imgId", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const oilsId = parseInt(req.params.id, 10);
    const imgIdRaw = req.params.imgId;
    const kind = req.query.kind === "original" ? "file_path" : "processed_path";

    let row;
    if (imgIdRaw === "first") {
      const r = await db.query(
        `SELECT file_path, processed_path FROM oils_images
          WHERE oils_id = $1 AND processed_status = 'done'
       ORDER BY sort_order, id LIMIT 1`,
        [oilsId],
      );
      row = r.rows[0];
      if (!row) {
        const r2 = await db.query(
          `SELECT file_path, processed_path FROM oils_images
            WHERE oils_id = $1 ORDER BY sort_order, id LIMIT 1`,
          [oilsId],
        );
        row = r2.rows[0];
      }
    } else {
      const imgId = parseInt(imgIdRaw, 10);
      const r = await db.query(
        `SELECT file_path, processed_path FROM oils_images WHERE id = $1 AND oils_id = $2`,
        [imgId, oilsId],
      );
      row = r.rows[0];
    }

    if (!row) return reply.code(404).send("Не знайдено");
    const filePath = kind === "file_path" ? row.file_path : (row.processed_path || row.file_path);
    if (!filePath || !fs.existsSync(filePath)) return reply.code(404).send("Файл відсутній");
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png"
              : ext === ".webp" ? "image/webp"
              : ext === ".tif" || ext === ".tiff" ? "image/tiff"
              : "image/jpeg";
    reply.header("Content-Type", mime);
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(fs.createReadStream(filePath));
  });

  // === Форма "Оновити ціни" ===
  fastify.get("/companies/:id/update-prices", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const company = await findCompany(db, id);
    if (!company) return reply.code(404).send("Не знайдено");
    return reply.view("update-prices.ejs", {
      title: `Оновити ціни — ${company.name_company}`,
      user: req.user,
      active: "companies",
      company,
    });
  });

  // === Обробка завантаженого Excel для оновлення цін ===
  fastify.post("/companies/:id/update-prices", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const company = await findCompany(db, id);
    if (!company) return reply.code(404).send("Не знайдено");

    const parts = req.parts();
    let xlsxPath = null;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const batchTag = `prices_${id}_${Date.now()}`;

    for await (const part of parts) {
      if (part.type === "field") continue;
      if (!part.file) continue;
      if (part.fieldname === "xlsx") {
        const safeName = `${batchTag}_${part.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        xlsxPath = path.join(UPLOAD_DIR, safeName);
        await new Promise((res, rej) => {
          const ws = fs.createWriteStream(xlsxPath);
          part.file.pipe(ws);
          ws.on("finish", res); ws.on("error", rej);
        });
      } else {
        part.file.resume();
      }
    }
    if (!xlsxPath) return reply.code(400).send("Потрібен файл xlsx");

    const jobId = await runner.run({
      kind: "update-prices",
      params: { company_id: id, company: company.name_company, xlsx: path.basename(xlsxPath) },
      userId: req.user.id,
      fn: async (ctx) => {
        ctx.log(`Оновлення цін для "${company.name_company}"`);
        ctx.log(`Excel: ${path.basename(xlsxPath)}\n`);

        // 1) Парсинг — оновить olivs + закриє старі oils_price + INSERT нові.
        // company по UNIQUE(name_company) знайдеться → нічого зайвого не створиться.
        ctx.log("=== 1/2 Парсинг прайсу (оновлення цін у БД) ===");
        await spawnTask(ctx, "src/parser/index.js", [company.name_company, xlsxPath]);

        // 2) Для опублікованих — оновлюємо ціну на TM.
        ctx.log("\n=== 2/2 Оновлення цін на TruckMarket ===");
        const r = await db.query(`
          SELECT o.id, o.articul, o.truck_listing_id,
                 (SELECT p.price FROM oils_price p
                    WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price
            FROM olivs o
           WHERE o.company_id = $1 AND o.truck_listing_id IS NOT NULL
        ORDER BY o.id`, [id]);

        ctx.log(`Опублікованих оливо: ${r.rowCount}`);

        if (r.rowCount === 0) {
          ctx.log("Нема що оновлювати на TM");
          return;
        }

        const api = new TruckMarketClient();
        let ok = 0, fail = 0, skip = 0;
        for (const row of r.rows) {
          if (row.price == null) {
            ctx.log(`  ⊘ olivs.id=${row.id} (#${row.truck_listing_id}) — ціна в БД відсутня, скіп`);
            skip++;
            continue;
          }
          try {
            const res = await api.updateListing(Number(row.truck_listing_id), {
              price: row.price,
              price_curr: 1,
            });
            if (res && res.success !== false) {
              ctx.log(`  ✓ #${row.truck_listing_id} articul=${row.articul} → ${row.price} ₴`);
              ok++;
            } else {
              ctx.log(`  ✗ #${row.truck_listing_id}: ${JSON.stringify(res)}`);
              fail++;
            }
          } catch (e) {
            ctx.log(`  ✗ #${row.truck_listing_id} articul=${row.articul}: ${e.message}`);
            fail++;
          }
        }
        ctx.log(`\nTM update: ok=${ok}, skip=${skip}, fail=${fail}`);
      },
    });
    return reply.redirect(`/jobs/${jobId}`);
  });

  // === Видалити компанію разом з усіма оливами ===
  fastify.post("/companies/:id/delete", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const company = await findCompany(db, id);
    if (!company) return reply.code(404).send("Не знайдено");

    // Збираємо все що треба видалити
    const listings = await db.query(
      `SELECT id, truck_listing_id FROM olivs
        WHERE company_id = $1 AND truck_listing_id IS NOT NULL`,
      [id],
    );
    const allOils = await db.query(
      `SELECT o.id FROM olivs o WHERE o.company_id = $1`,
      [id],
    );
    const allImages = await db.query(
      `SELECT i.file_path, i.processed_path FROM oils_images i
         JOIN olivs o ON o.id = i.oils_id
        WHERE o.company_id = $1`,
      [id],
    );

    const jobId = await runner.run({
      kind: "company-delete",
      params: {
        company_id: id,
        company: company.name_company,
        listings_count: listings.rowCount,
        oils_count: allOils.rowCount,
      },
      userId: req.user.id,
      fn: async (ctx) => {
        ctx.log(`Видалення компанії "${company.name_company}" (id=${id})`);
        ctx.log(`Listing'ів на TM: ${listings.rowCount}`);
        ctx.log(`Олив у БД: ${allOils.rowCount}`);
        ctx.log(`Фото-файлів: ${allImages.rowCount}\n`);

        // 1. Зняти всі listing'и з TruckMarket
        if (listings.rowCount > 0) {
          ctx.log("=== 1/4 Видалення з TruckMarket ===");
          const api = new TruckMarketClient();
          let ok = 0, fail = 0;
          for (const l of listings.rows) {
            try {
              await api.deleteListing(Number(l.truck_listing_id));
              ok++;
              if (ok % 10 === 0) ctx.log(`  видалено ${ok}/${listings.rowCount}…`);
            } catch (e) {
              fail++;
              ctx.log(`  ✗ listing ${l.truck_listing_id}: ${e.message}`);
            }
          }
          ctx.log(`TM: видалено ok=${ok}, помилок=${fail}`);
        } else {
          ctx.log("=== 1/4 Listing'ів на TM немає — пропуск ===");
        }

        // 2. Видалити файли фото з диска
        ctx.log("\n=== 2/4 Видалення файлів фото ===");
        let filesRemoved = 0;
        for (const im of allImages.rows) {
          safeUnlink(im.file_path);
          safeUnlink(im.processed_path);
          filesRemoved++;
        }
        // папку завантаженого батча і uploads/xlsx теж
        if (company.photos_dir) { safeRmDir(company.photos_dir); ctx.log(`  rm -rf ${company.photos_dir}`); }
        if (company.xlsx_path)  { safeUnlink(company.xlsx_path); ctx.log(`  rm ${company.xlsx_path}`); }
        ctx.log(`Файлів: ${filesRemoved}`);

        // 3. Видалити з БД (CASCADE сам прибере oils_images, oils_price)
        ctx.log("\n=== 3/4 Видалення з БД ===");
        await db.query("BEGIN");
        try {
          await db.query(`DELETE FROM oils_images WHERE oils_id IN (SELECT id FROM olivs WHERE company_id = $1)`, [id]);
          await db.query(`DELETE FROM oils_price  WHERE oils_id IN (SELECT id FROM olivs WHERE company_id = $1)`, [id]);
          await db.query(`DELETE FROM olivs       WHERE company_id = $1`, [id]);
          await db.query(`DELETE FROM company_olivs WHERE id = $1`, [id]);
          await db.query("COMMIT");
          ctx.log("DB: видалено каскадно");
        } catch (e) {
          await db.query("ROLLBACK");
          ctx.log(`✗ DB error: ${e.message}`);
          throw e;
        }

        ctx.log("\n=== 4/4 Готово ===");
        ctx.log(`Компанію "${company.name_company}" повністю видалено`);
      },
    });
    return reply.redirect(`/jobs/${jobId}`);
  });
}

module.exports = companiesRoutes;
