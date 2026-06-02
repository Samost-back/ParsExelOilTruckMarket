const { carBrandsToBitmask, findBrandId } = require("../helpers");

// Декларативні енкодери полів. OCP: щоб додати новий тип поля —
// додаємо новий запис, без модифікації існуючих. Кожен encoder приймає row
// + контекст пошуку опції і повертає сирий value (або null = не надсилати).

const joinIfArray = (v) => (Array.isArray(v) ? v.join(", ") : v);

// Універсальний lookup в мапі опцій. Розрізняє три стани:
//   undefined → "не в опціях"
//   null      → "id з TM не підтверджено"
//   value     → готовий id для payload
function lookupOption(opts, raw, fieldName, fieldCode, warnings) {
  if (!opts) return raw; // free-text fallback
  const id = opts[raw];
  if (id === undefined) {
    warnings.push(`${fieldName} (${fieldCode}): "${raw}" не в опціях — пропущено`);
    return null;
  }
  if (id === null) {
    warnings.push(`${fieldName} (${fieldCode}): "${raw}" id з TruckMarket не підтверджено — пропущено`);
    return null;
  }
  return id;
}

// row → raw value extractor + select-lookup для кожного поля.
// Тут вся типізація логіки концентрується в одному об'єкті — не в switch.
const FIELD_ENCODERS = {
  "Тип оливи":              { kind: "select", read: (r) => r.type_oil },
  "В'язкість SAE":          { kind: "select", read: (r) => r.viscosity_sae },
  "Клас в'язкості ISO VG":  { kind: "select", read: (r) => r.iso_vg_viscosity_grade },
  "Низький рівень SAPS":    { kind: "select", read: (r) => (r.low_level_saps == null ? null : r.low_level_saps) },
  "Об'єм упаковки, л":      { kind: "select", read: (r) => (r.packaging_volume == null ? null : Number(r.packaging_volume)) },
  "Об'єм упаковки, кг":     { kind: "select", read: (r) => (r.packaging_volume == null ? null : Number(r.packaging_volume)) },
  "Артикул":                { kind: "text",   read: (r) => r.articul },
  "Допуски виробників":     { kind: "text",   read: (r) => r.manufacturers_tolerances },
  "ACEA":                   { kind: "text",   read: (r) => joinIfArray(r.acea) },
  "API":                    { kind: "text",   read: (r) => joinIfArray(r.api) },
  "Стандарт DOT":           { kind: "text",   read: (r) => r.dot },
  "Марки авто":             { kind: "bitmask", read: (r) => r.car_brand },
  // Бренд → джерело правди olivs.brand (його ставить інтеграція: для EUROLUB
  // це 'EUROLUB' з назви). Якщо порожній — fallback на company_olivs.name_company.
  // findBrandId() — case-insensitive.
  "Бренд":                  { kind: "brand",  read: (r) => r.brand || r.company_name },
};

function encode(fieldName, fieldCode, row, optionsByField, warnings) {
  const enc = FIELD_ENCODERS[fieldName];
  if (!enc) return null;
  const raw = enc.read(row);
  if (raw == null || raw === "") return null;

  switch (enc.kind) {
    case "text":
      return raw;
    case "select":
      return lookupOption(optionsByField[fieldCode], raw, fieldName, fieldCode, warnings);
    case "bitmask":
      if (!Array.isArray(raw) || raw.length === 0) return null;
      return carBrandsToBitmask(raw) || null;
    case "brand": {
      const id = findBrandId(raw);
      if (!id) {
        warnings.push(`${fieldName} (${fieldCode}): компанія "${raw}" не в TruckMarket-брендах — пропущено`);
        return null;
      }
      return id;
    }
    default:
      return null;
  }
}

module.exports = { encode };
