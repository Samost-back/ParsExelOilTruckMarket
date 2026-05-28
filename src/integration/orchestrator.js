// Оркестратор: координує fetching рядків і dispatch до хендлера.
// SRP: НЕ знає про конкретні маркетплейси і HTTP — лише про реєстр і репозиторій.
// Залежності — через конструктор. CLI entry-point — окремо у run.js.

const { log } = require("./infra/logger");
const { RunStats } = require("./reporting/run-stats");

class Orchestrator {
  constructor({ repo, registry, stats = new RunStats() }) {
    this.repo = repo;
    this.registry = registry;
    this.stats = stats;
  }

  async run({ limit }) {
    const eligibleTypes = this.registry.registeredTypes();
    log.ok(`Реєстр інтеграцій: [${eligibleTypes.join(", ")}]`);
    const rows = await this.repo.findPending(limit, eligibleTypes);
    log.ok(`Знайдено ${rows.length} pending записів (limit=${limit})\n`);

    for (const row of rows) await this._handleOne(row);

    this._printSummary();
    return this.stats;
  }

  async _handleOne(row) {
    const head = `[olivs.id=${row.id}, type="${row.name_type_oil}"]`;
    const decision = this.registry.pick(row.name_type_oil);

    if (decision.route === "blacklist") {
      log.skip(`${head} ${decision.reason}`);
      this.stats.addBlacklist(row); return;
    }
    if (decision.route === "no_integration") {
      log.skip(`${head} ${decision.reason}`);
      this.stats.addNoIntegration(row); return;
    }

    log.head(`${head} → ${decision.handler.label}`);
    log.raw(`   name="${row.name}"`);

    const result = await decision.handler.handle(row);

    if (result.warnings && result.warnings.length) {
      for (const w of result.warnings) log.raw(`   ⚠ ${w}`);
    }

    if (result.status === "created") {
      log.raw(`   ✓ truck_listing_id=${result.listingId}`);
      if (result.photos) {
        log.raw(`   📷 uploaded=${result.photos.uploaded}, failed=${result.photos.failed.length}`);
        for (const f of result.photos.failed) log.raw(`      ✗ ${f.file}: ${f.error}`);
      }
      this.stats.addCreated(row, result.listingId, result.photos);
    } else if (result.status === "mapping_error") {
      log.err(`   mapping_error: ${result.reason}`);
      this.stats.addMappingError(row, result.reason);
    } else {
      log.err(`   api_error: ${result.reason}`);
      this.stats.addApiError(row, result.reason);
    }
  }

  _printSummary() {
    log.raw("\n========== ПІДСУМОК ==========");
    log.table(this.stats.summaryTable());
    log.raw("\nРозклад по типах:");
    log.table(this.stats.byTypeTable());
    const errs = this.stats.errorList();
    if (errs.length) {
      log.raw("\nПомилки:");
      for (const e of errs) log.raw(`  - olivs.id=${e.id} (${e.type}): ${e.reason}`);
    }
  }
}

module.exports = { Orchestrator };
