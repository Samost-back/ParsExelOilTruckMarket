// Composition root: тут єдине місце, де ми створюємо конкретні класи
// і з'єднуємо їх. Якщо змінити маркетплейс або вимкнути OpenAI — правимо тут.
//
// Запуск:
//   node src/integration/run.js               # всі pending з OpenAI
//   node src/integration/run.js 10            # перші 10 з OpenAI
//   node src/integration/run.js 10 --no-ai    # перші 10 без OpenAI-описів

require("dotenv").config();
const { withDb } = require("./infra/db");
const { log } = require("./infra/logger");
const { TruckMarketClient } = require("./client");
const { OilsRepo } = require("./repositories/oils-repo");
const { ListingPublishService } = require("./services/listing-publish-service");
const { PhotoUploadService } = require("./services/photo-upload-service");
const { DescriptionService } = require("./services/description-service");
const { TruckMarketHandler } = require("./handlers/truckmarket-handler");
const { buildDefaultRegistry } = require("./handlers/handler-registry");
const { Orchestrator } = require("./orchestrator");
const { OpenAIClient } = require("./openai/openai-client");
const { DescriptionGenerator } = require("./openai/description-generator");

function parseArgs() {
  const args = process.argv.slice(2);
  const noAi = args.includes("--no-ai");
  const limitArg = args.find((a) => /^\d+$/.test(a));
  return { limit: limitArg ? parseInt(limitArg, 10) : 1000, noAi };
}

function buildDescriptionService(repo, { noAi }) {
  if (noAi) {
    log.warn("AI-описи вимкнено (--no-ai)");
    return null;
  }
  if (!process.env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY не заданий — AI-описи вимкнено");
    return null;
  }
  const client = new OpenAIClient();
  const generator = new DescriptionGenerator({ client });
  return new DescriptionService({ generator, repo });
}

(async () => {
  const { limit, noAi } = parseArgs();
  await withDb(async (db) => {
    log.ok("DB connected");

    const api = new TruckMarketClient();
    const repo = new OilsRepo(db);

    const publishService = new ListingPublishService({ api, repo });
    const photoService   = new PhotoUploadService({ api, repo });
    const descService    = buildDescriptionService(repo, { noAi });

    const truckHandler = new TruckMarketHandler({
      publishService,
      photoService,
      descriptionService: descService,
    });
    const registry = buildDefaultRegistry({ truckMarketHandler: truckHandler });

    const orchestrator = new Orchestrator({ repo, registry });
    await orchestrator.run({ limit });
  });
  log.raw("\n✓ Готово");
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
