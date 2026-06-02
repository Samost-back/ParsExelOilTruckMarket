const {
  TRUCKMARKET_CATEGORY_FIELDS,
  TRUCKMARKET_FIELD_OPTIONS,
  TRUCKMARKET_IGNORED_FIELDS,
  TYPE_OIL_TO_TRUCKMARKET_CATEGORY,
} = require("../constants");
const { encode } = require("./field-encoders");

const PRICE_CURR_UAH = 1;

// Людський префікс типу для заголовка оголошення.
const TYPE_TITLE_PREFIX = {
  "моторне оливо": "Моторна олива",
  "трансмісійне оливо": "Трансмісійна олива",
  "гідравлічне оливо": "Гідравлічна олива",
  "редукторне оливо": "Редукторна олива",
  "компресорне оливо": "Компресорна олива",
  "індустріальне оливо": "Індустріальна олива",
  "мастило": "Мастило",
};

// Формує «нормальний» заголовок: «<Тип> <Бренд> <Назва> <SAE> | <об'єм> л».
// Чистить сиру назву від бренду/SAE/об'єму, щоб не дублювати.
function buildListingTitle(row) {
  const typePrefix = TYPE_TITLE_PREFIX[row.name_type_oil] || "";
  const brand = (row.brand || "").trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let core = String(row.name || "").trim();
  // Ідемпотентність: відрізаємо хвіст " | <об'єм> л/кг [...]" (може повторитись).
  core = core.replace(/\s*\|\s*[\d.,]+\s*(?:л|кг).*$/i, "").trim();
  // Прибираємо вже наявний префікс типу з початку (EUROLUB-назви його містять).
  if (typePrefix) core = core.replace(new RegExp(`^${esc(typePrefix)}\\s+`, "i"), "").trim();
  // Прибираємо бренд із початку (щоб не дублювати з нашим брендом).
  if (brand) core = core.replace(new RegExp(`^${esc(brand)}\\s+`, "i"), "").trim();
  // Прибираємо SAE з core (додамо окремо в кінець, нормалізовано).
  const sae = (row.viscosity_sae || "").trim();
  if (sae) core = core.replace(/\b\d{1,3}w[\s-]?\d{0,3}\b/gi, "").replace(/\s{2,}/g, " ").trim();
  // Прибираємо хвіст "синтетична/мінеральна/напівсинтетична" — він уже відбитий у "Тип оливи".
  core = core.replace(/\s*(напів)?синтетичн[ауеі]|\s*мінеральн[ауеі]/gi, "").replace(/\s{2,}/g, " ").trim();

  const volNum = row.packaging_volume != null ? Number(row.packaging_volume) : null;
  const unit = /мастил/i.test(String(row.name_type_oil || "")) ? "кг" : "л";
  const volStr = volNum != null ? `${volNum} ${unit}` : null;

  const head = [typePrefix, brand, core, sae].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  return volStr ? `${head} | ${volStr}` : head;
}

// SRP: формує тільки payload для /listings/create. Не знає про БД, фото,
// HTTP-клієнт. Залежить лише від констант мапінгу і енкодерів полів.
// `description` — опціональний (заповнюється OpenAI-сервісом ззовні).
function buildListingPayload(row, { description = "", geoCityId = null } = {}) {
  const catId = TYPE_OIL_TO_TRUCKMARKET_CATEGORY[row.name_type_oil];
  if (!catId) throw new Error(`Немає мапінгу name_type_oil="${row.name_type_oil}"`);

  const fieldsByName = TRUCKMARKET_CATEGORY_FIELDS[catId] || {};
  const optionsByField = TRUCKMARKET_FIELD_OPTIONS[catId] || {};
  const ignored = new Set(TRUCKMARKET_IGNORED_FIELDS[catId] || []);
  const warnings = [];
  const fPayload = {};

  for (const [fieldName, fieldCode] of Object.entries(fieldsByName)) {
    if (ignored.has(fieldName)) continue;
    const value = encode(fieldName, fieldCode, row, optionsByField, warnings);
    if (value !== null && value !== undefined) fPayload[fieldCode] = value;
  }

  const data = {
    cat_id: catId,
    user_id: parseInt(process.env.USER_ID, 10),
    company: parseInt(process.env.COMPANY_ID, 10),
    // geo_city: TM очікує числовий id міста. Резолвиться з міста КОМПАНІЇ через
    // geo/regions/list (передається сюди як geoCityId). Fallback — env-дефолт.
    geo_city: geoCityId != null ? geoCityId : parseInt(process.env.GEO_CITY_ID_DEFAULT, 10),
    title: { uk: buildListingTitle(row) },
    descr: { uk: description || "" },
    price: row.price,
    price_curr: PRICE_CURR_UAH,
    instock: row.quantity,
    ...fPayload,
  };
  return { data, warnings };
}

module.exports = { buildListingPayload, buildListingTitle };
