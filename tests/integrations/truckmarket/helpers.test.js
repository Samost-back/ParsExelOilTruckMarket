import { describe, it, expect } from "vitest";
const { findBrandId, carBrandsToBitmask } = require("../../../src/integrations/truckmarket/helpers");

describe("findBrandId", () => {
  it("матчить точну назву бренду", () => {
    expect(findBrandId("Castrol")).toBe(2);
    expect(findBrandId("Eurolub")).toBe(14);
  });

  it("case-insensitive", () => {
    expect(findBrandId("EUROLUB")).toBe(14);
    expect(findBrandId("eurolub")).toBe(14);
    expect(findBrandId("EuRoLuB")).toBe(14);
  });

  it("ігнорує зайві пробіли", () => {
    expect(findBrandId("  Eurolub  ")).toBe(14);
  });

  it("повертає null для невідомого бренду", () => {
    expect(findBrandId("UnknownBrand")).toBeNull();
    expect(findBrandId("")).toBeNull();
    expect(findBrandId(null)).toBeNull();
    expect(findBrandId(undefined)).toBeNull();
  });

  it("матчить багатослівні назви", () => {
    expect(findBrandId("Liqui Moly")).toBe(3);
    expect(findBrandId("Shell Helix")).toBe(4);
    expect(findBrandId("Total / TotalEnergies")).toBe(5);
  });
});

describe("carBrandsToBitmask", () => {
  it("порожній масив → 0", () => {
    expect(carBrandsToBitmask([])).toBe(0);
  });

  it("non-array → 0", () => {
    expect(carBrandsToBitmask(null)).toBe(0);
    expect(carBrandsToBitmask(undefined)).toBe(0);
    expect(carBrandsToBitmask("BMW")).toBe(0);
  });

  it("один бренд → bit", () => {
    expect(carBrandsToBitmask(["BMW"])).toBe(1);
  });

  it("комбінує бренди через OR", () => {
    // BMW=1, Mercedes-Benz=2, Ford=64
    expect(carBrandsToBitmask(["BMW", "Mercedes-Benz", "Ford"])).toBe(1 | 2 | 64);
  });

  it("нормалізує Opel/Vauxhall → Opel", () => {
    // У CAR_BRAND_NAME_NORMALIZATION: Opel/Vauxhall → Opel (id=1024)
    expect(carBrandsToBitmask(["Opel/Vauxhall"])).toBe(1024);
  });

  it("ігнорує невідомі бренди", () => {
    expect(carBrandsToBitmask(["BMW", "UnknownBrand", "Ford"])).toBe(1 | 64);
  });

  it("не дублює біти при повторі", () => {
    expect(carBrandsToBitmask(["BMW", "BMW"])).toBe(1);
  });
});
