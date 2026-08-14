import { describe, it, expect } from "vitest";
const { HandlerRegistry, buildDefaultRegistry } = require("../../../src/integrations/truckmarket/handlers/handler-registry");

describe("HandlerRegistry", () => {
  it("register + pick", () => {
    const reg = new HandlerRegistry();
    const handler = { label: "x", handle() {} };
    reg.register(["моторне оливо"], handler);
    const d = reg.pick("моторне оливо");
    expect(d.route).toBe("dispatch");
    expect(d.handler).toBe(handler);
  });

  // TYPE_OIL_BLACKLIST зараз порожній (усі 7 типів змаплені), тому перевіряємо
  // сам механізм на явно переданому списку, а не на конкретному типі оливи.
  it("blacklist має пріоритет над register()", () => {
    const blacklist = new Set(["мастило"]);
    const reg = new HandlerRegistry({ blacklist });
    const handler = { label: "x", handle() {} };
    reg.register(["мастило", "моторне оливо"], handler);
    expect(reg.pick("мастило").route).toBe("blacklist");
    expect(reg.pick("моторне оливо").route).toBe("dispatch");
  });

  it("невідомий тип → no_integration", () => {
    const reg = new HandlerRegistry();
    const d = reg.pick("щось дивне");
    expect(d.route).toBe("no_integration");
  });

  it("registeredTypes повертає тільки eligible", () => {
    const reg = new HandlerRegistry({ blacklist: new Set(["антифриз"]) });
    const h = { label: "x", handle() {} };
    reg.register(["моторне оливо", "трансмісійне оливо", "антифриз"], h);
    expect(reg.registeredTypes()).toEqual(["моторне оливо", "трансмісійне оливо"]);
  });
});

describe("buildDefaultRegistry", () => {
  it("реєструє всі типи з TYPE_OIL_TO_TRUCKMARKET_CATEGORY", () => {
    const handler = { label: "TM", handle() {} };
    const reg = buildDefaultRegistry({ truckMarketHandler: handler });
    for (const t of [
      "моторне оливо", "трансмісійне оливо", "гідравлічне оливо",
      "гальмівна рідина", "антифриз", "мастило", "індустріальне оливо",
    ]) {
      expect(reg.pick(t).handler, t).toBe(handler);
    }
    expect(reg.pick("щось дивне").route).toBe("no_integration");
  });
});
