// Парсер прайсу «Manager» — формат аркуша Daf у Мастила.xlsx.
// Відрізняється від EUROLUB: колонкові заголовки, бренд в окремій колонці,
// секції-роздільники типів олив, кілька варіантів об'єму на товар, дробові ціни.
//
// Чиста функція parseManagerSheet(rows) → масив oils — без БД, тестується окремо.

const xlsx = require("xlsx");

// Секції-роздільники: рядок, де лише перша колонка заповнена назвою типу.
// Мапимо текст секції на name_type_oil (узгоджено зі словником типів проєкту).
const SECTION_TYPE_MAP = [
  { re: /моторн/i, type: "моторне оливо" },
  { re: /трансміс|трансмис/i, type: "трансмісійне оливо" },
  { re: /гідравл|гидравл/i, type: "гідравлічне оливо" },
  { re: /редуктор/i, type: "редукторне оливо" },
  { re: /компресор/i, type: "компресорне оливо" },
];

function mapSection(text) {
  const t = String(text || "").trim();
  for (const { re, type } of SECTION_TYPE_MAP) if (re.test(t)) return type;
  return t.toLowerCase(); // невідома секція — зберігаємо як є
}

// «Група» → type_oil (синтетичне/напівсинтетичне/мінеральне).
function mapTypeOil(group) {
  const g = String(group || "").toLowerCase();
  if (/напівсинт|напивсинт|polusynt|semi/i.test(g)) return "напівсинтетичне";
  if (/синтет/i.test(g)) return "синтетичне";
  if (/мінерал|минерал/i.test(g)) return "мінеральне";
  return null;
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// SAE-в'язкість із назви: 10w30 / 5W-40 / 75W-90.
function extractSAE(name) {
  if (!name) return null;
  const m = String(name).match(/(\d{1,2}w[\s-]?\d{2,3})|(\d{1,3}w\b)/i);
  return m ? m[0].toUpperCase().replace(/\s/g, "").replace(/W(?=\d)/, "W-") : null;
}

// Знаходить індекси колонок за ключовими словами заголовка (рядок 0).
function resolveColumns(headerRow) {
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s|\n/g, "");
  const H = (headerRow || []).map(norm);
  const find = (kw) => H.findIndex((h) => kw.some((k) => h.includes(k)));
  // Колонку «Застосування» свідомо НЕ читаємо — вона ігнорується для Manager.
  return {
    name: find(["заголовок", "найменування", "назва"]),
    brand: find(["бренд"]),
    group: find(["група"]),
    spec: find(["специфікац", "сумісн"]),
    packaging: find(["упаков"]),
    articul: find(["артикул"]),
    price: find(["ціна", "цена"]),
  };
}

// Рядок-секція: тільки колонка name заповнена, інші порожні, і це назва типу.
function isSectionRow(row, COL) {
  const name = row[COL.name];
  if (name == null || String(name).trim() === "") return false;
  const rest = row.filter((c, i) => i !== COL.name && c != null && String(c).trim() !== "");
  if (rest.length > 0) return false;
  return /оливи|олива|мастил/i.test(String(name));
}

// Детермінований синтетичний артикул для товарів без артикулу (DAF не має).
// Стабільний між імпортами → ON CONFLICT оновлює, а не дублює.
function syntheticArticul(brand, name, volume) {
  const base = `${brand || ""}|${name || ""}|${volume}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return `GEN-${h.toString(36).toUpperCase()}`;
}

// Збирає специфікації блоку → manufacturers_tolerances / acea / api.
function finalizeSpecs(specLines) {
  const acea = [];
  const api = [];
  const manuf = [];
  for (const raw of specLines) {
    const line = String(raw).replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/^acea\b/i.test(line)) acea.push(line.replace(/^acea\s*/i, "").trim());
    else if (/^ap[іi]\b/i.test(line)) api.push(line.replace(/^ap[іi]\s*[-–]?\s*/i, "").trim());
    else manuf.push(line);
  }
  return {
    acea: acea.length ? acea.join(", ") : null,
    api: api.length ? api.join(", ") : null,
    manufacturers_tolerances: manuf.length ? manuf.join("; ") : null,
  };
}

// Основний парсер: rows = sheet_to_json(header:1). Повертає { oils, blocks, skipped }.
function parseManagerSheet(rows) {
  if (!rows || rows.length < 2) return { oils: [], blocks: 0, skipped: [] };
  const COL = resolveColumns(rows[0]);
  if (COL.name < 0 || COL.packaging < 0 || COL.price < 0) {
    throw new Error("Manager-парсер: не знайдено колонки (name/упаковка/ціна)");
  }

  const oils = [];
  const skipped = [];
  let blocks = 0;

  let currentSection = null; // name_type_oil
  let lastBrand = null; // бренд тягнеться вниз, поки не зустрінемо новий
  let block = null; // поточний товар: { name, brand, type_oil, description, specLines, variants[] }

  const pushBlock = () => {
    if (!block) return;
    blocks++;
    const specs = finalizeSpecs(block.specLines);
    const sae = extractSAE(block.name);
    for (const v of block.variants) {
      const volume = v.packaging_volume;
      if (volume == null || v.price == null) {
        skipped.push({ name: block.name, reason: "no volume/price", variant: v });
        continue;
      }
      const articul =
        v.articul != null && String(v.articul).trim() !== ""
          ? String(v.articul).replace(/\s/g, "")
          : syntheticArticul(block.brand, block.name, volume);
      oils.push({
        name_type_oil: currentSection || "моторне оливо",
        name: buildName(block, volume, sae),
        articul,
        packaging_volume: volume,
        description: block.description || "",
        type_oil: block.type_oil,
        low_level_saps: null,
        manufacturers_tolerances: specs.manufacturers_tolerances,
        acea: specs.acea,
        api: specs.api,
        color_liquid: null,
        iso_vg_viscosity_grade: null,
        standart_g: null,
        dot: null,
        viscosity_sae: sae,
        quantity: 1000,
        car_brand: null,
        brand: block.brand,
        city: null,
        price: v.price != null ? Math.round(v.price) : null,
      });
    }
    block = null;
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isSectionRow(row, COL)) {
      pushBlock();
      currentSection = mapSection(row[COL.name]);
      continue;
    }

    const nameCell = row[COL.name];
    const nameStr = nameCell == null ? "" : String(nameCell).trim();
    const brandCell = COL.brand >= 0 ? row[COL.brand] : null;
    const volume = toNumber(row[COL.packaging]);
    const articul = COL.articul >= 0 ? row[COL.articul] : null;
    const price = toNumber(row[COL.price]);
    const specCell = COL.spec >= 0 ? row[COL.spec] : null;

    if (brandCell != null && String(brandCell).trim() !== "") {
      lastBrand = String(brandCell).trim();
    }

    // Новий товар: рядок має назву (заголовок товару).
    if (nameStr) {
      pushBlock();
      block = {
        name: nameStr,
        brand: lastBrand,
        type_oil: COL.group >= 0 ? mapTypeOil(row[COL.group]) : null,
        // «Застосування» ігноруємо — опис лишаємо порожнім (його згенерує AI).
        description: "",
        specLines: [],
        variants: [],
      };
      if (specCell != null) block.specLines.push(String(specCell));
      if (volume != null || price != null || (articul != null && String(articul).trim() !== "")) {
        block.variants.push({ packaging_volume: volume, articul, price });
      }
      continue;
    }

    // Рядок-продовження товару (без назви).
    if (block) {
      if (specCell != null) block.specLines.push(String(specCell));
      // Додатковий варіант об'єму (інший пакет/ціна/артикул).
      if (volume != null || price != null || (articul != null && String(articul).trim() !== "")) {
        block.variants.push({ packaging_volume: volume, articul, price });
      }
    }
  }
  pushBlock();
  return { oils, blocks, skipped };
}

// Назва товару для відображення: "<Назва> | <volume> л". SAE вже в назві файлу.
function buildName(block, volume, sae) {
  let base = String(block.name).replace(/\s+/g, " ").trim();
  return `${base} | ${volume} л`;
}

// Зчитування файлу → масив рядків аркуша.
// Пріоритет вибору аркуша:
//   1) точна назва sheetName (за замовч. "Daf"), без урахування регістру/пробілів;
//   2) якщо такого немає — ПЕРША сторінка книги.
// Так імпорт працює і коли аркуш названо інакше (Daf/DAF/Лист1/тощо).
function readManagerSheet(filePath, sheetName = "Daf") {
  const wb = xlsx.readFile(filePath, { cellDates: false });
  const names = wb.SheetNames || [];
  if (names.length === 0) {
    throw new Error(`У файлі немає жодного аркуша: ${filePath}`);
  }
  const norm = (s) => String(s || "").trim().toLowerCase();
  // 1) шукаємо за назвою (регістронезалежно), 2) інакше — перша сторінка.
  let chosen = names.find((n) => norm(n) === norm(sheetName));
  if (!chosen) {
    chosen = names[0];
    console.log(
      `ℹ Аркуш "${sheetName}" не знайдено (є: ${names.join(", ")}) — ` +
        `беру першу сторінку "${chosen}"`,
    );
  } else {
    console.log(`✓ Аркуш: "${chosen}"`);
  }
  const ws = wb.Sheets[chosen];
  return xlsx.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
}

module.exports = {
  parseManagerSheet,
  readManagerSheet,
  extractSAE,
  mapSection,
  mapTypeOil,
  syntheticArticul,
};
