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

module.exports = { buildPlatesSvg, plateSvg, PLATE };
