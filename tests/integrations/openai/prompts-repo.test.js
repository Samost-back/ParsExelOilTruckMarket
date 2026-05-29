import { describe, it, expect, vi } from "vitest";
const { PromptsRepo } = require("../../../src/integrations/openai/prompts-repo");

function makeDb() {
  return { query: vi.fn() };
}

describe("PromptsRepo", () => {
  it("list", async () => {
    const db = makeDb();
    db.query.mockResolvedValue({ rows: [{ id: 1, name: "x" }] });
    const r = await new PromptsRepo(db).list();
    expect(r).toEqual([{ id: 1, name: "x" }]);
    expect(db.query.mock.calls[0][0]).toMatch(/SELECT[\s\S]+ai_prompts[\s\S]+ORDER BY/);
  });

  it("findDefault", async () => {
    const db = makeDb();
    db.query.mockResolvedValue({ rows: [{ id: 42, body: "p" }] });
    expect(await new PromptsRepo(db).findDefault()).toEqual({ id: 42, body: "p" });
  });

  it("create без makeDefault — повертає id", async () => {
    const db = makeDb();
    db.query.mockResolvedValue({ rows: [{ id: 7 }] });
    const id = await new PromptsRepo(db).create({ name: "n", body: "b", makeDefault: false });
    expect(id).toBe(7);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("create з makeDefault — додатково setDefault (3 queries в транзакції)", async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 8 }] })
      .mockResolvedValueOnce({})  // BEGIN
      .mockResolvedValueOnce({})  // UPDATE all to false
      .mockResolvedValueOnce({})  // UPDATE id to true
      .mockResolvedValueOnce({}); // COMMIT
    const id = await new PromptsRepo(db).create({ name: "n", body: "b", makeDefault: true });
    expect(id).toBe(8);
    // 1 INSERT + 4 для setDefault transaction
    expect(db.query).toHaveBeenCalledTimes(5);
  });

  it("setDefault rollback при помилці", async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error("update failed"))
      .mockResolvedValueOnce({}); // ROLLBACK
    await expect(new PromptsRepo(db).setDefault(5)).rejects.toThrow("update failed");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
  });
});
