import { describe, it, expect } from "vitest";
const {
  SECTION_RE, TYPE_OIL_MAP, COLOR_PATTERNS,
  CAR_BRANDS, CAR_BRAND_KEYS_SORTED,
  SECTION_DISPLAY, TYPE_OIL_DISPLAY,
  COVERALL_FROM_VOLUME, DEFAULT_QUANTITY,
  STANDART_G_RE,
} = require("../../src/parser/constants");

describe("SECTION_RE", () => {
  it("матчить ключові слова секцій", () => {
    expect(SECTION_RE.test("Моторні оливи")).toBe(true);
    expect(SECTION_RE.test("Антифриз")).toBe(true);
    expect(SECTION_RE.test("Охолоджуючі рідини")).toBe(true);
    expect(SECTION_RE.test("Гальмівні рідини")).toBe(true);
    expect(SECTION_RE.test("Мастило")).toBe(true);
  });

  it("не матчить випадкові рядки", () => {
    expect(SECTION_RE.test("Артикул")).toBe(false);
    expect(SECTION_RE.test("Найменування")).toBe(false);
  });
});

describe("TYPE_OIL_MAP", () => {
  function categorize(text) {
    const norm = text.toLowerCase().replace(/[іїi]/g, "и");
    for (const { regex, value } of TYPE_OIL_MAP) {
      if (regex.test(norm)) return value;
    }
    return null;
  }
  it("моторні", () => {
    expect(categorize("Моторні оливи")).toBe("моторне оливо");
  });
  it("трансмісійні", () => {
    expect(categorize("Трансмісійні оливи")).toBe("трансмісійне оливо");
  });
  it("гідравлічні", () => {
    expect(categorize("Гідравлічні оливи")).toBe("гідравлічне оливо");
  });
  it("антифриз/охолоджуючі/тосол", () => {
    expect(categorize("Антифриз")).toBe("антифриз");
    expect(categorize("Охолоджуючі рідини")).toBe("антифриз");
    expect(categorize("Тосол")).toBe("антифриз");
  });
  it("гальмівні", () => {
    expect(categorize("Гальмівні рідини")).toBe("гальмівна рідина");
  });
  it("мастило", () => {
    expect(categorize("Мастило консистентне")).toBe("мастило");
    expect(categorize("Пластичне мастило")).toBe("мастило");
  });
});

describe("COLOR_PATTERNS", () => {
  function detect(s) {
    for (const { regex, value } of COLOR_PATTERNS) {
      if (regex.test(s)) return value;
    }
    return null;
  }
  it("розпізнає основні кольори", () => {
    expect(detect("червоного кольору")).toBe("червоний");
    expect(detect("зелений")).toBe("зелений");
    expect(detect("жовтий")).toBe("жовтий");
    expect(detect("синій")).toBe("синій");
  });
  it("композитні кольори", () => {
    expect(detect("синьо-зелений")).toBe("синьо-зелений");
    expect(detect("фіолетово-ліловий")).toBe("фіолетово-ліловий");
  });
});

describe("STANDART_G_RE", () => {
  it("матчить G11/G12/G13 з + опціонально", () => {
    expect("стандарт G12".match(STANDART_G_RE)?.[1]).toBe("12");
    expect("G12+ стандарт".match(STANDART_G_RE)?.[2]).toBe("+");
    expect("G11".match(STANDART_G_RE)?.[1]).toBe("11");
  });
});

describe("CAR_BRANDS", () => {
  it("включає основні бренди", () => {
    expect(CAR_BRANDS["bmw"]).toBe("BMW");
    expect(CAR_BRANDS["mb"]).toBe("Mercedes-Benz");
    expect(CAR_BRANDS["mercedes"]).toBe("Mercedes-Benz");
    expect(CAR_BRANDS["vw"]).toBe("Volkswagen");
  });
  it("CAR_BRAND_KEYS_SORTED від найдовшого до найкоротшого", () => {
    const sorted = CAR_BRAND_KEYS_SORTED;
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].length).toBeLessThanOrEqual(sorted[i - 1].length);
    }
  });
});

describe("SECTION_DISPLAY", () => {
  it("має prefix і gender для всіх типів", () => {
    expect(SECTION_DISPLAY["моторне оливо"].prefix).toBe("Моторна олива");
    expect(SECTION_DISPLAY["моторне оливо"].gender).toBe("f");
    expect(SECTION_DISPLAY["мастило"].unit).toBe("кг");
  });
});

describe("TYPE_OIL_DISPLAY", () => {
  it("має gender-форми для типів", () => {
    expect(TYPE_OIL_DISPLAY["синтетичне"].f).toBe("синтетична");
    expect(TYPE_OIL_DISPLAY["синтетичне"].m).toBe("синтетичний");
    expect(TYPE_OIL_DISPLAY["напівсинтетичне"].f).toBe("напівсинтетична");
    expect(TYPE_OIL_DISPLAY["мінеральне"].f).toBe("мінеральна");
  });
});

describe("constants", () => {
  it("COVERALL_FROM_VOLUME = 208", () => {
    expect(COVERALL_FROM_VOLUME).toBe(208);
  });
  it("DEFAULT_QUANTITY = 1000", () => {
    expect(DEFAULT_QUANTITY).toBe(1000);
  });
});
