// Спільна логіка збереження розпарсених олив у БД — одна для всіх інтеграцій.
// Парсер кожного формату (EUROLUB, Manager, …) лише ДІСТАЄ масив `oils`,
// а як вони лягають у БД (upsert olivs, історія цін, прив'язка до інтеграції,
// позначення 'outdated' для опублікованих) — тут, в одному місці.
//
// `oils` — масив об'єктів з полями колонок olivs (як їх формує парсер):
//   name_type_oil, name, articul, packaging_volume, description, type_oil,
//   low_level_saps, manufacturers_tolerances, acea, api, color_liquid,
//   iso_vg_viscosity_grade, standart_g, dot, viscosity_sae, quantity,
//   car_brand (text[] | null), brand, city, price (number | null)
//
// brand/city проставляються згідно з правилами інтеграції (brand_source/
// city_source) ТУТ: коли джерело 'parser' і є фіксований default — береться
// він; інакше лишається значення з парсера (бренд із файлу) або null (web).

const { Client } = require("pg");

function dbConfig() {
  return {
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432", 10),
    database: process.env.PG_DB || "postgres",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "",
  };
}

async function saveOils({ company, integrationCode, oils, dryRun = false, blocksCount }) {
  const client = new Client(dbConfig());
  await client.connect();
  console.log("✓ Підключено до PostgreSQL");
  try {
    await client.query("BEGIN");

    // Інтеграція — джерело правди про brand_source / city_source.
    const integRes = await client.query(
      `SELECT id, code, brand_source, city_source, default_brand, default_city
         FROM public.integrations WHERE code = $1`,
      [integrationCode],
    );
    if (integRes.rows.length === 0) {
      throw new Error(
        `Інтеграція "${integrationCode}" не знайдена в таблиці integrations`,
      );
    }
    const integration = integRes.rows[0];
    console.log(
      `✓ Інтеграція ${integration.code} (id=${integration.id}): ` +
        `brand←${integration.brand_source}, city←${integration.city_source}`,
    );

    // Правила джерела. brand_source='parser' + є default_brand → фіксований
    // бренд (EUROLUB). brand_source='parser' без default → бренд із файлу
    // (Manager: колонка «Бренд»). 'web' → лишаємо що є / null.
    for (const oil of oils) {
      if (integration.brand_source === "parser" && integration.default_brand) {
        oil.brand = integration.default_brand;
      }
      if (integration.city_source === "parser") {
        oil.city = integration.default_city;
      }
    }

    const companyRes = await client.query(
      `INSERT INTO public.company_olivs (name_company)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [company],
    );
    let companyId;
    if (companyRes.rows.length > 0) {
      companyId = companyRes.rows[0].id;
      console.log(`✓ Створено компанію id=${companyId}`);
    } else {
      const existing = await client.query(
        `SELECT id FROM public.company_olivs WHERE name_company = $1`,
        [company],
      );
      companyId = existing.rows[0].id;
      console.log(`✓ Знайдено існуючу компанію id=${companyId}`);
    }

    let inserted = 0;
    let updated = 0;
    let pricesSet = 0;
    let priceUnchanged = 0; // ціна прийшла, але така сама як остання → нічого не міняли
    let outdated = 0; // опубліковані оливи, чию ціну змінили → треба оновити на TM
    const newExamples = [];
    const priceChanges = [];

    for (const oil of oils) {
      const oilRes = await client.query(
        `INSERT INTO public.olivs (
          company_id, name_type_oil, name, articul, packaging_volume, description,
          type_oil, low_level_saps, manufacturers_tolerances,
          acea, api, color_liquid, iso_vg_viscosity_grade,
          standart_g, dot, viscosity_sae, quantity, car_brand,
          integration_id, brand, city
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
        )
        ON CONFLICT (company_id, articul) DO UPDATE SET
          name_type_oil            = EXCLUDED.name_type_oil,
          name                     = EXCLUDED.name,
          packaging_volume         = EXCLUDED.packaging_volume,
          description              = EXCLUDED.description,
          type_oil                 = EXCLUDED.type_oil,
          low_level_saps           = EXCLUDED.low_level_saps,
          manufacturers_tolerances = EXCLUDED.manufacturers_tolerances,
          acea                     = EXCLUDED.acea,
          api                      = EXCLUDED.api,
          color_liquid             = EXCLUDED.color_liquid,
          iso_vg_viscosity_grade   = EXCLUDED.iso_vg_viscosity_grade,
          standart_g               = EXCLUDED.standart_g,
          dot                      = EXCLUDED.dot,
          viscosity_sae            = EXCLUDED.viscosity_sae,
          quantity                 = EXCLUDED.quantity,
          car_brand                = EXCLUDED.car_brand,
          integration_id           = EXCLUDED.integration_id,
          brand                    = EXCLUDED.brand,
          -- city з вебу заповнюється окремо; не затираємо наявне порожнім.
          city                     = COALESCE(EXCLUDED.city, public.olivs.city)
        RETURNING id, (xmax = 0) AS is_insert, truck_status, truck_listing_id`,
        [
          companyId,
          oil.name_type_oil,
          oil.name,
          oil.articul,
          oil.packaging_volume,
          oil.description,
          oil.type_oil,
          oil.low_level_saps,
          oil.manufacturers_tolerances,
          oil.acea,
          oil.api,
          oil.color_liquid,
          oil.iso_vg_viscosity_grade,
          oil.standart_g,
          oil.dot,
          oil.viscosity_sae,
          oil.quantity,
          oil.car_brand,
          integration.id,
          oil.brand,
          oil.city,
        ],
      );
      const oilId = oilRes.rows[0].id;
      const isInsert = oilRes.rows[0].is_insert;
      // Стан публікації на TM ДО цього оновлення — EXCLUDED не чіпав ці поля.
      const prevTruckStatus = oilRes.rows[0].truck_status;
      const prevListingId = oilRes.rows[0].truck_listing_id;
      const wasPublished = prevTruckStatus === "done" && prevListingId != null;
      if (isInsert) {
        inserted++;
        if (newExamples.length < 15) newExamples.push(`${oil.articul} — ${oil.name}`);
      } else updated++;

      if (oil.price != null) {
        await client.query(
          `UPDATE public.oils_price SET valid_to = NOW()
           WHERE oils_id = $1 AND valid_to IS NULL`,
          [oilId],
        );
        const lastPrice = await client.query(
          `SELECT price FROM public.oils_price
           WHERE oils_id = $1 ORDER BY valid_from DESC LIMIT 1`,
          [oilId],
        );
        const prevPrice =
          lastPrice.rows.length > 0 ? lastPrice.rows[0].price : null;
        if (prevPrice === null || prevPrice !== oil.price) {
          await client.query(
            `INSERT INTO public.oils_price (oils_id, price, valid_from, valid_to)
             VALUES ($1, $2, NOW(), NULL)`,
            [oilId, oil.price],
          );
          pricesSet++;
          if (!isInsert && prevPrice !== null && priceChanges.length < 15) {
            priceChanges.push(`${oil.articul}: ${prevPrice} → ${oil.price} ₴`);
          }
          // 'outdated' лише для вже опублікованих на TM (done + listing_id).
          if (wasPublished && prevPrice !== null && prevPrice !== oil.price) {
            await client.query(
              `UPDATE public.olivs
                  SET truck_status = 'outdated', truck_at = NOW()
                WHERE id = $1`,
              [oilId],
            );
            outdated++;
          }
        } else {
          priceUnchanged++;
          await client.query(
            `UPDATE public.oils_price SET valid_to = NULL
             WHERE oils_id = $1 AND valid_from = (
               SELECT valid_from FROM public.oils_price
               WHERE oils_id = $1 ORDER BY valid_from DESC LIMIT 1
             )`,
            [oilId],
          );
        }
      }
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      console.log("\n=== DRY-RUN (нічого не записано, транзакцію відкочено) ===");
    } else {
      await client.query("COMMIT");
    }
    if (blocksCount != null) console.log(`✓ Розпарсено продуктів: ${blocksCount}`);
    console.log(`✓ Оброблено olivs-записів: ${oils.length}`);
    console.log(`  → Нових: ${inserted}, оновлених: ${updated}`);
    console.log(`  → Зміни цін: ${pricesSet} (без змін: ${priceUnchanged})`);
    console.log(`  → Позначено 'outdated' (опубл. на TM, ціна змінилась): ${outdated}`);
    if (newExamples.length) {
      console.log(`\n  Нові товари (до ${newExamples.length}):`);
      for (const e of newExamples) console.log(`    + ${e}`);
    }
    if (priceChanges.length) {
      console.log(`\n  Зміни цін на наявних (до ${priceChanges.length}):`);
      for (const e of priceChanges) console.log(`    ~ ${e}`);
    }

    const result = {
      total: oils.length,
      inserted,
      updated,
      pricesSet,
      priceUnchanged,
      outdated,
      newExamples,
      priceChanges,
      dryRun,
    };
    // Машиночитаний маркер для батьківського процесу (web job парсить лог і
    // показує картку-зведення). Один рядок, префікс @@DIFF@@, далі JSON.
    if (!dryRun) console.log("@@DIFF@@ " + JSON.stringify(result));
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("✗ Помилка, транзакцію відкочено:", err.message);
    throw err;
  } finally {
    await client.end();
  }
}

module.exports = { saveOils };
