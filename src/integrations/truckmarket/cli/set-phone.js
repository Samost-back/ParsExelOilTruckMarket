// CLI: змінити номер телефону в оголошеннях TruckMarket.
//
// Ім'я поля телефону в TM API заздалегідь невідоме, тож скрипт двофазний:
//
//   1) ІНСПЕКЦІЯ (знайти поле телефону на реальному оголошенні):
//        node src/integrations/truckmarket/cli/set-phone.js --inspect [<listingId>]
//      Без listingId бере перше опубліковане з БД. Друкує всі поля, де
//      трапляється номер, і повний дамп data — щоб побачити ім'я поля.
//
//   2) ОНОВЛЕННЯ (поставити номер УСІМ опублікованим оливам):
//        # dry-run (нічого не пише) — номер і поле за дефолтом/автодетектом:
//        node .../set-phone.js
//        # реально застосувати на всіх:
//        node .../set-phone.js --apply
//      Дефолтний номер: +380675530846 (override: --phone=+380...).
//      Поле телефону визначається автоматично з першого оголошення; за потреби
//      перевизначити: --field=<імʼя_поля>. <listingId...> — обмежити конкретними.

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

const INSPECT = has("--inspect");
const APPLY = has("--apply");
const PHONE = val("phone") || DEFAULT_PHONE;
const FIELD = val("field"); // якщо не задано — визначимо автоматично (autoDetectField)

// Рекурсивно шукає в обʼєкті значення, схожі на телефон, і повертає шляхи.
function findPhonePaths(obj, prefix = "") {
  const out = [];
  const isPhone = (v) =>
    typeof v === "string" && /[\d()+\- ]{9,}/.test(v) && (v.match(/\d/g) || []).length >= 9;
  const walk = (o, p) => {
    if (o == null) return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    if (typeof o === "object") { for (const k of Object.keys(o)) walk(o[k], p ? `${p}.${k}` : k); return; }
    if (isPhone(o)) out.push(`${p} = ${o}`);
  };
  walk(obj, prefix);
  return out;
}

// Авто-визначення top-level поля з телефоном за даними оголошення.
// Беремо перший знайдений шлях і його корінь (напр. "phone" з "phone" або
// "contact.phone" → "contact"). Повертає рядок або null.
function detectPhoneField(data) {
  const paths = findPhonePaths(data);
  if (!paths.length) return null;
  // "field = value" → беремо ліву частину до крапки/дужки
  const lhs = paths[0].split(" = ")[0];
  const root = lhs.split(/[.[]/)[0];
  return root || null;
}

(async () => {
  const api = new TruckMarketClient();

  await withDb(async (db) => {
    const repo = new OilsRepo(db);

    // === ІНСПЕКЦІЯ ===
    if (INSPECT) {
      let listingId = ids[0];
      if (!listingId) {
        const rows = await repo.findAllPublished();
        if (!rows.length) { log.error("Немає опублікованих оголошень у БД."); process.exit(1); }
        listingId = Number(rows[0].truck_listing_id);
        log.info(`listingId не вказано — беру перше опубліковане: ${listingId}`);
      }
      log.info(`Читаю /listings/data/${listingId} ...`);
      const res = await api.getListingData(listingId);
      const data = res && (res.data || res);
      console.log("\n=== Поля, схожі на телефон ===");
      const paths = findPhonePaths(data);
      if (paths.length) paths.forEach((p) => console.log("  " + p));
      else console.log("  (нічого не знайдено — дивись повний дамп нижче)");
      console.log("\n=== Повний data (для пошуку поля телефону) ===");
      console.log(JSON.stringify(data, null, 2));
      console.log("\nДалі: node ... set-phone.js --phone=+380675530846 --field=<імʼя_поля> [--apply]");
      return;
    }

    // === ОНОВЛЕННЯ (по ВСІХ опублікованих оливах) ===
    let rows = await repo.findAllPublished();
    if (ids.length) rows = rows.filter((r) => ids.includes(Number(r.truck_listing_id)));
    if (!rows.length) { log.error("Немає оголошень для оновлення."); process.exit(1); }

    // Поле телефону: явне --field, або авто-визначення з першого оголошення.
    let field = FIELD;
    if (!field) {
      const sampleId = Number(rows[0].truck_listing_id);
      log.info(`--field не задано — визначаю поле телефону з оголошення ${sampleId} ...`);
      try {
        const res = await api.getListingData(sampleId);
        field = detectPhoneField(res && (res.data || res));
      } catch (e) {
        log.error(`Не вдалося прочитати оголошення для автодетекту: ${e.message}`);
      }
      if (!field) {
        log.error("Не вдалося визначити поле телефону автоматично. " +
          "Запустіть з --inspect і вкажіть --field=<імʼя поля>.");
        process.exit(1);
      }
      log.info(`Авто-визначене поле телефону: "${field}"`);
    }

    log.info(`${APPLY ? "ЗАСТОСУВАННЯ" : "DRY-RUN"}: поле "${field}" = "${PHONE}" для ${rows.length} оголошень`);
    if (!APPLY) log.info("(dry-run — нічого не пишемо; додайте --apply щоб застосувати)");

    let ok = 0, failed = 0;
    for (const r of rows) {
      const lid = Number(r.truck_listing_id);
      const tag = `listing=${lid} (${r.articul} — ${r.name})`;
      if (!APPLY) { console.log(`  • ${tag}`); ok++; continue; }
      try {
        await api.updateListing(lid, { [field]: PHONE });
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
