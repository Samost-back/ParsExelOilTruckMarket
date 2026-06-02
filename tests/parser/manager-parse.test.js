import { describe, it, expect } from "vitest";
const {
  parseManagerSheet,
  extractSAE,
  mapTypeOil,
  syntheticArticul,
} = require("../../src/parser/manager/parse");

// Заголовок аркуша Daf.
const HEADER = ["Заголовок", "Бренд", "Застосування", "Група", "Специфікації", "Упаковка л", "Артикул", "Ціна"];

function sheet(...dataRows) {
  return [HEADER, ...dataRows];
}

describe("parseManagerSheet — формат Daf", () => {
  it("товар DAF без артикулу → синтетичний артикул, бренд з колонки", () => {
    const rows = sheet(
      ["МОТОРНІ ОЛИВИ", null, null, null, null, null, null, null],
      ["Daf Xtreme Fe E-6 10w30", "DAF", null, "Синтетична", "API CJ-4", 208, null, 55126],
      [null, null, null, null, "ACEA E7/E9", null, null, null],
      [null, null, null, null, "Volvo VDS-4", null, null, null],
    );
    const { oils, blocks } = parseManagerSheet(rows);
    expect(blocks).toBe(1);
    expect(oils).toHaveLength(1);
    const o = oils[0];
    expect(o.brand).toBe("DAF");
    expect(o.name_type_oil).toBe("моторне оливо");
    expect(o.articul).toMatch(/^GEN-/);
    expect(o.viscosity_sae).toBe("10W-30");
    expect(o.type_oil).toBe("синтетичне");
    expect(o.api).toBe("CJ-4");
    expect(o.acea).toBe("E7/E9");
    expect(o.manufacturers_tolerances).toContain("Volvo VDS-4");
    expect(o.price).toBe(55126);
    expect(o.packaging_volume).toBe(208);
  });

  it("кілька варіантів об'єму на товар → окремі oils з різними артикулами", () => {
    const rows = sheet(
      ["МОТОРНІ ОЛИВИ", null, null, null, null, null, null, null],
      ["Mobil Delvac 5W30", "Mobil", null, "синтетичне", "MAN M 3677", 208, "157376", 50779],
      [null, null, null, null, "Scania LDF-4", 20, "157375", 5762.6],
    );
    const { oils } = parseManagerSheet(rows);
    expect(oils).toHaveLength(2);
    expect(oils[0].packaging_volume).toBe(208);
    expect(oils[0].articul).toBe("157376");
    expect(oils[1].packaging_volume).toBe(20);
    expect(oils[1].articul).toBe("157375");
    expect(oils[1].price).toBe(5763); // округлення дробової
    // обидва успадковують бренд Mobil і специфікації блоку
    expect(oils[0].brand).toBe("Mobil");
    expect(oils[1].brand).toBe("Mobil");
  });

  it("бренд тягнеться вниз, поки не зустрінемо новий", () => {
    const rows = sheet(
      ["МОТОРНІ ОЛИВИ", null, null, null, null, null, null, null],
      ["Daf A 10w40", "DAF", null, "Синтетична", "ACEA E7", 208, null, 100],
      ["Daf B 5w30", null, null, "Синтетична", "ACEA E9", 208, null, 200], // бренд порожній → DAF
      ["Mobil C 5w40", "Mobil", null, "Синтетична", "API CK-4", 208, "X1", 300],
    );
    const { oils } = parseManagerSheet(rows);
    expect(oils.map((o) => o.brand)).toEqual(["DAF", "DAF", "Mobil"]);
  });

  it("секції перемикають name_type_oil", () => {
    const rows = sheet(
      ["МОТОРНІ ОЛИВИ", null, null, null, null, null, null, null],
      ["Motor 10w40", "DAF", null, "Синтетична", "ACEA E7", 208, "M1", 100],
      ["ТРАНСМІСІЙНІ ОЛИВИ", null, null, null, null, null, null, null],
      ["Gear 75w90", "Mobil", null, "Синтетична", "API GL-5", 20, "G1", 200],
    );
    const { oils } = parseManagerSheet(rows);
    expect(oils[0].name_type_oil).toBe("моторне оливо");
    expect(oils[1].name_type_oil).toBe("трансмісійне оливо");
  });

  it("колонка «Застосування» ІГНОРУЄТЬСЯ → description завжди порожній", () => {
    const rows = sheet(
      ["МОТОРНІ ОЛИВИ", null, null, null, null, null, null, null],
      ["Oil Z", "DAF", "Довгий опис застосування", "Синтетична", "ACEA E7", 208, "Z1", 100],
    );
    const { oils } = parseManagerSheet(rows);
    expect(oils[0].description).toBe("");
  });

  it("варіант без ціни/об'єму → пропускається (skipped)", () => {
    const rows = sheet(
      ["МОТОРНІ ОЛИВИ", null, null, null, null, null, null, null],
      ["Oil X", "DAF", null, "Синтетична", "ACEA E7", null, "ART", null], // нема ціни й обєму
    );
    const { oils, skipped } = parseManagerSheet(rows);
    expect(oils).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it("той самий товар без артикулу → стабільний синтетичний артикул (ідемпотентність)", () => {
    const a1 = syntheticArticul("DAF", "Daf Xtreme 10w30", 208);
    const a2 = syntheticArticul("DAF", "Daf Xtreme 10w30", 208);
    expect(a1).toBe(a2);
    expect(syntheticArticul("DAF", "Daf Xtreme 10w30", 20)).not.toBe(a1);
  });
});

describe("Manager helpers", () => {
  it("extractSAE: різні написання", () => {
    expect(extractSAE("Daf Xtreme 10w30")).toBe("10W-30");
    expect(extractSAE("Mobil 5w-40")).toBe("5W-40");
    expect(extractSAE("Gear 75W-90")).toBe("75W-90");
    expect(extractSAE("Без вязкості")).toBeNull();
  });
  it("mapTypeOil", () => {
    expect(mapTypeOil("Синтетична")).toBe("синтетичне");
    expect(mapTypeOil("Напівсинтетична")).toBe("напівсинтетичне");
    expect(mapTypeOil("мінеральне")).toBe("мінеральне");
    expect(mapTypeOil("")).toBeNull();
  });
});
