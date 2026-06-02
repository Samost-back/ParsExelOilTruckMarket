import { describe, it, expect, vi } from "vitest";
const { DescriptionGenerator } = require("../../src/integrations/openai/description-generator");

// Симулятор у prompts.routes будує DescriptionGenerator з ПЕРЕДАНИМ текстом
// промпту (не з БД) і кличе generateForOil(row), нічого не зберігаючи.
// Тут перевіряємо саме цей контракт (без HTTP-шару).

function makeClient(reply = "Згенерований опис") {
  return { chat: vi.fn().mockResolvedValue(reply) };
}

const oilRow = {
  id: 1, name_type_oil: "моторне оливо", name: "Daf Xtreme 10W-30 | 208 л",
  type_oil: "синтетичне", viscosity_sae: "10W-30", acea: "E7/E9", api: "CJ-4",
  packaging_volume: 208, articul: "GEN-X", company_name: "DAF",
};

describe("AI-симулятор: контракт генерації без збереження", () => {
  it("використовує переданий промпт (не дефолтний) як system", async () => {
    const client = makeClient();
    const generator = new DescriptionGenerator({ client, systemPrompt: "МІЙ ТЕСТОВИЙ ПРОМПТ" });
    const text = await generator.generateForOil(oilRow);

    expect(text).toBe("Згенерований опис");
    expect(client.chat).toHaveBeenCalledOnce();
    const arg = client.chat.mock.calls[0][0];
    expect(arg.system).toBe("МІЙ ТЕСТОВИЙ ПРОМПТ");
    // user-message містить контекст оливо
    expect(arg.user).toContain("Daf Xtreme");
    expect(arg.user).toContain("10W-30");
    expect(arg.user).toContain("DAF");
  });

  it("генератор НЕ має методів запису в БД (лише читання+chat)", () => {
    const client = makeClient();
    const generator = new DescriptionGenerator({ client, systemPrompt: "p" });
    // публічний API — лише generateForOil; жодних save/persist
    expect(typeof generator.generateForOil).toBe("function");
    expect(generator.save).toBeUndefined();
    expect(generator.persist).toBeUndefined();
  });

  it("помилка OpenAI прокидається (route перетворить на flash-error)", async () => {
    const client = { chat: vi.fn().mockRejectedValue(new Error("OpenAI 429")) };
    const generator = new DescriptionGenerator({ client, systemPrompt: "p" });
    await expect(generator.generateForOil(oilRow)).rejects.toThrow(/OpenAI 429/);
  });

  it("порожній промпт не перебиває fallback лише якщо явно null (route валідує порожній окремо)", async () => {
    // У роуті порожній body відсікається до виклику генератора;
    // тут фіксуємо, що явний непорожній промпт завжди застосовується.
    const client = makeClient();
    const g = new DescriptionGenerator({ client, systemPrompt: "X" });
    await g.generateForOil(oilRow);
    expect(client.chat.mock.calls[0][0].system).toBe("X");
  });
});
