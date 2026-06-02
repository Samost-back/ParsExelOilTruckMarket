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

async function listIntegrations(db) {
  const r = await db.query(
    `SELECT id, code, name FROM integrations ORDER BY name`,
  );
  return r.rows;
}

async function importRoutes(fastify, { db, runner }) {
  // === GET — форма + таблиця компаній ===
  fastify.get("/import", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const [companies, integrations] = await Promise.all([
      listCompanies(db),
      listIntegrations(db),
    ]);
    return reply.view("import.ejs", {
      title: "Імпорт даних",
      user: req.user,
      active: "import",
      companies,
      integrations,
    });
  });

  // === POST — upload + parse + import фото в одній задачі ===
  fastify.post("/import", { preHandler: fastify.requireAuth }, async (req, reply) => {
    const parts = req.parts();
    let company = "", country = "", integration = "", city = "";
    let xlsxPath = null;
    let photosDir = null;
    let photosCount = 0;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const batchTag = `import_${Date.now()}`;

    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "company") company = (part.value || "").trim();
        else if (part.fieldname === "country") country = (part.value || "").trim();
        else if (part.fieldname === "integration") integration = (part.value || "").trim();
        else if (part.fieldname === "city") city = (part.value || "").trim();
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

    // Інтеграція — валідуємо проти БД (єдине джерело правди). Дефолт = EUROLUB.
    const knownIntegrations = await listIntegrations(db);
    const integrationCode = integration || "EUROLUB";
    if (!knownIntegrations.some((i) => i.code === integrationCode)) {
      return reply.code(400).send(`Невідома інтеграція: ${integrationCode}`);
    }

    // company — завжди обов'язкова (прив'язка олив/локації).
    // xlsx — обов'язковий ЛИШЕ якщо не передано папку фото. Тобто дозволяємо
    // "донести тільки фото" до вже наявних олив (матч за артикулом у БД).
    if (!company) {
      return reply.code(400).send("Потрібна назва компанії");
    }
    if (!xlsxPath && !photosDir) {
      return reply.code(400).send("Потрібен xlsx або папка з фото");
    }
    // Режим "тільки фото": компанія має вже існувати (інакше нема до чого матчити).
    if (!xlsxPath && photosDir) {
      const existing = await db.query(
        `SELECT id FROM company_olivs WHERE name_company = $1`,
        [company],
      );
      if (existing.rows.length === 0) {
        return reply.code(400).send(
          `Режим "тільки фото": компанія "${company}" не знайдена. ` +
          `Спершу заімпортуйте її прайс (xlsx), потім доносьте фото.`,
        );
      }
    }

    const hasXlsx = !!xlsxPath;
    const mode = hasXlsx ? (photosDir ? "xlsx+photos" : "xlsx") : "photos-only";

    const jobId = await runner.run({
      kind: "import",
      params: {
        company, country, city, integration: integrationCode,
        mode,
        xlsx: hasXlsx ? path.basename(xlsxPath) : null,
        photosDir: photosDir ? path.basename(photosDir) : null,
        photosCount,
      },
      userId: req.user.id,
      fn: async (ctx) => {
        // === Покрокові статуси + зведення (контроль для користувача) ===
        // Кроки залежать від режиму: parse / company-meta — лише коли є xlsx;
        // import-photos / process-photos — лише коли є папка фото.
        const steps = [];
        if (hasXlsx) steps.push("parse", "company-meta");
        if (photosDir) steps.push("import-photos", "process-photos");

        // summary — стан кожного кроку + diff-числа. Оновлюємо інкрементально,
        // щоб користувач бачив прогрес у реальному часі (через SSE 'summary').
        const summary = {
          mode,
          company,
          integration: integrationCode,
          steps: steps.map((name) => ({ name, status: "pending" })),
          diff: null,       // @@DIFF@@ з парсера (оливи/ціни)
          photoLink: null,  // @@PHOTOLINK@@ з імпорту фото
          photoProcess: null, // @@PHOTODIFF@@ з обробки фото
        };
        await ctx.setSummary(summary);

        const setStep = async (name, status, extra) => {
          const s = summary.steps.find((x) => x.name === name);
          if (s) { s.status = status; if (extra) Object.assign(s, extra); }
          await ctx.setSummary(summary);
        };
        // Дістати маркер потрібного типу з результату spawnTask.
        const pick = (res, tag) =>
          (res && res.markers || []).find((m) => m.tag === tag)?.data || null;

        const total = steps.length;
        let stepNo = 0;

        ctx.log(`Company:     ${company}`);
        ctx.log(`Integration: ${integrationCode}`);
        ctx.log(`Режим:       ${mode}`);
        if (city) ctx.log(`City:        ${city}`);
        if (country) ctx.log(`Country:     ${country}`);
        if (hasXlsx) ctx.log(`Excel:       ${path.basename(xlsxPath)}`);
        if (photosDir) ctx.log(`Photos:      ${path.basename(photosDir)} (${photosCount} файлів)`);

        // === Парсинг прайсу (тільки якщо є xlsx) ===
        // Повторний імпорт тієї ж компанії = оновлення: ON CONFLICT(company,articul)
        // оновлює наявні оливи, нові артикули додаються, ціни ведуться історією.
        // Маршрутизація за інтеграцією: різні стандарти прайсу — різні парсери,
        // але всі пишуть у ту саму БД через спільний save-oils.
        if (hasXlsx) {
          ctx.log(`\n=== ${++stepNo}/${total} Парсинг прайсу (diff: нові/ціни) ===`);
          await setStep("parse", "running");
          let res;
          if (integrationCode === "ManagerIntegration") {
            res = await spawnTask(ctx, "src/parser/manager/index.js", [company, xlsxPath]);
          } else {
            res = await spawnTask(ctx, "src/parser/index.js", [company, xlsxPath, `--integration=${integrationCode}`]);
          }
          summary.diff = pick(res, "DIFF");
          await setStep("parse", "done", { diff: summary.diff });

          // === Мета-поля компанії ===
          ctx.log(`\n=== ${++stepNo}/${total} Збереження метаданих компанії ===`);
          await setStep("company-meta", "running");
          const sets = ["xlsx_path = $2", "xlsx_at = NOW()"];
          const values = [company, xlsxPath];
          if (country) { sets.push(`country = $${values.length + 1}`); values.push(country); }
          if (city) { sets.push(`city = $${values.length + 1}`); values.push(city); }
          if (photosDir) {
            sets.push(`photos_dir = $${values.length + 1}`); values.push(photosDir);
            sets.push("photos_at = NOW()");
          }
          const r = await db.query(
            `UPDATE company_olivs SET ${sets.join(", ")} WHERE name_company = $1 RETURNING id`,
            values,
          );
          ctx.log(`Updated company_olivs: ${r.rowCount} row(s)`);
          await setStep("company-meta", "done");
        } else {
          // Режим "тільки фото" — оновлюємо лише мета про фото-папку.
          if (photosDir) {
            await db.query(
              `UPDATE company_olivs SET photos_dir = $2, photos_at = NOW() WHERE name_company = $1`,
              [company, photosDir],
            );
          }
        }

        // === Імпорт фото + обробка (тільки якщо є папка) ===
        //   Manager — структура <Бренд>/<Тип>/<артикул><об'єм>, матч за артикулом+об'ємом;
        //   решта (EUROLUB) — ім'я файлу = артикул. Обидва матчать проти БД,
        //   тож працюють і в режимі "тільки фото" (без свіжого xlsx).
        if (photosDir) {
          ctx.log(`\n=== ${++stepNo}/${total} Імпорт фото (матч за артикулом у БД) ===`);
          await setStep("import-photos", "running");
          let linkRes;
          if (integrationCode === "ManagerIntegration") {
            linkRes = await spawnTask(ctx, "src/photos/import-manager/index.js", [photosDir]);
          } else {
            linkRes = await spawnTask(ctx, "src/photos/import/index.js", [photosDir]);
          }
          summary.photoLink = pick(linkRes, "PHOTOLINK");
          await setStep("import-photos", "done", { photoLink: summary.photoLink });

          // Обробка фото — ІНКРЕМЕНТАЛЬНА: process без --reprocess бере лише
          // НОВІ/невдалі (processed_status IS NULL/pending/failed). Тобто
          // переобробляються тільки щойно додані фото.
          ctx.log(`\n=== ${++stepNo}/${total} Обробка фото (інкрементально, лише нові) ===`);
          await setStep("process-photos", "running");
          const procRes = await spawnTask(ctx, "src/photos/process/index.js", []);
          summary.photoProcess = pick(procRes, "PHOTODIFF");
          await setStep("process-photos", "done", { photoProcess: summary.photoProcess });
        } else {
          ctx.log("\n(папка фото не передана — кроки фото пропущено)");
        }

        await ctx.setSummary(summary);
      },
    });

    return reply.redirect(`/jobs/${jobId}`);
  });
}
module.exports = importRoutes;
