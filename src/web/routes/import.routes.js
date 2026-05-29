const fs = require("fs");
const path = require("path");
const { spawnTask } = require("../tasks/spawn-task");

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

function safeRelPath(filename) {
  const norm = String(filename).replace(/\\/g, "/").replace(/^\/+/, "");
  return norm.split("/").filter((p) => p && p !== "." && p !== "..").join("/");
}

async function listCompanies(db) {
  const r = await db.query(`
    SELECT id, name_company, country, xlsx_path, xlsx_at, photos_dir, photos_at
      FROM company_olivs
  ORDER BY GREATEST(COALESCE(xlsx_at, 'epoch'::timestamp),
                    COALESCE(photos_at, 'epoch'::timestamp)) DESC
     LIMIT 20`);
  return r.rows;
}

async function importRoutes(fastify, { db, runner }) {
  // === GET — форма + таблиця компаній ===
  fastify.get("/import", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const companies = await listCompanies(db);
    return reply.view("import.ejs", {
      title: "Імпорт даних",
      user: req.user,
      active: "import",
      companies,
    });
  });

  // === POST — upload + parse + import фото в одній задачі ===
  fastify.post("/import", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const parts = req.parts();
    let company = "", country = "";
    let xlsxPath = null;
    let photosDir = null;
    let photosCount = 0;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const batchTag = `import_${Date.now()}`;

    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "company") company = (part.value || "").trim();
        else if (part.fieldname === "country") country = (part.value || "").trim();
        continue;
      }
      if (!part.file) continue;

      if (part.fieldname === "xlsx") {
        const safeName = `${batchTag}_${part.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        xlsxPath = path.join(UPLOAD_DIR, safeName);
        await new Promise((res, rej) => {
          const ws = fs.createWriteStream(xlsxPath);
          part.file.pipe(ws);
          ws.on("finish", res); ws.on("error", rej);
        });
      } else if (part.fieldname === "photos") {
        if (!photosDir) {
          photosDir = path.join(UPLOAD_DIR, `${batchTag}_photos`);
          fs.mkdirSync(photosDir, { recursive: true });
        }
        const rel = safeRelPath(part.filename);
        if (!rel) { part.file.resume(); continue; }
        const dest = path.join(photosDir, rel);
        const resolved = path.resolve(dest);
        if (!resolved.startsWith(path.resolve(photosDir) + path.sep)) {
          part.file.resume(); continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await new Promise((res, rej) => {
          const ws = fs.createWriteStream(dest);
          part.file.pipe(ws);
          ws.on("finish", res); ws.on("error", rej);
        });
        photosCount++;
      } else {
        part.file.resume();
      }
    }

    if (!company || !xlsxPath) {
      return reply.code(400).send("Потрібні: company + xlsx");
    }

    const jobId = await runner.run({
      kind: "import",
      params: {
        company, country,
        xlsx: path.basename(xlsxPath),
        photosDir: photosDir ? path.basename(photosDir) : null,
        photosCount,
      },
      userId: req.user.id,
      fn: async (ctx) => {
        ctx.log(`Company: ${company}`);
        if (country) ctx.log(`Country: ${country}`);
        ctx.log(`Excel:   ${path.basename(xlsxPath)}`);
        if (photosDir) ctx.log(`Photos:  ${path.basename(photosDir)} (${photosCount} файлів)`);

        // 1) Парсинг — створить/оновить company_olivs якщо ще немає
        ctx.log("\n=== 1/4 Парсинг прайсу ===");
        await spawnTask(ctx, "src/parser/index.js", [company, xlsxPath]);

        // 2) Оновити мета-поля компанії
        ctx.log("\n=== 2/4 Збереження метаданих компанії ===");
        const sets = ["xlsx_path = $2", "xlsx_at = NOW()"];
        const values = [company, xlsxPath];
        if (country) { sets.push(`country = $${values.length + 1}`); values.push(country); }
        if (photosDir) {
          sets.push(`photos_dir = $${values.length + 1}`); values.push(photosDir);
          sets.push("photos_at = NOW()");
        }
        const r = await db.query(
          `UPDATE company_olivs SET ${sets.join(", ")} WHERE name_company = $1 RETURNING id`,
          values,
        );
        ctx.log(`Updated company_olivs: ${r.rowCount} row(s)`);

        // 3) Імпорт фото
        if (photosDir) {
          ctx.log("\n=== 3/4 Імпорт фото з папки ===");
          await spawnTask(ctx, "src/photos/import/index.js", [photosDir]);

          // 4) Обробка фото
          ctx.log("\n=== 4/4 Обробка фото (sharp + прапор) ===");
          await spawnTask(ctx, "src/photos/process/index.js", []);
        } else {
          ctx.log("\n(папка фото не передана, кроки 3-4 пропущено)");
        }
      },
    });

    return reply.redirect(`/jobs/${jobId}`);
  });
}
module.exports = importRoutes;
