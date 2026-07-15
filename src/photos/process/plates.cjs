// Векторні (SVG) плашки для фото: жовта стрілка-вказівник + чорна крапка + текст.
// Малюються поверх шаблону замість растрових плашок — щоб написи були чіткі,
// рівні й вирівняні (растрові з маленького JPEG-шаблону розмиваються).
//
// Геометрія однієї плашки (px у системі координат шаблону):
//   { left, top, width, height } — прямокутник тіла плашки (без хвоста стрілки).
// Стрілка має трикутний "хвіст" зліва (як на оригінальних шаблонах).

const PLATE = {
  fill: "#F5B301",       // жовтий тіла плашки
  text: "#1a1a1a",       // майже чорний текст
  dot: "#1a1a1a",        // крапка-маркер
  tailW: 18,             // ширина трикутного хвоста зліва
  fontFamily: "DejaVu Sans, Liberation Sans, Arial, sans-serif",
  fontWeight: 700,
};

// Одна плашка → набір SVG-елементів (рядок). cx/cy — система координат канви.
function plateSvg(label, rect) {
  const { left, top, width, height } = rect;
  const t = PLATE.tailW;
  const r = top, b = top + height, l = left, rt = left + width;
  const midY = top + height / 2;
  // Стрілка: прямокутник + трикутний хвіст ліворуч (вістрям вліво).
  const body =
    `<path d="M ${l} ${r} L ${rt} ${r} L ${rt} ${b} L ${l} ${b} ` +
    `L ${l - t} ${midY} Z" fill="${PLATE.fill}"/>`;
  // Крапка-маркер.
  const dotR = Math.max(3, Math.round(height * 0.13));
  const dotCx = l + dotR + 6;
  const dot = `<circle cx="${dotCx}" cy="${midY}" r="${dotR}" fill="${PLATE.dot}"/>`;
  // Текст: вертикально по центру, зліва після крапки.
  const fontSize = Math.round(height * 0.62);
  const textX = dotCx + dotR + 8;
  const text =
    `<text x="${textX}" y="${midY}" font-family="${PLATE.fontFamily}" ` +
    `font-weight="${PLATE.fontWeight}" font-size="${fontSize}" fill="${PLATE.text}" ` +
    `dominant-baseline="central" text-anchor="start">${escapeXml(label)}</text>`;
  return body + dot + text;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

// Будує повний SVG-оверлей плашок для канви canvasW×canvasH.
// plates: масив { label, rect }.
function buildPlatesSvg(canvasW, canvasH, plates) {
  const parts = plates.map((p) => plateSvg(p.label, p.rect)).join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">${parts}</svg>`,
    "utf-8",
  );
}

// Чисто (без I/O) вирішує, ЯКІ плашки малювати і де (зверху вниз):
//   [Об'єм] → [Комбінезон?] → [Країна?]
// Правила:
//   noCountry=true (інтеграція Manager) → ТІЛЬКИ об'єм (без комбінезона й країни).
//   інакше → об'єм + комбінезон (якщо об'єм == coverallVolume) + країна.
// pp — базовий прямокутник плашки об'єму { left, top, width, height }.
// Повертає { items: [{label, rect}], nextTop } — items готові для buildPlatesSvg,
// nextTop — нижня межа блоку (для білого cover'а).
function buildPlateItems({ pp, volLabel, country, packagingVolume, coverallVolume, noCountry }) {
  const gap = Math.round(pp.height * 0.45);
  const step = pp.height + gap;
  const hasCoverall = !noCountry && Math.round(Number(packagingVolume)) === Number(coverallVolume);
  const showCountry = !noCountry && !!country;

  const items = [{ label: volLabel, rect: { ...pp } }];
  let nextTop = pp.top + step;
  if (hasCoverall) { items.push({ label: "Комбінезон", rect: { ...pp, top: nextTop } }); nextTop += step; }
  if (showCountry) { items.push({ label: country, rect: { ...pp, top: nextTop } }); nextTop += step; }
  return { items, nextTop, step };
}

// Назва країни білим текстом у прямокутнику rect (= pos.country з конфіга).
// Повторює логіку browser-tool drawCountryText: розмір шрифту = rect.height *
// heightRatio (дефолт 0.78), ліва прив'язка від rect.left, вертикально по
// центру rect. Жодних «плашок» не малюємо — вони вже є в шаблоні.
function countryLabelSvg(label, rect, textCfg = {}) {
  const heightRatio = typeof textCfg.heightRatio === "number" ? textCfg.heightRatio : 0.78;
  const fontSize = Math.max(6, rect.height * heightRatio);
  const color = textCfg.color || "#ffffff";
  const fontFamily = textCfg.fontFamily || PLATE.fontFamily;
  const fontWeight = textCfg.fontWeight || PLATE.fontWeight;
  const y = rect.top + rect.height / 2;
  return (
    `<text x="${rect.left}" y="${y}" font-family="${fontFamily}" ` +
    `font-weight="${fontWeight}" font-size="${fontSize}" fill="${color}" ` +
    `dominant-baseline="central" text-anchor="start">${escapeXml(label)}</text>`
  );
}

// Повний SVG-оверлей лише з назвою країни (білим) для канви canvasW×canvasH.
function buildCountryLabelSvg(canvasW, canvasH, label, rect, textCfg) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">` +
      countryLabelSvg(label, rect, textCfg) +
    `</svg>`,
    "utf-8",
  );
}

module.exports = { buildPlatesSvg, plateSvg, PLATE, buildPlateItems, countryLabelSvg, buildCountryLabelSvg };
