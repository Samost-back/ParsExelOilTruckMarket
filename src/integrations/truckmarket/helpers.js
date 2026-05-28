const {
  CAR_BRAND_OPTIONS,
  CAR_BRAND_NAME_NORMALIZATION,
  BRAND_OPTIONS,
} = require("./constants");

// Шукає ID бренду TruckMarket за назвою компанії.
// Case-insensitive, ігнорує зайві пробіли. Повертає id або null.
const BRAND_OPTIONS_LOWER = Object.fromEntries(
  Object.entries(BRAND_OPTIONS).map(([k, v]) => [k.toLowerCase().trim(), v]),
);

function findBrandId(companyName) {
  if (!companyName) return null;
  const key = String(companyName).toLowerCase().trim();
  return BRAND_OPTIONS_LOWER[key] || null;
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
