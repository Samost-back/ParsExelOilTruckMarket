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

// Чиста (без I/O) логіка резолву запиту імпорту: режим + назва компанії +
// валідація. Виокремлено, щоб покрити юніт-тестами без multipart/БД.
//
// Вхід:
//   fields = { mode, companyNew, companyExisting, company } — сирі поля форми
//   ctx    = { hasXlsx, hasPhotos, companyExists } — стан завантаження + чи є
//            компанія в БД (визначається ВИЩЕ за назвою, яку повертає ця ф-я
//            у два кроки: спершу resolveCompany, потім перевірка існування)
// Повертає { ok:true, company, importMode } або { ok:false, code, error }.
//
// Логіка збереження для add/update однакова (upsert) — режим лише задає, як
// обрано компанію, і застосовує відповідну валідацію.
function resolveCompany(fields) {
  let importMode = (fields.mode || "add").trim();
  let company;
  if (importMode === "update") {
    company = (fields.companyExisting || fields.company || "").trim();
  } else {
    importMode = "add";
    company = (fields.companyNew || fields.company || "").trim();
  }
  return { importMode, company };
}

function validateImport({ importMode, company, hasXlsx, hasPhotos, companyExists }) {
  if (!company) {
    return { ok: false, code: 400, error:
      importMode === "update" ? "Виберіть компанію зі списку" : "Потрібна назва нової компанії" };
  }
  if (!hasXlsx && !hasPhotos) {
    return { ok: false, code: 400, error: "Потрібен xlsx або папка з фото" };
  }
  if (importMode === "update" && !companyExists) {
    return { ok: false, code: 400, error:
      `Режим "Оновити": компанія "${company}" не знайдена. Скористайтесь режимом "Додати нову компанію".` };
  }
  // Донести лише фото (без xlsx) можна тільки до наявної компанії.
  if (!hasXlsx && hasPhotos && !companyExists) {
    return { ok: false, code: 400, error:
      `Донести лише фото можна до наявної компанії. "${company}" не знайдена — спершу заімпортуйте її прайс (xlsx).` };
  }
  return { ok: true };
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
    // mode = add | update. Логіка збереження однакова (upsert); mode лише задає,
    // як обрано компанію (нова текстом / наявна зі списку) і валідацію.
    let importMode = "add";
    let companyNew = "", companyExisting = "";
    let company = "", country = "", integration = "", city = "";
    let xlsxPath = null;
    let photosDir = null;
    let photosCount = 0;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const batchTag = `import_${Date.now()}`;

    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "mode") importMode = (part.value || "add").trim();
        else if (part.fieldname === "companyNew") companyNew = (part.value || "").trim();
        else if (part.fieldname === "companyExisting") companyExisting = (part.value || "").trim();
        else if (part.fieldname === "company") company = (part.value || "").trim(); // легасі/прямий API
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

    // Резолвимо назву компанії за режимом (чиста логіка — див. resolveCompany).
    const resolved = resolveCompany({ mode: importMode, companyNew, companyExisting, company });
    importMode = resolved.importMode;
    company = resolved.company;

    // Перевірка існування компанії в БД + її поточна інтеграція (для update).
    let companyExists = false;
    let companyIntegrationCode = null;
    if (company) {
      const companyRow = await db.query(
        `SELECT c.id, i.code AS integration_code
           FROM company_olivs c
           LEFT JOIN olivs o ON o.company_id = c.id
           LEFT JOIN integrations i ON i.id = o.integration_id
          WHERE c.name_company = $1
          LIMIT 1`,
        [company],
      );
      companyExists = companyRow.rows.length > 0;
      companyIntegrationCode = companyRow.rows[0]?.integration_code || null;
    }

    const valid = validateImport({
      importMode, company,
      hasXlsx: !!xlsxPath, hasPhotos: !!photosDir, companyExists,
    });
    if (!valid.ok) {
      return reply.code(valid.code).send(valid.error);
    }

    // Інтеграція — валідуємо проти БД (єдине джерело правди).
    //   add    → з форми (дефолт EUROLUB);
    //   update → з самої компанії (її олив у БД), бо поле на формі приховане.
    const knownIntegrations = await listIntegrations(db);
    const integrationCode = importMode === "update"
      ? (companyIntegrationCode || integration || "EUROLUB")
      : (integration || "EUROLUB");
    if (!knownIntegrations.some((i) => i.code === integrationCode)) {
      return reply.code(400).send(`Невідома інтеграція: ${integrationCode}`);
    }

    const hasXlsx = !!xlsxPath;
    const mode = hasXlsx ? (photosDir ? "xlsx+photos" : "xlsx") : "photos-only";

    const jobId = await runner.run({
      kind: "import",
      params: {
        company, country, city, integration: integrationCode,
        importMode,
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
          importMode,
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

        ctx.log(`Дія:         ${importMode === "update" ? "Оновити наявну" : "Додати нову"}`);
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
// Експорт чистої логіки для юніт-тестів.
module.exports.resolveCompany = resolveCompany;
module.exports.validateImport = validateImport;
