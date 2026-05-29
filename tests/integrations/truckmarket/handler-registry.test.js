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

  it("blacklist (з constants) має пріоритет", () => {
    const reg = new HandlerRegistry();
    const handler = { label: "x", handle() {} };
    reg.register(["мастило", "моторне оливо"], handler);
    // мастило у blacklist — не повинно бути в map
    const d = reg.pick("мастило");
    expect(d.route).toBe("blacklist");
  });

  it("невідомий тип → no_integration", () => {
    const reg = new HandlerRegistry();
    const d = reg.pick("щось дивне");
    expect(d.route).toBe("no_integration");
  });

  it("registeredTypes повертає тільки eligible", () => {
    const reg = new HandlerRegistry();
    const h = { label: "x", handle() {} };
    reg.register(["моторне оливо", "трансмісійне оливо", "антифриз"], h);
    expect(reg.registeredTypes()).toEqual(["моторне оливо", "трансмісійне оливо"]);
  });
});

describe("buildDefaultRegistry", () => {
  it("реєструє моторне/трансмісійне/гідравлічне з TYPE_OIL_TO_TRUCKMARKET_CATEGORY", () => {
    const handler = { label: "TM", handle() {} };
    const reg = buildDefaultRegistry({ truckMarketHandler: handler });
    expect(reg.pick("моторне оливо").handler).toBe(handler);
    expect(reg.pick("трансмісійне оливо").handler).toBe(handler);
    expect(reg.pick("гідравлічне оливо").handler).toBe(handler);
    expect(reg.pick("антифриз").route).toBe("blacklist");
    expect(reg.pick("мастило").route).toBe("blacklist");
  });
});
