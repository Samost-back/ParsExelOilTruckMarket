import { describe, it, expect } from "vitest";
const { buildPlateItems, plateSvg, buildPlatesSvg } = require("../../src/photos/process/plates.cjs");

const PP = { left: 531, top: 27, width: 133, height: 23 };
const base = { pp: PP, volLabel: "208 л", country: "Німеччина", packagingVolume: 208, coverallVolume: 208 };
const labels = (r) => r.items.map((i) => i.label);

describe("buildPlateItems — які плашки малювати", () => {
  it("Manager (noCountry): ТІЛЬКИ об'єм, без комбінезона й країни", () => {
    const r = buildPlateItems({ ...base, noCountry: true });
    expect(labels(r)).toEqual(["208 л"]);
    expect(labels(r)).not.toContain("Комбінезон");
    expect(labels(r)).not.toContain("Німеччина");
  });

  it("Manager 208л: навіть для coverall-об'єму комбінезона НЕ додаємо", () => {
    const r = buildPlateItems({ ...base, packagingVolume: 208, noCountry: true });
    expect(labels(r)).toEqual(["208 л"]);
  });

  it("EUROLUB 208л: об'єм + комбінезон + країна", () => {
    const r = buildPlateItems({ ...base, noCountry: false });
    expect(labels(r)).toEqual(["208 л", "Комбінезон", "Німеччина"]);
  });

  it("EUROLUB не-208л: об'єм + країна (без комбінезона)", () => {
    const r = buildPlateItems({ ...base, volLabel: "20 л", packagingVolume: 20, noCountry: false });
    expect(labels(r)).toEqual(["20 л", "Німеччина"]);
  });

  it("EUROLUB без країни: лише об'єм (+комбінезон якщо 208)", () => {
    const r = buildPlateItems({ ...base, country: null, noCountry: false });
    expect(labels(r)).toEqual(["208 л", "Комбінезон"]);
  });

  it("плашки не накладаються: кожна нижче попередньої на step", () => {
    const r = buildPlateItems({ ...base, noCountry: false });
    const tops = r.items.map((i) => i.rect.top);
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  });

  it("coverallVolume порівнюється з округленням packaging_volume", () => {
    const r = buildPlateItems({ ...base, packagingVolume: 207.6, noCountry: false });
    expect(labels(r)).toContain("Комбінезон"); // 207.6 → 208
  });
});

describe("buildPlatesSvg — валідний SVG", () => {
  it("повертає Buffer з усіма мітками й екранованим текстом", () => {
    const r = buildPlateItems({ ...base, noCountry: false });
    const svg = buildPlatesSvg(1000, 800, r.items).toString();
    expect(svg).toContain("<svg");
    expect(svg).toContain("208 л");
    expect(svg).toContain("Комбінезон");
    expect(svg).toContain("Німеччина");
  });

  it("plateSvg екранує спецсимволи (без XSS у SVG)", () => {
    const svg = plateSvg("<b>&\"'", PP);
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).not.toContain("<b>");
  });
});
