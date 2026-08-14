// Регресія: ціна 0 не повинна потрапляти в БД і в оголошення на TruckMarket.
//
// Передісторія: у списку олив були позиції з «0 ₴» (мастила, антифризи,
// моторні). Причина — порожня/зламана клітинка «Рекомендована ціна» в Excel
// повертає 0 (а не null), і перевірка `price != null` такий 0 пропускала.
// Додатково округлення Math.round(p/10)*10 перетворювало дрібну ціну на 0.
import { describe, it, expect } from "vitest";
const { normalizePrice, parseManagerSheet } = require("../../src/parser/manager/parse");

const HEADER = ["Заголовок", "Бренд", "Застосування", "Група", "Специфікації", "Упаковка л", "Артикул", "Ціна"];

describe("normalizePrice — 0 це не ціна", () => {
  it("0 → null (порожня формула в Excel дає 0)", () => {
    expect(normalizePrice(0)).toBeNull();
  });

  it("від'ємна ціна → null", () => {
    expect(normalizePrice(-5)).toBeNull();
  });

  it("null / undefined / NaN → null", () => {
    expect(normalizePrice(null)).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
    expect(normalizePrice(NaN)).toBeNull();
  });

  it("додатна ціна лишається (округлена до цілого)", () => {
    expect(normalizePrice(1630.4)).toBe(1630);
    expect(normalizePrice(2151.3063975)).toBe(2151);
  });

  it("дрібна додатна ціна не схлопується в 0", () => {
    expect(normalizePrice(0.4)).toBe(1);
    expect(normalizePrice(1)).toBe(1);
  });
});

describe("parseManagerSheet — рядки з нульовою ціною", () => {
  it("товар із ціною 0 не отримує price=0 (лишається null)", () => {
    const rows = [
      HEADER,
      ["Моторні оливи", null, null, null, null, null, null, null],
      ["Test Oil 10W-40", "ACME", null, "Синтетичне", null, 5, "A-100", 0],
    ];
    const { oils } = parseManagerSheet(rows);
    expect(oils).toHaveLength(1);
    expect(oils[0].price).toBeNull();
    expect(oils[0].price).not.toBe(0);
  });

  it("товар зі звичайною ціною парситься як є", () => {
    const rows = [
      HEADER,
      ["Моторні оливи", null, null, null, null, null, null, null],
      ["Test Oil 10W-40", "ACME", null, "Синтетичне", null, 5, "A-101", 1234.6],
    ];
    const { oils } = parseManagerSheet(rows);
    expect(oils[0].price).toBe(1235);
  });
});
