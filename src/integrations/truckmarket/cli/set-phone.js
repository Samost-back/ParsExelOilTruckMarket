// CLI: поставити номер телефону в оголошеннях TruckMarket.
//
// TM (Tamaranga) зберігає телефон у полі `phones` у форматі МАСИВУ ОБ'ЄКТІВ:
//   phones: [{ v: "+380675530846" }]
// Рядок замість масиву мовчки відкидається валідацією — тому поле зашите
// жорстко, без автодетекту (автодетект у порожніх оголошеннях матчив
// артикул/EAN в описі, і --apply міг перезаписати опис).
//
// Використання:
//   # dry-run (нічого не пише) по всіх опублікованих:
//   node src/integrations/truckmarket/cli/set-phone.js
//   # реально застосувати на всіх:
//   node .../set-phone.js --apply
//   # тільки конкретні оголошення:
//   node .../set-phone.js <listingId...> --apply
//   # інший номер (дефолт +380675530846):
//   node .../set-phone.js --phone=+380... --apply

require("dotenv").config();
const { withDb } = require("../../../shared/infra/db");
const { log } = require("../../../shared/infra/logger");
const { TruckMarketClient } = require("../client");
const { OilsRepo } = require("../repositories/oils-repo");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);

// Дефолтний номер — щоб не вводити щоразу. Перевизначається через --phone=.
const DEFAULT_PHONE = "+380675530846";

const APPLY = has("--apply");
const PHONE = val("phone") || DEFAULT_PHONE;

(async () => {
  const api = new TruckMarketClient();

  await withDb(async (db) => {
    const repo = new OilsRepo(db);

    let rows = await repo.findAllPublished();
    if (ids.length) rows = rows.filter((r) => ids.includes(Number(r.truck_listing_id)));
    if (!rows.length) { log.error("Немає оголошень для оновлення."); process.exit(1); }

    log.info(`${APPLY ? "ЗАСТОСУВАННЯ" : "DRY-RUN"}: phones = [{ v: "${PHONE}" }] для ${rows.length} оголошень`);
    if (!APPLY) log.info("(dry-run — нічого не пишемо; додайте --apply щоб застосувати)");

    let ok = 0, failed = 0;
    for (const r of rows) {
      const lid = Number(r.truck_listing_id);
      const tag = `listing=${lid} (${r.articul} — ${r.name})`;
      if (!APPLY) { console.log(`  • ${tag}`); ok++; continue; }
      try {
        await api.updateListing(lid, { phones: [{ v: PHONE }] });
        console.log(`  ✓ ${tag}`);
        ok++;
      } catch (e) {
        console.log(`  ✗ ${tag}: ${e.message}`);
        failed++;
      }
    }

    log.table([
      { stat: APPLY ? "оновлено" : "буде оновлено (dry-run)", value: ok },
      { stat: "помилок", value: failed },
    ]);
    if (!APPLY) log.info("Перевірте список, тоді повторіть з --apply.");
  });
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
