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
});
