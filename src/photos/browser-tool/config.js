const BARREL_CONFIG = {
  TEMPLATES: {
    liters_1:     { unit: 'l', value: '1 л',   left: 238, top:  28, width: 200, height: 340, country: { left: 538, top: 59, width: 120, height: 18 } },
    'liters_1.5': { unit: 'l', value: '1.5 л', left: 245, top:  60, width: 200, height: 330, country: { left: 540, top: 59, width: 120, height: 18 } },
    liters_4:     { unit: 'l', value: '4 л',   left: 200, top:  20, width: 290, height: 345, country: { left: 542, top: 59, width: 120, height: 18 } },
    liters_5:     { unit: 'l', value: '5 л',   left: 190, top:  24, width: 310, height: 360, country: { left: 540, top: 59, width: 120, height: 18 } },
    liters_20:    { unit: 'l', value: '20 л',  left: 170, top:  25, width: 340, height: 370, country: { left: 540, top: 59, width: 120, height: 18 } },
    liters_60:    { unit: 'l', value: '60 л',  left: 474, top:  59, width: 640, height: 853, country: { left: 1263, top: 154, width: 280, height: 45 } },
    liters_208:   { unit: 'l', value: '208 л', left: 200, top:  25, width: 270, height: 360, country: { left: 538, top: 59, width: 120, height: 18 } },
    liters_1000:  { unit: 'l', value: '1000 л',left: 403, top:  59, width: 806, height: 877, country: { left: 1272, top: 140, width: 280, height: 45 } },

    'kg_0.4':     { unit: 'kg', value: '0.4 кг', left: 228, top:  24, width: 220, height: 340, country: { left: 538, top: 59, width: 120, height: 18 } },
    'kg_0.5':     { unit: 'kg', value: '0.5 кг', left: 209, top:  14, width: 240, height: 360, country: { left: 538, top: 59, width: 120, height: 18 } },
    'kg_0.6':     { unit: 'kg', value: '0.6 кг', left: 230, top:  40, width: 220, height: 340, country: { left: 538, top: 59, width: 120, height: 18 } },
    'kg_0.9':     { unit: 'kg', value: '0.9 кг', left: 222, top:  24, width: 220, height: 340, country: { left: 538, top: 59, width: 120, height: 18 } },
    kg_5:         { unit: 'kg', value: '5 кг',   left: 190, top:  24, width: 310, height: 360, country: { left: 538, top: 59, width: 120, height: 18 } },
    kg_15:        { unit: 'kg', value: '15 кг',  left: 202, top:  25, width: 260, height: 340, country: { left: 538, top: 59, width: 120, height: 18 } },
    kg_25:        { unit: 'kg', value: '25 кг',  left: 170, top: -6, width: 340, height: 410, country: { left: 538, top: 59, width: 120, height: 18 } },
    kg_50:        { unit: 'kg', value: '50 кг',  left: 200, top:  25, width: 270, height: 360, country: { left: 538, top: 59, width: 120, height: 18 } },
    kg_180:       { unit: 'kg', value: '180 кг', left: 210, top:  35, width: 260, height: 350, country: { left: 540, top: 59, width: 120, height: 18 } },
  },

  COUNTRIES: [
    'США', 'Фінляндія', 'Франція', 'Сінгапур', 'Бельгія', 'Німеччина',
    'Велика Британія', 'Угорщина', 'Туреччина', 'Україна', 'Нідерланди', 'Литва',
  ],

  COUNTRY_TEXT: {
    color: '#ffffff',
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: 700,
    paddingRatio: 0.06,
  },

  KG_MAP: {
    '400': '0.4 кг',
    '500': '0.5 кг',
    '600': '0.6 кг',
    '900': '0.9 кг',
    '025': '25 кг',
    '050': '50 кг',
    '180': '180 кг',
  },
  LITERS_MAP: {
    '001': '1 л',
    '015': '1.5 л',
    '004': '4 л',
    '005': '5 л',
    '020': '20 л',
    '060': '60 л',
    '208': '208 л',
    '100': '1000 л',
  },

  KG_PREFIX7_MAP: {
    '005': '5 кг',
    '015': '15 кг',
  },

  TEMPLATE_EXTS: ['png', 'jpg', 'jpeg'],
  JPG_QUALITY: 0.9,

  BG_REMOVAL: {
    enabled: true,
    whiteThreshold: 245,
    cropPadding: 0.10,
  },
};

if (typeof window !== 'undefined') {
  window.BARREL_CONFIG = BARREL_CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BARREL_CONFIG;
}
