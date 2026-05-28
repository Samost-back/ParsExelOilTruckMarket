const fs = require("fs");
const path = require("path");
const { spawnTask } = require("../tasks/spawn-task");

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

async function uploadRoutes(fastify, { db, runner }) {
  fastify.post("/upload", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const parts = req.parts();
    let company = "", country = "";
    let xlsxPath = null, zipPath = null;
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "company") company = (part.value || "").trim();
        else if (part.fieldname === "country") country = (part.value || "").trim();
      } else if (part.file) {
        const tag = Date.now();
        const safeName = `${tag}_${part.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const filePath = path.join(UPLOAD_DIR, safeName);
        await new Promise((res, rej) => {
          const ws = fs.createWriteStream(filePath);
          part.file.pipe(ws);
          ws.on("finish", res); ws.on("error", rej);
        });
        if (part.fieldname === "xlsx") xlsxPath = filePath;
        else if (part.fieldname === "photos") zipPath = filePath;
      }
    }

    if (!company || !xlsxPath) {
      return reply.code(400).send("Потрібні: company + xlsx");
    }

    const jobId = await runner.run({
      kind: "upload",
      params: { company, country, xlsx: path.basename(xlsxPath), photos: zipPath ? path.basename(zipPath) : null },
      userId: req.user.id,
      fn: async (ctx) => {
        ctx.log(`Company: ${company}`);
        if (country) ctx.log(`Country: ${country}`);
        ctx.log(`Excel:   ${path.basename(xlsxPath)}`);
        if (zipPath) ctx.log(`Photos:  ${path.basename(zipPath)}`);

        // 1) Парсинг
        ctx.log("\n=== 1/3 Парсинг прайсу ===");
        await spawnTask(ctx, "src/parser/index.js", [company, xlsxPath]);

        // 2) Установка country для компанії (якщо передали)
        if (country) {
          ctx.log("\n=== 2/3 Збереження країни для компанії ===");
          const r = await db.query(
            `UPDATE company_olivs SET country = $2 WHERE name_company = $1 RETURNING id`,
            [company, country],
          );
          ctx.log(`Updated ${r.rowCount} company row(s) (country=${country})`);
        }

        // 3) Імпорт фото
        if (zipPath) {
          ctx.log("\n=== 3/3 Імпорт фото ===");
          await spawnTask(ctx, "src/photos/import/index.js", [zipPath]);
        } else {
          ctx.log("\n(zip не передано, імпорт фото пропущено)");
        }
      },
    });

    return reply.redirect(`/jobs/${jobId}`);
  });
}
module.exports = uploadRoutes;
