// Генерує "no-country" версії шаблонів для інтеграцій без країни (Manager):
// замальовує білим середню плашку-стрілку (країна), лишаючи об'єм + Комбінезон.
// Результат: <name>_nc.jpg поряд з оригіналами в templates/.
//
// Запуск: node src/photos/process/make-nc-templates.cjs

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const CFG = require("./template-config.cjs");

const TEMPLATES_DIR = path.resolve(__dirname, "..", "browser-tool", "templates");

// Зона замальовки = country-плашка + запас ліворуч (під стрілку-вказівник),
// щоб прибрати і трикутник стрілки. Тло навколо плашки біле → зливається.
async function makeOne(name, ext) {
  const src = path.join(TEMPLATES_DIR, `${name}.${ext}`);
  if (!fs.existsSync(src)) return null;
  const cfg = CFG.TEMPLATES[name];
  if (!cfg || !cfg.country) return null;
  const c = cfg.country;
  const meta = await sharp(src).metadata();
  const W = meta.width, H = meta.height;

  // Прибрати плашку країни (середню) і ПІДНЯТИ все, що нижче (плашка
  // "Комбінезон" + фон), щоб комбінезон став одразу під літражем — без
  // порожнього відступу на місці країни.
  //
  // Зона правих плашок (вузька колонка справа). Беремо з запасом ліворуч
  // (стрілки-вказівники тягнуться лівіше) до правого краю.
  const stripLeft = Math.max(0, c.left - 30);
  const stripW = W - stripLeft;
  const gap = Math.round(c.height * 0.4);   // типовий проміжок між плашками
  // Підйом смуги "Комбінезон": висота плашки країни + проміжки з обох боків,
  // щоб комбінезон став ЩІЛЬНО під літражем (мінімальний відступ, як між
  // звичайними плашками, а не порожнеча на місці країни).
  const bandH = c.height + gap * 2;

  // Все, що НИЖЧЕ плашки країни (плашка "Комбінезон" + фон) — піднімаємо,
  // щоб закрити порожнечу від видаленої країни. Беремо з запасом ПІД низом
  // країни (+gap), щоб не захопити її нижню чорну межу.
  const belowTop = c.top + c.height + gap;  // нижче плашки країни з запасом
  const below = await sharp(src)
    .extract({ left: stripLeft, top: belowTop, width: stripW, height: H - belowTop })
    .toBuffer();

  // Замальовуємо білим усю стару зону, починаючи ОДРАЗУ під плашкою об'єму
  // (верхній край чорної плашки країни ~9px вище її top) — щоб прибрати темну
  // смужку (верхній край плашки країни), яка інакше лишається між плашками.
  const coverTop = Math.max(0, c.top - 9);
  const whiteCover = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${stripW}" height="${H - coverTop}">` +
      `<rect x="0" y="0" width="${stripW}" height="${H - coverTop}" fill="#ffffff"/>` +
    `</svg>`, "utf-8");

  // Зберігаємо PNG (без втрат) — інакше написи на плашках двічі стискаються
  // JPEG (тут + у процесорі) і стають розмитими. Переміщення плашки —
  // по цілих координатах (без ресемплінгу), щоб написи лишались чіткими/рівними.
  const out = path.join(TEMPLATES_DIR, `${name}_nc.png`);
  await sharp(src)
    .composite([
      { input: whiteCover, left: stripLeft, top: coverTop },
      { input: below, left: stripLeft, top: Math.max(0, belowTop - bandH) },
    ])
    .png({ compressionLevel: 9 })
    .toFile(out);
  return out;
}

(async () => {
  let made = 0;
  for (const name of Object.keys(CFG.TEMPLATES)) {
    for (const ext of CFG.TEMPLATE_EXTS) {
      if (fs.existsSync(path.join(TEMPLATES_DIR, `${name}.${ext}`))) {
        const out = await makeOne(name, ext);
        if (out) { console.log("✓ " + path.basename(out)); made++; }
        break; // лише перший наявний ext
      }
    }
  }
  console.log(`\nСтворено no-country шаблонів: ${made}`);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
