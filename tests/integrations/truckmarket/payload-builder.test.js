import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.USER_ID = "986";
  process.env.COMPANY_ID = "24";
  process.env.GEO_CITY_ID_DEFAULT = "177";
});

const { buildListingPayload } = require("../../../src/integrations/truckmarket/mapping/payload-builder");

const baseMotorRow = () => ({
  id: 1,
  name_type_oil: "моторне оливо",
  name: "Моторна олива EUROLUB SUPER ECO 0W-20 синтетична | 1 л",
  type_oil: "синтетичне",
  viscosity_sae: "0W-20",
  low_level_saps: false,
  packaging_volume: 1,
  articul: "226001",
  acea: "A1/B1, C5",
  api: "SN, SN Plus",
  manufacturers_tolerances: "ILSAC GF-5; BMW Longlife-17 FE+",
  car_brand: ["BMW", "Mercedes-Benz"],
  quantity: 1000,
  iso_vg_viscosity_grade: null,
  color_liquid: null,
  dot: null,
  company_name: "EUROLUB",
  price: 680,
});

describe("buildListingPayload", () => {
  it("моторне оливо: повний payload", () => {
    const { data, warnings } = buildListingPayload(baseMotorRow());
    expect(data.cat_id).toBe(4263);
    expect(data.user_id).toBe(986);
    expect(data.company).toBe(24);
    expect(data.geo_city).toBe(177);
    expect(data.price).toBe(680);
    expect(data.price_curr).toBe(1);
    expect(data.instock).toBe(1000);
    expect(data.title).toEqual({ uk: expect.stringContaining("EUROLUB SUPER ECO 0W-20") });
    expect(data.descr).toEqual({ uk: "" });
    // Поля
    expect(data.f1).toBe(3);     // тип = синтетичне
    expect(data.f2).toBe(2);     // SAE = 0W-20
    expect(data.f3).toBe(1);     // SAPS low = false → 1
    expect(data.f22).toBe("226001"); // артикул
    expect(data.f6).toBe(4);     // об'єм 1 л → id=4 у новій спільній мапі
    expect(data.f7).toBe(14);    // Eurolub
    expect(data.f5).toBe(1 | 2); // BMW + Mercedes-Benz
    expect(warnings).toEqual([]);
  });

  it("description прокидується у descr.uk", () => {
    const { data } = buildListingPayload(baseMotorRow(), { description: "Custom AI desc" });
    expect(data.descr.uk).toBe("Custom AI desc");
  });

  it("кидає помилку для неіснуючого name_type_oil", () => {
    const row = baseMotorRow();
    row.name_type_oil = "невідомий тип";
    expect(() => buildListingPayload(row)).toThrow(/Немає мапінгу/);
  });

  it("гідравлічне: Бренд тепер f5 (не f7)", () => {
    const { data } = buildListingPayload({
      id: 201,
      name_type_oil: "гідравлічне оливо",
      name: "Гідравлічна олива EUROLUB HLP ISO VG 32 | 20 л",
      packaging_volume: 20,
      articul: "504020",
      iso_vg_viscosity_grade: "ISO VG 32",
      company_name: "EUROLUB",
      price: 6950,
      quantity: 1000,
    });
    expect(data.f5).toBe(14);    // Бренд у 4265 — f5
    expect(data.f7).toBeUndefined(); // f7 більше не використовується
    expect(data.f1).toBe(3);     // ISO VG 32
    expect(data.f4).toBe(13);    // 20 л у спільній мапі
    expect(data.f21).toBe("504020");
  });

  it("трансмісійне з невідомим SAE → warning, без f6", () => {
    const { data, warnings } = buildListingPayload({
      id: 127,
      name_type_oil: "трансмісійне оливо",
      name: "Трансмісійна олива EUROLUB Gear LSL 75W-90 | 1 л",
      viscosity_sae: "75W-90",
      packaging_volume: 1,
      articul: "383001",
      manufacturers_tolerances: "MIL-L 2105 D",
      api: "GL-4 /GL-5",
      company_name: "EUROLUB",
      price: 930,
      quantity: 1000,
    });
    expect(data.f6).toBeUndefined(); // 75W-90 у моторній шкалі немає
    expect(warnings.some(w => /SAE.*75W-90.*не в опціях/.test(w))).toBe(true);
    expect(data.f4).toBe(4);     // об'єм 1 л → id=4
    expect(data.f7).toBe(14);    // Бренд (трансмісійні мають f7)
  });

  it("null fields не потрапляють у payload", () => {
    const row = baseMotorRow();
    row.acea = null;
    row.api = null;
    row.low_level_saps = null;
    row.car_brand = null;
    const { data } = buildListingPayload(row);
    expect(data.f24).toBeUndefined();
    expect(data.f25).toBeUndefined();
    expect(data.f3).toBeUndefined();
    expect(data.f5).toBeUndefined();
  });

  it("respects TRUCKMARKET_IGNORED_FIELDS для мастил 4253", () => {
    // type "мастило" → 4253. "Тип основи" в ignored → не повинно потрапити в warnings.
    // Це регрес-тест на нашу старішу логіку.
    const { warnings } = buildListingPayload({
      id: 99,
      name_type_oil: "мастило",
      name: "Мастило EUROLUB | 1 кг",
      packaging_volume: 1,
      articul: "001001",
      company_name: "EUROLUB",
      price: 100,
      quantity: 1,
    });
    expect(warnings.every(w => !/Тип основи/.test(w))).toBe(true);
  });
});
