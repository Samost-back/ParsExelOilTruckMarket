const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const {
  SECTION_RE,
  TYPE_OIL_MAP,
  SPLIT_RE,
  COLUMN_KEYWORDS,
  SECTION_DISPLAY,
  TYPE_OIL_DISPLAY,
  COVERALL_FROM_VOLUME,
  DEFAULT_QUANTITY,
  COLOR_PATTERNS,
  STANDART_G_RE,
} = require('./constants');

const [, , companyArg, excelArg, outArg] = process.argv;
if (!companyArg || !excelArg) {
  console.error('Usage: node parser.js "<Company Name>" <excel-file> [output.json]');
  process.exit(1);
}

const excelPath = path.resolve(excelArg);
const outPath = path.resolve(outArg || path.join(path.dirname(excelPath), 'output.json'));

if (!fs.existsSync(excelPath)) {
  console.error(`File not found: ${excelPath}`);
  process.exit(1);
}

const wb = xlsx.readFile(excelPath, { cellDates: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

let headerRow = -1;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || [];
  if (r.some(c => typeof c === 'string' && /найменування/i.test(c))) {
    headerRow = i;
    break;
  }
}
if (headerRow === -1) {
  console.error('Header row "Найменування" not found');
  process.exit(1);
}

function normalizeHeader(s) {
  return (s == null ? '' : s.toString())
    .toLowerCase()
    .replace(/[\s\-_.,()/]/g, '')
    .replace(/[іїыi]/g, 'и');
}

const headers = (rows[headerRow] || []).map(normalizeHeader);
const findCol = (keywords) =>
  headers.findIndex(h => keywords.some(k => h.includes(normalizeHeader(k))));

const COL = Object.fromEntries(
  Object.entries(COLUMN_KEYWORDS).map(([key, kws]) => [key, findCol(kws)])
);

function categorizeSection(text) {
  if (!text) return null;
  const normalized = text.toString().toLowerCase().replace(/[іїi]/g, 'и');
  for (const { regex, value } of TYPE_OIL_MAP) {
    if (regex.test(normalized)) return value;
  }
  return text.toString().trim();
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const s = v.toString().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extractSAE(name) {
  if (!name) return null;
  const m = name.toString().match(/(\d+W[\s\-/]?\d+|\d+W\b)/i);
  return m ? m[1].toUpperCase().replace(/[\s/]/g, '-') : null;
}

function parseDescription(text) {
  const result = { type_oil: null, low_level_SAPS: null, standart_G: null, color_liquid: null };
  if (!text) return result;
  const cleaned = text.toString().replace(/[()█]/g, ' ').replace(/\s+/g, ' ').trim();

  const gMatch = cleaned.match(STANDART_G_RE);
  if (gMatch) result.standart_G = ('G' + gMatch[1] + (gMatch[2] || '')).trim();

  for (const { regex, value } of COLOR_PATTERNS) {
    if (regex.test(cleaned)) { result.color_liquid = value; break; }
  }

  const parts = cleaned.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (/напівсинтет/i.test(p)) result.type_oil = 'напівсинтетичне';
    else if (/синтет/i.test(p)) result.type_oil = 'синтетичне';
    else if (/мінеральн/i.test(p)) result.type_oil = 'мінеральне';
    else if (/low\s*saps/i.test(p)) result.low_level_SAPS = true;
    else if (/(mid|full|high)\s*saps/i.test(p)) result.low_level_SAPS = false;
  }
  return result;
}

function parseSpecs(text) {
  const out = { ACEA: [], API: [], manufacturers: [] };
  if (!text) return finalize(out);

  const lines = text.split(/[\n\r]/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    const tokens = line.split(SPLIT_RE).map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
      const t = token.replace(/[,;]\s*$/, '').trim();
      if (!t) continue;
      if (/^ACEA\b/i.test(t)) {
        out.ACEA.push(...t.replace(/^ACEA\s*/i, '').split(',').map(s => s.trim()).filter(Boolean));
      } else if (/^API\b/i.test(t)) {
        out.API.push(...t.replace(/^API\s*/i, '').split(',').map(s => s.trim()).filter(Boolean));
      } else {
        out.manufacturers.push(t);
      }
    }
  }
  return finalize(out);

  function finalize(o) {
    return {
      ACEA: o.ACEA.length ? o.ACEA.join(', ') : null,
      API: o.API.length ? o.API.join(', ') : null,
      manufacturers_tolerances: o.manufacturers.length ? o.manufacturers.join('; ') : null,
    };
  }
}

function buildName({ section, rawName, viscosity_SAE, type_oil, packaging_volume }) {
  const sectionInfo = SECTION_DISPLAY[section];
  const prefix = sectionInfo ? sectionInfo.prefix : (section || '');

  let baseName = rawName
    .replace(/\s*SAE\s*\d+W[\s\-/]?\d*/gi, '')
    .replace(/\s*\b\d+W[\s\-/]?\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (viscosity_SAE) baseName = (baseName + ' ' + viscosity_SAE).trim();

  let typeAdj = '';
  if (type_oil && sectionInfo && TYPE_OIL_DISPLAY[type_oil] && sectionInfo.gender !== 'm') {
    typeAdj = ' ' + TYPE_OIL_DISPLAY[type_oil][sectionInfo.gender];
  }

  const parts = [`${prefix} ${baseName}${typeAdj}`.trim(), `${packaging_volume} л`];
  if (packaging_volume >= COVERALL_FROM_VOLUME) parts.push('+Комбінезон');

  return parts.join(' | ');
}

function newBlock(section) {
  return { section, name: null, descriptionRaw: null, specsText: '', variants: [] };
}

function variantFromRow(row) {
  return {
    packaging_volume: toNumber(row[COL.packaging]),
    articul: row[COL.articul] != null ? row[COL.articul].toString().replace(/\s/g, '') : null,
    price_per_package: toNumber(row[COL.pricePackage]),
    price_per_liter: toNumber(row[COL.pricePerLiter]),
    recommended_price: toNumber(row[COL.recommendedPrice]),
  };
}

const blocks = [];
let currentSection = null;
let block = null;

function pushBlock() {
  if (block && block.variants.length > 0) blocks.push(block);
  block = null;
}

for (let i = headerRow + 1; i < rows.length; i++) {
  const row = rows[i] || [];
  const name = row[COL.name];
  const spec = row[COL.spec];
  const articul = row[COL.articul];
  const packaging = row[COL.packaging];

  if (name == null && spec == null && packaging == null && articul == null) continue;

  const nameStr = name == null ? '' : name.toString().trim();

  if (nameStr && articul == null && packaging == null && SECTION_RE.test(nameStr) && !nameStr.startsWith('(')) {
    pushBlock();
    currentSection = categorizeSection(nameStr);
    continue;
  }

  if (nameStr.startsWith('(') && block) {
    block.descriptionRaw = nameStr;
    if (spec) block.specsText += '\n' + spec.toString();
    if (articul != null) block.variants.push(variantFromRow(row));
    continue;
  }

  if (nameStr && !nameStr.startsWith('(') && (/^[а-яёіїєґ]/.test(nameStr) || /^SAE\b/i.test(nameStr)) && block) {
    if (/^SAE\b/i.test(nameStr) && !extractSAE(block.name)) {
      block.name = `${block.name} ${nameStr}`.trim();
    } else if (block.descriptionRaw && !block.descriptionRaw.includes(')')) {
      block.descriptionRaw += ' ' + nameStr;
    }
    if (spec) block.specsText += '\n' + spec.toString();
    if (articul != null) block.variants.push(variantFromRow(row));
    continue;
  }

  if (nameStr && !nameStr.startsWith('(')) {
    pushBlock();
    block = newBlock(currentSection);
    block.name = nameStr.replace(/\s{2,}[а-яёіїєґ].*$/, '').trim();
    if (spec) block.specsText += spec.toString();
    if (articul != null) block.variants.push(variantFromRow(row));
    continue;
  }

  if (!nameStr && block) {
    if (spec) block.specsText += '\n' + spec.toString();
    if (articul != null) block.variants.push(variantFromRow(row));
  }
}
pushBlock();

const oils = [];
const skipped = [];
const today = new Date().toISOString();

for (const b of blocks) {
  const inlineDescRe = /\(([^)]*(?:синтет|мінеральн|low\s*saps|mid\s*saps|full\s*saps|колір|G\s*1[123]|син|червон|жовт|зелен|помаранч|лілов|фіолетов|блакитн|чорн|бордов|прозор)[^)]*\))/i;
  const inlineDescMatch = b.name.match(inlineDescRe);
  if (inlineDescMatch) {
    b.descriptionRaw = b.descriptionRaw ? b.descriptionRaw + ' ' + inlineDescMatch[0] : inlineDescMatch[0];
    b.name = b.name.replace(inlineDescMatch[0], '').replace(/\s+/g, ' ').trim();
  }
  b.name = b.name.replace(/█+/g, '').replace(/\s+/g, ' ').trim();

  const dotMatch = b.name.match(/\bDOT\s*(\d+(?:\.\d+)?\+?)(?![\w.])/i);
  const dotValue = dotMatch ? `DOT ${dotMatch[1]}` : null;
  if (dotMatch) b.name = b.name.replace(dotMatch[0], dotValue).replace(/\s+/g, ' ').trim();

  const isoMatch = b.name.match(/\bISO[-\s]?VG\s*(\d+)\b/i);
  const isoValue = isoMatch ? `ISO VG ${isoMatch[1]}` : null;
  if (isoMatch) b.name = b.name.replace(isoMatch[0], isoValue).replace(/\s+/g, ' ').trim();

  const desc = parseDescription(b.descriptionRaw);
  const specs = parseSpecs(b.specsText);
  const sae = extractSAE(b.name);

  for (const v of b.variants) {
    if (!v.articul || !v.packaging_volume) {
      skipped.push({ name: b.name, reason: 'missing articul or packaging', variant: v });
      continue;
    }

    const packaging_volume = v.packaging_volume;
    oils.push({
      name_type_oil: b.section,
      name: buildName({ section: b.section, rawName: b.name, viscosity_SAE: sae, type_oil: desc.type_oil, packaging_volume }),
      articul: v.articul,
      packaging_volume,
      viscosity_SAE: sae,
      type_oil: desc.type_oil,
      low_level_SAPS: desc.low_level_SAPS,
      manufacturers_tolerances: specs.manufacturers_tolerances,
      ACEA: specs.ACEA,
      API: specs.API,
      color_liquid: desc.color_liquid,
      ISO_VG_viscosity_grade: isoValue,
      standart_G: desc.standart_G,
      DOT: dotValue,
      quantity: DEFAULT_QUANTITY,
      price: v.recommended_price != null ? Math.round(v.recommended_price) : null,
      valid_from: today,
      valid_to: null,
    });
  }
}

const output = {
  company: { name_company: companyArg },
  oils,
  _meta: {
    excel_file: path.basename(excelPath),
    parsed_at: today,
    products_count: blocks.length,
    oils_count: oils.length,
    skipped,
  },
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
console.log(`✓ Розпарсено продуктів: ${blocks.length}`);
console.log(`✓ Створено olivs-записів: ${oils.length}`);
if (skipped.length) console.log(`⚠ Пропущено варіантів: ${skipped.length}`);
console.log(`✓ Збережено: ${outPath}`);
