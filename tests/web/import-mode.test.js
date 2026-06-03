import { describe, it, expect } from "vitest";
const { resolveCompany, validateImport } = require("../../src/web/routes/import.routes");

describe("resolveCompany — режим визначає, як обрано компанію", () => {
  it("add: бере companyNew", () => {
    const r = resolveCompany({ mode: "add", companyNew: "NEWCO", companyExisting: "X" });
    expect(r).toEqual({ importMode: "add", company: "NEWCO" });
  });

  it("update: бере companyExisting", () => {
    const r = resolveCompany({ mode: "update", companyNew: "X", companyExisting: "EUROLUB" });
    expect(r).toEqual({ importMode: "update", company: "EUROLUB" });
  });

  it("невідомий/порожній mode → трактується як add", () => {
    expect(resolveCompany({ companyNew: "A" }).importMode).toBe("add");
    expect(resolveCompany({ mode: "weird", companyNew: "A" }).importMode).toBe("add");
  });

  it("легасі-поле company як fallback в обох режимах", () => {
    expect(resolveCompany({ mode: "add", company: "LEGACY" }).company).toBe("LEGACY");
    expect(resolveCompany({ mode: "update", company: "LEGACY" }).company).toBe("LEGACY");
  });

  it("обрізає пробіли", () => {
    expect(resolveCompany({ mode: "add", companyNew: "  A  " }).company).toBe("A");
  });
});

describe("validateImport — правила add/update", () => {
  const base = { importMode: "add", company: "CO", hasXlsx: true, hasPhotos: false, companyExists: false };

  it("ok: add з xlsx", () => {
    expect(validateImport(base)).toEqual({ ok: true });
  });

  it("ok: add з фото (нова компанія + фото — теж дозволено)", () => {
    expect(validateImport({ ...base, hasXlsx: false, hasPhotos: true, companyExists: true }))
      .toEqual({ ok: true });
  });

  it("помилка: немає назви компанії", () => {
    const r = validateImport({ ...base, company: "" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(400);
    expect(r.error).toContain("назва нової компанії");
  });

  it("помилка: update без вибору компанії", () => {
    const r = validateImport({ ...base, importMode: "update", company: "" });
    expect(r.error).toContain("Виберіть компанію");
  });

  it("помилка: ні xlsx, ні фото", () => {
    const r = validateImport({ ...base, hasXlsx: false, hasPhotos: false });
    expect(r.error).toContain("xlsx або папка");
  });

  it("помилка: update, але компанії немає в БД", () => {
    const r = validateImport({ ...base, importMode: "update", company: "GHOST", companyExists: false });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"GHOST" не знайдена');
    expect(r.error).toContain("Додати нову");
  });

  it("ok: update наявної компанії", () => {
    expect(validateImport({ ...base, importMode: "update", companyExists: true }))
      .toEqual({ ok: true });
  });

  it("помилка: тільки фото до неіснуючої компанії", () => {
    const r = validateImport({ ...base, hasXlsx: false, hasPhotos: true, companyExists: false });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("лише фото");
  });

  it("ok: тільки фото до наявної компанії", () => {
    expect(validateImport({ ...base, hasXlsx: false, hasPhotos: true, companyExists: true }))
      .toEqual({ ok: true });
  });

  it("ok: update з xlsx+фото до наявної", () => {
    expect(validateImport({ importMode: "update", company: "CO", hasXlsx: true, hasPhotos: true, companyExists: true }))
      .toEqual({ ok: true });
  });
});
