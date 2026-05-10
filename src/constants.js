const SECTION_RE = /(оливи|олива|мастил|смазк|антифриз|охолоджу|гальмівн|тосол|рідин)/i;

const TYPE_OIL_MAP = [
  { regex: /моторн/i, value: 'моторне оливо' },
  { regex: /гидравличн/i, value: 'гідравлічне оливо' },
  { regex: /трансмисийн/i, value: 'трансмісійне оливо' },
  { regex: /консистентн|пластичн|^мастил|^смазк/i, value: 'мастило' },
  { regex: /антифриз|охолоджу|тосол/i, value: 'антифриз' },
  { regex: /гальмивн|brake/i, value: 'гальмівна рідина' },
  { regex: /индустриальн/i, value: 'індустріальне оливо' },
  { regex: /редуктор/i, value: 'редукторне оливо' },
  { regex: /компресор/i, value: 'компресорне оливо' },
];

const SPEC_KEYWORDS = ['ACEA', 'API', 'ILSAC', 'JASO', 'NMMA', 'DIN', 'ISO', 'AGMA'];

const MANUF_PREFIXES = [
  'MB', 'BMW', 'VW', 'Ford', 'GM', 'Volvo', 'Renault', 'Porsche', 'MAN', 'Mercedes',
  'Mitsubishi', 'Toyota', 'Honda', 'Hyundai', 'Nissan', 'Mazda', 'Subaru', 'Chrysler',
  'Fiat', 'Opel', 'Vauxhall', 'Peugeot', 'Citroen', 'DAF', 'Iveco', 'Cummins',
  'Caterpillar', 'Detroit', 'MTU', 'ZF', 'Allison', 'Scania', 'Mack', 'Deutz', 'JCB',
  'Liebherr', 'Komatsu', 'Kubota', 'New Holland', 'Case', 'John Deere',
];

const ALL_PREFIXES = [...SPEC_KEYWORDS, ...MANUF_PREFIXES].sort((a, b) => b.length - a.length);

const SPLIT_RE = new RegExp(`(?<=^|[\\s,;])(?=\\b(?:${ALL_PREFIXES.join('|')})\\b)`, 'g');

const SECTION_DISPLAY = {
  'моторне оливо':       { prefix: 'Моторна олива',       gender: 'f' },
  'гідравлічне оливо':   { prefix: 'Гідравлічна олива',   gender: 'f' },
  'трансмісійне оливо':  { prefix: 'Трансмісійна олива',  gender: 'f' },
  'індустріальне оливо': { prefix: 'Індустріальна олива', gender: 'f' },
  'редукторне оливо':    { prefix: 'Редукторна олива',    gender: 'f' },
  'компресорне оливо':   { prefix: 'Компресорна олива',   gender: 'f' },
  'мастило':             { prefix: 'Мастило',             gender: 'n' },
  'антифриз':            { prefix: 'Антифриз',            gender: 'm' },
  'гальмівна рідина':    { prefix: 'Гальмівна рідина',    gender: 'f' },
};

const TYPE_OIL_DISPLAY = {
  'синтетичне':      { f: 'синтетична',      m: 'синтетичний',      n: 'синтетичне' },
  'напівсинтетичне': { f: 'напівсинтетична', m: 'напівсинтетичний', n: 'напівсинтетичне' },
  'мінеральне':      { f: 'мінеральна',      m: 'мінеральний',      n: 'мінеральне' },
};

const COVERALL_FROM_VOLUME = 208;

const DEFAULT_QUANTITY = 1000;

const COLOR_PATTERNS = [
  { regex: /синь?о[-\s]?зелен/i,        value: 'синьо-зелений' },
  { regex: /фіолетов[оа][-\s]?лілов/i,  value: 'фіолетово-ліловий' },
  { regex: /син(?:ій|ьо)/i,             value: 'синій' },
  { regex: /червон/i,                   value: 'червоний' },
  { regex: /жовт/i,                     value: 'жовтий' },
  { regex: /зелен/i,                    value: 'зелений' },
  { regex: /помаранч|оранжев/i,         value: 'помаранчевий' },
  { regex: /рожев/i,                    value: 'рожевий' },
  { regex: /лілов/i,                    value: 'ліловий' },
  { regex: /фіолетов/i,                 value: 'фіолетовий' },
  { regex: /блакитн/i,                  value: 'блакитний' },
  { regex: /бордов/i,                   value: 'бордовий' },
  { regex: /прозор/i,                   value: 'прозорий' },
  { regex: /чорн/i,                     value: 'чорний' },
  { regex: /біл(?:ий|а|е|их)/i,         value: 'білий' },
];

const STANDART_G_RE = /\bG\s*(1[123])(\++)?(?!\d)/i;

const COLUMN_KEYWORDS = {
  name: ['найменування'],
  spec: ['специфікації'],
  packaging: ['упаков'],
  articul: ['артикул'],
  pricePackage: ['за упаковку'],
  pricePerLiter: ['за 1 літр', 'літр'],
  recommendedPrice: ['рекомендован'],
  markup: ['націнка'],
};

module.exports = {
  SECTION_RE,
  TYPE_OIL_MAP,
  SPEC_KEYWORDS,
  MANUF_PREFIXES,
  ALL_PREFIXES,
  SPLIT_RE,
  COLUMN_KEYWORDS,
  SECTION_DISPLAY,
  TYPE_OIL_DISPLAY,
  COVERALL_FROM_VOLUME,
  DEFAULT_QUANTITY,
  COLOR_PATTERNS,
  STANDART_G_RE,
};
