const {
  TRUCKMARKET_CATEGORY_FIELDS,
  TRUCKMARKET_FIELD_OPTIONS,
  TRUCKMARKET_IGNORED_FIELDS,
  TYPE_OIL_TO_TRUCKMARKET_CATEGORY,
} = require("../constants");
const { encode } = require("./field-encoders");

const PRICE_CURR_UAH = 1;

// SRP: формує тільки payload для /listings/create. Не знає про БД, фото,
// HTTP-клієнт. Залежить лише від констант мапінгу і енкодерів полів.
// `description` — опціональний (заповнюється OpenAI-сервісом ззовні).
function buildListingPayload(row, { description = "" } = {}) {
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
    geo_city: parseInt(process.env.GEO_CITY_ID_DEFAULT, 10),
    title: { uk: row.name },
    descr: { uk: description || "" },
    price: row.price,
    price_curr: PRICE_CURR_UAH,
    instock: row.quantity,
    ...fPayload,
  };
  return { data, warnings };
}

module.exports = { buildListingPayload };
