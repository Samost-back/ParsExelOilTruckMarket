import { describe, it, expect, vi } from "vitest";
const { DescriptionGenerator } = require("../../../src/integrations/openai/description-generator");

function makeClient(reply = "SEO text") {
  return { chat: vi.fn().mockResolvedValue(reply) };
}

describe("DescriptionGenerator", () => {
  it("кидає помилку без client", () => {
    expect(() => new DescriptionGenerator({})).toThrow(/client required/);
  });

  it("використовує fallback prompt якщо нічого не задано", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({ client });
    await g.generateForOil({ name: "Test 5 л" });
    expect(client.chat).toHaveBeenCalledOnce();
    const arg = client.chat.mock.calls[0][0];
    expect(arg.system).toMatch(/SEO-копірайтер/);
  });

  it("explicit systemPrompt перебиває fallback", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({ client, systemPrompt: "CUSTOM PROMPT" });
    await g.generateForOil({ name: "x" });
    expect(client.chat.mock.calls[0][0].system).toBe("CUSTOM PROMPT");
  });

  it("promptResolver має пріоритет над systemPrompt", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({
      client,
      systemPrompt: "STATIC",
      promptResolver: async () => "DYNAMIC FROM DB",
    });
    await g.generateForOil({ name: "x" });
    expect(client.chat.mock.calls[0][0].system).toBe("DYNAMIC FROM DB");
  });

  it("якщо promptResolver повертає null → fallback на systemPrompt", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({
      client,
      systemPrompt: "FALLBACK",
      promptResolver: async () => null,
    });
    await g.generateForOil({ name: "x" });
    expect(client.chat.mock.calls[0][0].system).toBe("FALLBACK");
  });

  it("user-message містить ВСІ ключові поля з row", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({ client });
    await g.generateForOil({
      name: "Моторна олива EUROLUB SUPER ECO 0W-20 | 1 л",
      company_name: "EUROLUB",
      name_type_oil: "моторне оливо",
      type_oil: "синтетичне",
      viscosity_sae: "0W-20",
      articul: "226001",
      packaging_volume: 1,
      acea: ["A1/B1", "C5"],
      api: "SN, SN Plus",
      car_brand: ["BMW", "Mercedes-Benz"],
      manufacturers_tolerances: "BMW Longlife-17 FE+",
      low_level_saps: true,
    });
    const user = client.chat.mock.calls[0][0].user;
    expect(user).toMatch(/Назва товару:.+EUROLUB SUPER ECO/);
    expect(user).toMatch(/Бренд: EUROLUB/);
    expect(user).toMatch(/Категорія: моторне оливо/);
    expect(user).toMatch(/Тип оливи: синтетичне/);
    expect(user).toMatch(/В'язкість SAE: 0W-20/);
    expect(user).toMatch(/Артикул: 226001/);
    expect(user).toMatch(/Об'єм упаковки: 1 л/);
    expect(user).toMatch(/ACEA: A1\/B1, C5/);
    expect(user).toMatch(/API: SN, SN Plus/);
    expect(user).toMatch(/Сумісні марки авто: BMW, Mercedes-Benz/);
    expect(user).toMatch(/Низький рівень SAPS: так/);
    expect(user).toMatch(/Допуски виробників: BMW Longlife-17 FE\+/);
  });

  it("замінює '|' у назві на ' — '", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({ client });
    await g.generateForOil({ name: "A | B | C" });
    expect(client.chat.mock.calls[0][0].user).toMatch(/Назва товару: A — B — C/);
  });

  it("порожні/null поля не потрапляють у user-message", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({ client });
    await g.generateForOil({
      name: "Test",
      company_name: null,
      type_oil: "",
      acea: [],
      car_brand: null,
    });
    const user = client.chat.mock.calls[0][0].user;
    expect(user).not.toMatch(/Бренд:/);
    expect(user).not.toMatch(/Тип оливи:/);
    expect(user).not.toMatch(/ACEA:/);
    expect(user).not.toMatch(/Сумісні марки авто:/);
  });

  it("low_level_saps false → 'ні'", async () => {
    const client = makeClient();
    const g = new DescriptionGenerator({ client });
    await g.generateForOil({ name: "x", low_level_saps: false });
    expect(client.chat.mock.calls[0][0].user).toMatch(/Низький рівень SAPS: ні/);
  });

  it("повертає результат chat() без модифікації", async () => {
    const client = makeClient("Generated SEO description here");
    const g = new DescriptionGenerator({ client });
    const result = await g.generateForOil({ name: "x" });
    expect(result).toBe("Generated SEO description here");
  });
});
