// CLI поверх CleanupService — заміна старого ad-hoc скрипта.
// Запуск:
//   node src/integration/delete-listings.js              # видалити ВСІ опубліковані
//   node src/integration/delete-listings.js 5445 5446    # видалити конкретні listing_id

require("dotenv").config();
const { withDb } = require("./infra/db");
const { log } = require("./infra/logger");
const { TruckMarketClient } = require("./client");
const { OilsRepo } = require("./repositories/oils-repo");
const { CleanupService } = require("./services/cleanup-service");

(async () => {
  const explicitIds = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);

  await withDb(async (db) => {
    const repo = new OilsRepo(db);
    const api = new TruckMarketClient();
    const cleanup = new CleanupService({ api, repo });

    let result;
    if (explicitIds.length) {
      log.info(`Видалення конкретних listing'ів: [${explicitIds.join(", ")}]`);
      const rows = await repo.findAllPublished();
      const toReset = rows.filter((r) => explicitIds.includes(Number(r.truck_listing_id)));
      result = await cleanup.deleteByListingIds(explicitIds);
      for (const r of toReset) await repo.clearListingId(r.id);
      const photosReset = await repo.resetPhotosUpload(toReset.map((r) => r.id));
      result.oilsReset = toReset.length;
      result.photosReset = photosReset;
    } else {
      log.info("Видалення ВСІХ опублікованих listing'ів");
      result = await cleanup.deleteAllPublished();
    }

    log.table([
      { stat: "deleted on TM",       value: result.deleted },
      { stat: "failed deletes",      value: result.failed.length },
      { stat: "olivs.truck_listing_id reset", value: result.oilsReset },
      { stat: "oils_images.uploaded_at reset", value: result.photosReset },
    ]);
    if (result.failed.length) {
      for (const f of result.failed) log.err(`${f.listingId}: ${f.error}`);
    }
  });
  log.raw("✓ Готово");
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
