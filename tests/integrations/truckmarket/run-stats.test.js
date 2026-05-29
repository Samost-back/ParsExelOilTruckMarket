import { describe, it, expect } from "vitest";
const { RunStats } = require("../../../src/integrations/truckmarket/reporting/run-stats");

const row = (id, type = "моторне оливо") => ({ id, name_type_oil: type, name: `n${id}` });

describe("RunStats", () => {
  it("порожній стан → нульові каунти", () => {
    const s = new RunStats();
    const table = s.summaryTable();
    expect(table.every(r => r.count === 0)).toBe(true);
  });

  it("addCreated: рахує фото", () => {
    const s = new RunStats();
    s.addCreated(row(1), 100, { uploaded: 3, failed: [{ file: "a" }] });
    s.addCreated(row(2), 101, { uploaded: 2, failed: [] });

    const t = s.summaryTable();
    expect(t.find(r => r.status === "✓ created").count).toBe(2);
    expect(t.find(r => r.status === "📷 photos uploaded").count).toBe(5);
    expect(t.find(r => r.status === "📷 photos failed").count).toBe(1);
  });

  it("розрізняє типи помилок", () => {
    const s = new RunStats();
    s.addBlacklist(row(1, "антифриз"));
    s.addNoIntegration(row(2, "невідомий"));
    s.addMappingError(row(3), "no mapping");
    s.addApiError(row(4), "TM 500");
    const t = s.summaryTable();
    expect(t.find(r => r.status === "⊘ blacklist").count).toBe(1);
    expect(t.find(r => r.status === "⊘ no_integration").count).toBe(1);
    expect(t.find(r => r.status === "✗ mapping_error").count).toBe(1);
    expect(t.find(r => r.status === "✗ api_error").count).toBe(1);
  });

  it("byTypeTable: групує по name_type_oil", () => {
    const s = new RunStats();
    s.addCreated(row(1, "моторне оливо"), 1, { uploaded: 0, failed: [] });
    s.addCreated(row(2, "моторне оливо"), 2, { uploaded: 0, failed: [] });
    s.addCreated(row(3, "гідравлічне оливо"), 3, { uploaded: 0, failed: [] });
    s.addBlacklist(row(4, "мастило"));

    const t = s.byTypeTable();
    expect(t["моторне оливо"].created).toBe(2);
    expect(t["гідравлічне оливо"].created).toBe(1);
    expect(t["мастило"].blacklist).toBe(1);
  });

  it("errorList: повертає mapping + api errors", () => {
    const s = new RunStats();
    s.addMappingError(row(3), "m");
    s.addApiError(row(4), "a");
    const errs = s.errorList();
    expect(errs).toHaveLength(2);
    expect(errs.map(e => e.reason)).toEqual(["m", "a"]);
  });
});
