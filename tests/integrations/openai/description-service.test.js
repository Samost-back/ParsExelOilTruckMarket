import { describe, it, expect, vi } from "vitest";
const { DescriptionService } = require("../../../src/integrations/openai/description-service");

function makeRepo() {
  return {
    setAiDescriptionDone: vi.fn().mockResolvedValue(),
    setAiDescriptionFailed: vi.fn().mockResolvedValue(),
  };
}

describe("DescriptionService.ensureFor", () => {
  it("кеш: якщо row.ai_description вже є → не дзвонить generator", async () => {
    const generator = { generateForOil: vi.fn() };
    const repo = makeRepo();
    const svc = new DescriptionService({ generator, repo });

    const result = await svc.ensureFor({ id: 1, ai_description: "cached text" });
    expect(result).toEqual({ text: "cached text" });
    expect(generator.generateForOil).not.toHaveBeenCalled();
    expect(repo.setAiDescriptionDone).not.toHaveBeenCalled();
  });

  it("успіх: генерує, записує в БД, повертає {text}", async () => {
    const generator = { generateForOil: vi.fn().mockResolvedValue("new text") };
    const repo = makeRepo();
    const svc = new DescriptionService({ generator, repo });

    const result = await svc.ensureFor({ id: 42, ai_description: null });
    expect(result).toEqual({ text: "new text" });
    expect(generator.generateForOil).toHaveBeenCalledOnce();
    expect(repo.setAiDescriptionDone).toHaveBeenCalledWith(42, "new text");
    expect(repo.setAiDescriptionFailed).not.toHaveBeenCalled();
  });

  it("failure: НЕ кидає, повертає {error}, пише в БД", async () => {
    const generator = { generateForOil: vi.fn().mockRejectedValue(new Error("OpenAI 401")) };
    const repo = makeRepo();
    const svc = new DescriptionService({ generator, repo });

    const result = await svc.ensureFor({ id: 42, ai_description: null });
    expect(result).toEqual({ error: "OpenAI 401" });
    expect(repo.setAiDescriptionDone).not.toHaveBeenCalled();
    expect(repo.setAiDescriptionFailed).toHaveBeenCalledWith(42, "OpenAI 401");
  });
});
