// Константи для інтеграції з TruckMarket API.
// Реальні значення (URL, токен, мапінг полів, ліміти) заповнюються після
// того, як буде доступна документація TruckMarket.

// Категорії "Технічні рідини та мастила" на TruckMarket.
// Ключ — назва категорії на сайті, значення — id (атрибут value у HTML фільтра).
const TRUCKMARKET_CATEGORY_IDS = {
  "Моторні оливи": 4263,
  "Трансмісійні оливи": 4264,
  "Гідравлічні оливи": 4265,
  "Редукторні оливи": 4348,
  "Компресорні масла": 4266,
  "Гальмівні рідини": 4267,
  "Рідини гідропідсилювача керма": 4268,
  "Охолоджуючі рідини": 4269,
};

// Категорії "Хімія та засоби обслуговування" на TruckMarket.
const TRUCKMARKET_CHEMISTRY_IDS = {
  "Мастила": 4253,
  "Ревіталізанти та присадки": 4254,
  "Клеї і герметики": 4255,
  "Промивки та очищувачі": 4256,
  "Склоомиваюча рідина": 4257,
  "Дистильована вода": 4258,
  "Детейлінг авто": 4260,
  "Інша автохімія": 4261,
};

// Поля адмінки TruckMarket по категоріях.
// Ключ — id категорії, значення — мапа "назва поля → код f...".
// "Артикул" у "Моторних оливах" дублюється (f4 і f22) — залишаю обидва ключі
// як вони задані в адмінці; уточнити, який з них для зовнішнього артикула.
const TRUCKMARKET_CATEGORY_FIELDS = {
  // Моторні оливи
  4263: {
    "Бренд": "f7",
    "В'язкість SAE": "f2",
    "Тип оливи": "f1",
    "ACEA": "f24",
    "API": "f25",
    "Низький рівень SAPS": "f3",
    "Артикул": "f22",
    "Об'єм упаковки, л": "f6",
    "Допуски виробників": "f23",
    "Марки авто": "f5",
  },
  // Трансмісійні оливи
  4264: {
    "Бренд": "f7",
    "В'язкість SAE": "f6",
    "Клас в'язкості ISO VG": "f1",
    "Тип оливи": "f2",
    "Артикул": "f22",
    "API": "f23",
    "Допуски виробників": "f24",
    "Об'єм упаковки, л": "f4",
    "Марки авто": "f5",
  },
  // Гідравлічні оливи
  // УВАГА: type_oil у БД для гідравлічних завжди NULL → поле "Тип оливи"
  // не передається. f1 на TruckMarket — це Клас в'язкості ISO VG
  // (підтверджено HTML d[1] для 4265: ISO 46=1, ISO 68=2, ISO 32=3).
  // Бренд у 4265 — f5 (підтверджено HTML d[5] для 4265).
  4265: {
    "Бренд": "f5",
    "Клас в'язкості ISO VG": "f1",
    "Артикул": "f21",
    "Допуски виробників": "f22",
    "Об'єм упаковки, л": "f4",
    "Марки авто": "f3",
  },
  // Гальмівні рідини
  4267: {
    "Стандарт DOT": "f3",
    "Тип оливи": "f4",
    "Артикул": "f21",
    "Допуски виробників": "f22",
    "Об'єм упаковки, л": "f1",
  },
  // Мастила (секція "Хімія та засоби обслуговування")
  4253: {
    "Тип основи": "f4",
    "Допуски виробників": "f22",
    "Об'єм упаковки, кг": "f5",
    "Марки авто": "f1",
    "Артикул": "f21",
    "Бренд": "f2",
  },
};

// Поля TruckMarket, які ігноруємо при інтеграції (не надсилаємо в API).
// Ключ — id категорії TruckMarket, значення — назви полів, які пропускаються.
// Бренд тепер беремо з company_olivs.name_company через field-encoder kind:"brand",
// тому ігнор зняли для всіх трьох категорій.
const TRUCKMARKET_IGNORED_FIELDS = {
  4253: ["Тип основи"], // Мастила
};

// Мапа типу оливи з нашої БД (olivs.name_type_oil) → id категорії TruckMarket.
// Окремі типи мапляться у "сусідні" категорії TruckMarket:
//   антифриз            → Охолоджуючі рідини (4269)
//   індустріальне оливо → Мастила (4253)
const TYPE_OIL_TO_TRUCKMARKET_CATEGORY = {
  "моторне оливо": 4263,        // Моторні оливи
  "трансмісійне оливо": 4264,   // Трансмісійні оливи
  "гідравлічне оливо": 4265,    // Гідравлічні оливи
  "мастило": 4253,              // Мастила
  "гальмівна рідина": 4267,     // Гальмівні рідини
  "антифриз": 4269,             // Охолоджуючі рідини
  "індустріальне оливо": 4253,  // Мастила
};

// Опції для поля "Марки авто" — СПІЛЬНІ для всіх категорій TruckMarket,
// де є вибір марок (підтверджено: id однакові в Моторних f5 і Гідравлічних f3).
// УВАГА: id — степені 2. TruckMarket очікує СУМАРНЕ число (бітова маска),
// напр. BMW + Mercedes + Ford = 1 | 2 | 64 = 67.
// Перетворення масиву brand-names → bitmask робиться в integration.js.
// Ключ — назва бренду як зберігається в olivs.car_brand[], значення — bit id.
const CAR_BRAND_OPTIONS = {
  "BMW": 1,
  "Mercedes-Benz": 2,
  "Renault": 4,
  "MAN": 8,
  "Volvo": 16,
  "DAF": 32,
  "Ford": 64,
  "Mack": 128,
  "Volkswagen": 256,
  "Porsche": 512,
  "Opel": 1024,
  "Nissan": 2048,
  "Fiat": 4096,
  "Peugeot": 8192,
  "Citroen": 16384,
  "ZF": 32768,
  "Scania": 65536,
  "Iveco": 131072,
};

// Нормалізація назв брендів з нашої БД → канонічна назва TruckMarket.
// Наш парсер видобуває "Opel/Vauxhall" з допусків, у TruckMarket — лише "Opel".
const CAR_BRAND_NAME_NORMALIZATION = {
  "Opel/Vauxhall": "Opel",
};

// === МОТОРНІ ОЛИВИ (cat_id 4263) ===
// Опції select-полів у вигляді: { значення_з_нашої_БД → id_на_TruckMarket }.
// УВАГА: id опцій ЛОКАЛЬНІ для кожного (cat_id, f-код).
// Не переносити в інші категорії без перевірки!

// f3 — Низький рівень SAPS. Бере значення з olivs.low_level_saps (boolean).
//   true  → 2 (Так)
//   false → 1 (Ні)
//   null  → не надсилати поле взагалі
const LOW_SAPS_OPTIONS_MOTOR = {
  true: 2,
  false: 1,
};

// f1 — Тип оливи. Бере значення з olivs.type_oil.
const TYPE_OIL_OPTIONS_MOTOR = {
  "напівсинтетичне": 1, // Напівсинтетична
  "мінеральне": 2,      // Мінеральна
  "синтетичне": 3,      // Синтетична
};

// f2 — В'язкість SAE. Бере значення з olivs.viscosity_sae (формат "0W-20").
const SAE_OPTIONS_MOTOR = {
  "0W-16": 1,
  "0W-20": 2,
  "0W-30": 3,
  "5W-20": 4,
  "5W-30": 5,
  "5W-40": 6,
  "10W-30": 7,
  "10W-40": 8,
  "10W-50": 9,
  "10W-60": 10,
  "15W-40": 11,
  "15W-50": 12,
  "20W-50": 13,
};

// === СПІЛЬНИЙ СПИСОК ОБ'ЄМІВ УПАКОВКИ для всіх трьох категорій ===
// f-код: моторні=f6, трансмісійні/гідравлічні=f4.
// ID підтверджено HTML d[4] — оновлений спільний словник 0.1…1000 л (18 значень).
const PACKAGING_VOLUME_OPTIONS = {
  0.1:  1,
  0.25: 2,
  0.5:  3,
  1:    4,
  1.5:  5,
  2:    6,
  3:    7,
  4:    8,
  5:    9,
  7:    10,
  8:    11,
  10:   12,
  20:   13,
  25:   14,
  60:   15,
  205:  16,
  208:  17,
  1000: 18,
};
// Backwards-compat alias (для старого моторного коду, що ссилався на _MOTOR).
const PACKAGING_VOLUME_OPTIONS_MOTOR = PACKAGING_VOLUME_OPTIONS;

// === ТРАНСМІСІЙНІ ОЛИВИ (cat_id 4264) ===
// f1 — Клас в'язкості ISO VG. Парсер зберігає формат "ISO VG 46".
const ISO_VG_OPTIONS_TRANSMISSION = {
  "ISO 46": 1,
  "ISO VG 46": 1,
  "ISO 68": 2,
  "ISO VG 68": 2,
  "ISO 32": 3,
  "ISO VG 32": 3,
};

// f2 — Тип оливи. Бере значення з olivs.type_oil.
const TYPE_OIL_OPTIONS_TRANSMISSION = {
  "синтетичне": 1, // Синтетична
  "мінеральне": 2, // Мінеральна
};

// Об'єм упаковки трансмісійних = спільна шкала (PACKAGING_VOLUME_OPTIONS).
const PACKAGING_VOLUME_OPTIONS_TRANSMISSION = PACKAGING_VOLUME_OPTIONS;

// f6 — В'язкість SAE для трансмісійних. Підтверджено по HTML фільтра 4264:
// шкала збігається з моторними (id 1..13 → 0W-16..20W-50). Значення з нашої
// БД для трансмісійних (75W-90, 80W-90, 85W-140 і т.д.) відсутні в опціях
// TruckMarket — lookupOption тихо їх пропустить з warning.
const SAE_OPTIONS_TRANSMISSION = { ...SAE_OPTIONS_MOTOR };

// === ГІДРАВЛІЧНІ ОЛИВИ (cat_id 4265) ===
// f1 — Тип оливи. Бере значення з olivs.type_oil.
const TYPE_OIL_OPTIONS_HYDRAULIC = {
  "напівсинтетичне": 1, // Напівсинтетична
  "мінеральне": 2,      // Мінеральна
  "синтетичне": 3,      // Синтетична
};

// Об'єм упаковки гідравлічних = спільна шкала (PACKAGING_VOLUME_OPTIONS).
const PACKAGING_VOLUME_OPTIONS_HYDRAULIC = PACKAGING_VOLUME_OPTIONS;

// Спільний список брендів TruckMarket для всіх категорій з полем "Бренд".
// ID підтверджено HTML d[5] моторної (4263); такі ж id використовуємо для
// трансмісійних (f7) і гідравлічних (f7).
// УВАГА: lookup ключ нормалізуємо до lowercase у helpers.findBrandId().
const BRAND_OPTIONS = {
  "Mobil 1": 1,
  "Castrol": 2,
  "Liqui Moly": 3,
  "Shell Helix": 4,
  "Total / TotalEnergies": 5,
  "Motul": 6,
  "Ravenol": 7,
  "Elf": 8,
  "Aral": 9,
  "BP": 10,
  "XADO": 11,
  "Delo": 12,
  "Texaco": 13,
  "Eurolub": 14,
  "Fuchs": 15,
  "Mannol": 16,
};
// Для зворотної сумісності
const BRAND_OPTIONS_HYDRAULIC = BRAND_OPTIONS;

// Зведена мапа всіх опцій по категоріях.
// Структура: { [cat_id]: { [fieldCode]: { "значення_з_БД": id_TruckMarket } } }
const TRUCKMARKET_FIELD_OPTIONS = {
  // Моторні оливи
  4263: {
    f1: TYPE_OIL_OPTIONS_MOTOR,
    f2: SAE_OPTIONS_MOTOR,
    f3: LOW_SAPS_OPTIONS_MOTOR,
    f5: CAR_BRAND_OPTIONS,           // bitmask
    f6: PACKAGING_VOLUME_OPTIONS_MOTOR,
    f7: BRAND_OPTIONS,
  },
  // Трансмісійні оливи
  4264: {
    f1: ISO_VG_OPTIONS_TRANSMISSION,
    f2: TYPE_OIL_OPTIONS_TRANSMISSION,
    f4: PACKAGING_VOLUME_OPTIONS_TRANSMISSION,
    f6: SAE_OPTIONS_TRANSMISSION,
    f7: BRAND_OPTIONS,
  },
  // Гідравлічні оливи
  4265: {
    f1: ISO_VG_OPTIONS_TRANSMISSION, // ID збігаються з 4264 (ISO 46=1, 68=2, 32=3)
    f4: PACKAGING_VOLUME_OPTIONS_HYDRAULIC,
    f5: BRAND_OPTIONS, // d[5] = бренд для 4265
  },
};

// Чорний список типів оливи (olivs.name_type_oil), які НЕ синхронізуються
// з TruckMarket. Перед формуванням payload перевіряємо, чи тип у цьому списку,
// і якщо так — пропускаємо запис.
const TYPE_OIL_BLACKLIST = new Set([
  "мастило",
  "гальмівна рідина",
  "антифриз",
  "індустріальне оливо",
]);

module.exports = {
  TRUCKMARKET_CATEGORY_IDS,
  TRUCKMARKET_CHEMISTRY_IDS,
  TRUCKMARKET_CATEGORY_FIELDS,
  TYPE_OIL_TO_TRUCKMARKET_CATEGORY,
  TRUCKMARKET_IGNORED_FIELDS,
  TYPE_OIL_BLACKLIST,
  TRUCKMARKET_FIELD_OPTIONS,
  CAR_BRAND_OPTIONS,
  CAR_BRAND_NAME_NORMALIZATION,
  BRAND_OPTIONS,
};
