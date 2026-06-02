import { describe, it, expect, vi } from "vitest";
const { TruckMarketHandler } = require("../../../src/integrations/truckmarket/handlers/truckmarket-handler");

function makeServices(overrides = {}) {
  return {
    publishService: { publish: vi.fn().mockResolvedValue({ listingId: 1000, warnings: [] }) },
    photoService: { uploadAllFor: vi.fn().mockResolvedValue({ uploaded: 2, failed: [] }) },
    descriptionService: { ensureFor: vi.fn().mockResolvedValue({ text: "AI desc" }) },
    oilsRepo: {
      markTruckInProgress: vi.fn().mockResolvedValue(),
      markTruckFailed: vi.fn().mockResolvedValue(),
      // за замовчуванням є фото (1) — щоб не блокувати наявні сценарії
      countUploadablePhotos: vi.fn().mockResolvedValue(1),
    },
    ...overrides,
  };
}

describe("TruckMarketHandler.handle", () => {
  it("щасливий шлях: in_progress → description → publish → photos", async () => {
    const s = makeServices();
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });

    expect(s.oilsRepo.markTruckInProgress).toHaveBeenCalledWith(5);
    expect(s.descriptionService.ensureFor).toHaveBeenCalledOnce();
    expect(s.publishService.publish).toHaveBeenCalledWith({ id: 5 }, { description: "AI desc" });
    expect(s.photoService.uploadAllFor).toHaveBeenCalledWith({ oilsId: 5, listingId: 1000 });
    expect(result).toEqual({
      status: "created",
      listingId: 1000,
      warnings: [],
      photos: { uploaded: 2, failed: [] },
    });
    expect(s.oilsRepo.markTruckFailed).not.toHaveBeenCalled();
  });

  it("description error → warning + публікація все одно продовжується", async () => {
    const s = makeServices({
      descriptionService: { ensureFor: vi.fn().mockResolvedValue({ error: "OpenAI 500" }) },
    });
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });

    expect(result.status).toBe("created");
    expect(result.warnings).toContain("AI description: OpenAI 500");
    // publish викликався з description=undefined
    expect(s.publishService.publish.mock.calls[0][1]).toEqual({ description: undefined });
  });

  it("без descriptionService — пропускає опис, без warning", async () => {
    const s = makeServices({ descriptionService: null });
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });
    expect(result.status).toBe("created");
    expect(result.warnings).toEqual([]);
  });

  it("publish помилка 'Немає мапінгу' → mapping_error", async () => {
    const s = makeServices({
      publishService: { publish: vi.fn().mockRejectedValue(new Error('Немає мапінгу name_type_oil="невідоме"')) },
    });
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });

    expect(result.status).toBe("mapping_error");
    expect(result.reason).toMatch(/Немає мапінгу/);
    expect(s.oilsRepo.markTruckFailed).toHaveBeenCalledWith(5, expect.stringContaining("Немає мапінгу"));
    expect(s.photoService.uploadAllFor).not.toHaveBeenCalled();
  });

  it("publish помилка інша → api_error", async () => {
    const s = makeServices({
      publishService: { publish: vi.fn().mockRejectedValue(new Error("TM 500")) },
    });
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });

    expect(result.status).toBe("api_error");
    expect(result.reason).toBe("TM 500");
    expect(s.oilsRepo.markTruckFailed).toHaveBeenCalledWith(5, "TM 500");
  });

  it("description error додається у warnings навіть якщо publish успіх", async () => {
    const s = makeServices({
      descriptionService: { ensureFor: vi.fn().mockResolvedValue({ error: "rate limit" }) },
      publishService: { publish: vi.fn().mockResolvedValue({ listingId: 100, warnings: ["existing warn"] }) },
    });
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });
    expect(result.warnings).toEqual(["existing warn", "AI description: rate limit"]);
  });

  it("без oilsRepo — не падає (опціональна залежність)", async () => {
    const s = makeServices({ oilsRepo: null });
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });
    expect(result.status).toBe("created");
  });

  it("немає фото → status 'no_photos', НЕ публікує, помічає failed", async () => {
    const s = makeServices({
      oilsRepo: {
        markTruckInProgress: vi.fn().mockResolvedValue(),
        markTruckFailed: vi.fn().mockResolvedValue(),
        countUploadablePhotos: vi.fn().mockResolvedValue(0),
      },
    });
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 9 });

    expect(result.status).toBe("no_photos");
    expect(result.reason).toMatch(/Немає фото/);
    // listing НЕ створювався, фото не вантажились
    expect(s.publishService.publish).not.toHaveBeenCalled();
    expect(s.photoService.uploadAllFor).not.toHaveBeenCalled();
    // позначено failed
    expect(s.oilsRepo.markTruckFailed).toHaveBeenCalledWith(9, expect.stringMatching(/Немає фото/));
  });

  it("є фото (>=1) → публікація продовжується", async () => {
    const s = makeServices(); // countUploadablePhotos → 1
    const h = new TruckMarketHandler(s);
    const result = await h.handle({ id: 5 });
    expect(result.status).toBe("created");
    expect(s.publishService.publish).toHaveBeenCalledOnce();
  });
});

describe("TruckMarketHandler.handleUpdate", () => {
  function makeUpdateServices(overrides = {}) {
    return {
      publishService: { update: vi.fn().mockResolvedValue({ listingId: 5555, warnings: [] }) },
      photoService: { uploadAllFor: vi.fn() },
      oilsRepo: {
        markTruckInProgress: vi.fn().mockResolvedValue(),
        markTruckFailed: vi.fn().mockResolvedValue(),
      },
      ...overrides,
    };
  }

  it("успіх: in_progress → update → status 'updated', фото не чіпає", async () => {
    const s = makeUpdateServices();
    const h = new TruckMarketHandler(s);
    const row = { id: 7, truck_listing_id: 5555, ai_description: "опис" };
    const result = await h.handleUpdate(row);

    expect(s.oilsRepo.markTruckInProgress).toHaveBeenCalledWith(7);
    expect(s.publishService.update).toHaveBeenCalledWith(row, { description: "опис" });
    expect(s.photoService.uploadAllFor).not.toHaveBeenCalled();
    expect(result.status).toBe("updated");
    expect(result.listingId).toBe(5555);
  });

  it("без ai_description → description undefined", async () => {
    const s = makeUpdateServices();
    const h = new TruckMarketHandler(s);
    await h.handleUpdate({ id: 7, truck_listing_id: 5555 });
    expect(s.publishService.update.mock.calls[0][1]).toEqual({ description: undefined });
  });

  it("api error → markTruckFailed + status api_error", async () => {
    const s = makeUpdateServices({
      publishService: { update: vi.fn().mockRejectedValue(new Error("TM 500")) },
    });
    const h = new TruckMarketHandler(s);
    const result = await h.handleUpdate({ id: 7, truck_listing_id: 5555 });
    expect(result.status).toBe("api_error");
    expect(s.oilsRepo.markTruckFailed).toHaveBeenCalledWith(7, "TM 500");
  });
});
