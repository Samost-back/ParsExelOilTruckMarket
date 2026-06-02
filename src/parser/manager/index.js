// CLI парсера «Manager» (формат Мастила.xlsx, аркуш Daf).
// Usage:
//   node src/parser/manager/index.js "<Company>" <file.xlsx> [--sheet=Daf] [--dry-run]
//
// Бренд береться з колонки «Бренд» кожного товару (не фіксований). Прив'язка до
// інтеграції ManagerIntegration. Збереження — спільний модуль save-oils.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { parseManagerSheet, readManagerSheet } = require("./parse");
const { saveOils } = require("../shared/save-oils");

const INTEGRATION_CODE = "ManagerIntegration";

const [, , companyArg, fileArg, ...restArgs] = process.argv;
if (!companyArg || !fileArg) {
  console.error(
    'Usage: node src/parser/manager/index.js "<Company>" <file.xlsx> [--sheet=Daf] [--dry-run]',
  );
  process.exit(1);
}
const sheet =
  (restArgs.find((a) => a.startsWith("--sheet=")) || "").split("=")[1] || "Daf";
const dryRun = restArgs.includes("--dry-run");

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

(async () => {
  const rows = readManagerSheet(filePath, sheet);
  const { oils, blocks, skipped } = parseManagerSheet(rows);
  console.log(`✓ Аркуш "${sheet}": продуктів ${blocks}, варіантів ${oils.length}`);
  if (skipped.length) console.log(`  Пропущено варіантів: ${skipped.length}`);
  await saveOils({
    company: companyArg,
    integrationCode: INTEGRATION_CODE,
    oils,
    dryRun,
    blocksCount: blocks,
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
