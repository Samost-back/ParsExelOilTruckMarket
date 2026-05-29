import { describe, it, expect } from "vitest";
const { encode } = require("../../../src/integrations/truckmarket/mapping/field-encoders");

const SAE_OPTS = { "0W-20": 2, "5W-30": 5 };
const TYPE_OPTS = { "синтетичне": 3, "напівсинтетичне": 1 };
const VOLUME_OPTS = { 1: 4, 5: 9, 20: 13 };

describe("encode (field-encoders)", () => {
  const optionsByField = {
    f1: TYPE_OPTS,
    f2: SAE_OPTS,
    f4: VOLUME_OPTS,
  };

  it("text kind повертає raw значення", () => {
    const warnings = [];
    const r = encode("Артикул", "f22", { articul: "12345" }, optionsByField, warnings);
    expect(r).toBe("12345");
    expect(warnings).toEqual([]);
  });

  it("text kind з масивом → joinIfArray", () => {
    const warnings = [];
    const r = encode("ACEA", "f24", { acea: ["A1", "B1"] }, optionsByField, warnings);
    expect(r).toBe("A1, B1");
  });

  it("text kind повертає null для пустої/null", () => {
    const warnings = [];
    expect(encode("Артикул", "f22", { articul: "" }, optionsByField, warnings)).toBeNull();
    expect(encode("Артикул", "f22", { articul: null }, optionsByField, warnings)).toBeNull();
  });

  it("select kind → id з мапи", () => {
    const warnings = [];
    const r = encode("В'язкість SAE", "f2", { viscosity_sae: "0W-20" }, optionsByField, warnings);
    expect(r).toBe(2);
    expect(warnings).toEqual([]);
  });

  it("select kind: невідоме значення → null + warning", () => {
    const warnings = [];
    const r = encode("В'язкість SAE", "f2", { viscosity_sae: "75W-90" }, optionsByField, warnings);
    expect(r).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/75W-90.*не в опціях/);
  });

  it("select kind: id=null у мапі → warning 'не підтверджено'", () => {
    const warnings = [];
    const r = encode("В'язкість SAE", "f2",
      { viscosity_sae: "30W" },
      { f2: { "30W": null } }, warnings);
    expect(r).toBeNull();
    expect(warnings[0]).toMatch(/30W.*не підтверджено/);
  });

  it("Об'єм упаковки: Number-каст з рядка", () => {
    const warnings = [];
    const r = encode("Об'єм упаковки, л", "f4", { packaging_volume: "5" }, optionsByField, warnings);
    expect(r).toBe(9);
  });

  it("Об'єм упаковки null → null без warning", () => {
    const warnings = [];
    const r = encode("Об'єм упаковки, л", "f4", { packaging_volume: null }, optionsByField, warnings);
    expect(r).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("Низький рівень SAPS: false → lookup", () => {
    const warnings = [];
    const r = encode("Низький рівень SAPS", "f3",
      { low_level_saps: false }, { f3: { true: 2, false: 1 } }, warnings);
    expect(r).toBe(1);
  });

  it("Низький рівень SAPS: null → null без warning", () => {
    const warnings = [];
    const r = encode("Низький рівень SAPS", "f3",
      { low_level_saps: null }, { f3: { true: 2, false: 1 } }, warnings);
    expect(r).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("bitmask kind: масив брендів", () => {
    const warnings = [];
    const r = encode("Марки авто", "f5",
      { car_brand: ["BMW", "Ford"] }, optionsByField, warnings);
    expect(r).toBe(1 | 64);
  });

  it("bitmask: порожній масив → null", () => {
    const warnings = [];
    const r = encode("Марки авто", "f5", { car_brand: [] }, optionsByField, warnings);
    expect(r).toBeNull();
  });

  it("brand kind: знайдено → id", () => {
    const warnings = [];
    const r = encode("Бренд", "f7", { company_name: "EUROLUB" }, optionsByField, warnings);
    expect(r).toBe(14);
  });

  it("brand kind: не знайдено → null + warning", () => {
    const warnings = [];
    const r = encode("Бренд", "f7", { company_name: "NoSuchCompany" }, optionsByField, warnings);
    expect(r).toBeNull();
    expect(warnings[0]).toMatch(/NoSuchCompany.*не в TruckMarket-брендах/);
  });

  it("невідоме поле → null", () => {
    const warnings = [];
    const r = encode("UnknownField", "f99", {}, optionsByField, warnings);
    expect(r).toBeNull();
  });
});
