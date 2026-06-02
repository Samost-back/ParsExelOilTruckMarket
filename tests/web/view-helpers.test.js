import { describe, it, expect } from "vitest";
const h = require("../../src/web/view-helpers");

describe("view-helpers — переклад статусів", () => {
  it("jobStatusLabel: усі стани web_jobs українською", () => {
    expect(h.jobStatusLabel("pending")).toBe("очікує");
    expect(h.jobStatusLabel("running")).toBe("виконується");
    expect(h.jobStatusLabel("done")).toBe("готово");
    expect(h.jobStatusLabel("failed")).toBe("помилка");
    expect(h.jobStatusLabel("cancelled")).toBe("скасовано");
  });

  it("jobStatusLabel: невідомий статус → повертає як є", () => {
    expect(h.jobStatusLabel("weird")).toBe("weird");
    expect(h.jobStatusLabel(null)).toBe("");
    expect(h.jobStatusLabel(undefined)).toBe("");
  });

  it("jobKindLabel: типи задач українською", () => {
    expect(h.jobKindLabel("import")).toBe("Імпорт / оновлення");
    expect(h.jobKindLabel("integrations-run")).toBe("Публікація на TM");
    expect(h.jobKindLabel("tm-delete")).toBe("Видалення з TM");
    expect(h.jobKindLabel("update-prices")).toBe("Оновлення цін");
    // невідомий → як є
    expect(h.jobKindLabel("custom-kind")).toBe("custom-kind");
  });

  it("truckStatusLabel / photoStatusLabel", () => {
    expect(h.truckStatusLabel("done")).toBe("опубліковано");
    expect(h.truckStatusLabel("outdated")).toBe("застаріло");
    expect(h.photoStatusLabel("done")).toBe("оброблено");
    expect(h.photoStatusLabel("skipped")).toBe("пропущено");
  });

  it("importStepLabel / stepStatusLabel — кроки імпорту", () => {
    expect(h.importStepLabel("parse")).toBe("Парсинг прайсу");
    expect(h.importStepLabel("process-photos")).toBe("Обробка фото");
    expect(h.stepStatusLabel("running")).toBe("виконується");
    expect(h.stepStatusLabel("done")).toBe("готово");
  });
});

describe("view-helpers — дати у Київському часі", () => {
  it("fmtDate: UTC → Київ (+2/+3 залежно від DST)", () => {
    // 2026-06-02 — літо, Київ = UTC+3 → 15:00.
    const s = h.fmtDate("2026-06-02T12:00:00Z");
    expect(s).toContain("02.06.2026");
    expect(s).toContain("15:00");
  });

  it("fmtDate: взимку Київ = UTC+2", () => {
    // 2026-01-15 — зима, Київ = UTC+2 → 14:00.
    const s = h.fmtDate("2026-01-15T12:00:00Z");
    expect(s).toContain("15.01.2026");
    expect(s).toContain("14:00");
  });

  it("fmtDate: порожнє/невалідне → тире", () => {
    expect(h.fmtDate(null)).toBe("—");
    expect(h.fmtDate("")).toBe("—");
    expect(h.fmtDate("not-a-date")).toBe("—");
  });

  it("fmtDate: приймає Date | string | number", () => {
    expect(h.fmtDate(new Date("2026-06-02T12:00:00Z"))).toContain("02.06.2026");
    expect(h.fmtDate(Date.parse("2026-06-02T12:00:00Z"))).toContain("02.06.2026");
  });

  it("fmtDateShort: лише дата без часу", () => {
    const s = h.fmtDateShort("2026-06-02T12:00:00Z");
    expect(s).toContain("02.06.2026");
    expect(s).not.toMatch(/\d{2}:\d{2}/);
  });

  it("TZ дефолт — Europe/Kyiv", () => {
    expect(h.TZ).toBe("Europe/Kyiv");
  });
});
