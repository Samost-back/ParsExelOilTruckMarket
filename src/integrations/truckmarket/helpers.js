const {
  CAR_BRAND_OPTIONS,
  CAR_BRAND_NAME_NORMALIZATION,
  BRAND_OPTIONS,
} = require("./constants");

// Шукає ID бренду TruckMarket за назвою бренду/компанії.
// Case-insensitive, ігнорує зайві пробіли. Повертає id або null.
const BRAND_OPTIONS_LOWER = Object.fromEntries(
  Object.entries(BRAND_OPTIONS).map(([k, v]) => [k.toLowerCase().trim(), v]),
);

// Синоніми: як бренд називається в нашій БД → канонічний ключ у BRAND_OPTIONS.
// Бо в прайсах бренд пишуть коротше/інакше (Mobil, Total, EUROLUB), а у TM
// select — повні назви ("Mobil 1", "Total / TotalEnergies", "Eurolub").
const BRAND_SYNONYMS = {
  "mobil": "Mobil 1",
  "mobil 1": "Mobil 1",
  "total": "Total / TotalEnergies",
  "totalenergies": "Total / TotalEnergies",
  "total energies": "Total / TotalEnergies",
  "eurolub": "Eurolub",
  "aral": "Aral",
  "castrol": "Castrol",
  "delo": "Delo",
  "liqui moly": "Liqui Moly",
  "shell": "Shell Helix",
  "shell helix": "Shell Helix",
  "motul": "Motul",
  "ravenol": "Ravenol",
  "elf": "Elf",
  "bp": "BP",
  "xado": "XADO",
  "texaco": "Texaco",
  "fuchs": "Fuchs",
  "mannol": "Mannol",
};

function findBrandId(brandName) {
  if (!brandName) return null;
  const key = String(brandName).toLowerCase().trim();
  // 1) точний збіг із ключем BRAND_OPTIONS (case-insensitive)
  if (BRAND_OPTIONS_LOWER[key] != null) return BRAND_OPTIONS_LOWER[key];
  // 2) через синонім → канонічний ключ
  const canonical = BRAND_SYNONYMS[key];
  if (canonical && BRAND_OPTIONS[canonical] != null) return BRAND_OPTIONS[canonical];
  return null;
}

// Перетворює масив назв марок авто на бітову маску, яку очікує TruckMarket
// у полі "Марки авто". Незнайомі бренди ігноруються.
// Приклад: ["BMW", "Mercedes-Benz", "Volkswagen"] → 259
function carBrandsToBitmask(brands) {
  if (!Array.isArray(brands) || brands.length === 0) return 0;
  let mask = 0;
  for (const brand of brands) {
    const normalized = CAR_BRAND_NAME_NORMALIZATION[brand] || brand;
    const bit = CAR_BRAND_OPTIONS[normalized];
    if (bit) mask |= bit;
  }
  return mask;
}

module.exports = { carBrandsToBitmask, findBrandId };
