import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.USER_ID = "986";
  process.env.COMPANY_ID = "24";
  process.env.GEO_CITY_ID_DEFAULT = "177";
});

const { ListingPublishService } = require("../../../src/integrations/truckmarket/services/listing-publish-service");

const makeRow = () => ({
  id: 1,
  name_type_oil: "моторне оливо",
  name: "Test 1 л",
  packaging_volume: 1,
  articul: "001",
  company_name: "EUROLUB",
  price: 100,
  quantity: 1,
});

describe("ListingPublishService.publish", () => {
  it("успіх: builds payload + createListing + repo.setListingId", async () => {
    const api = { createListing: vi.fn().mockResolvedValue({ success: true, data: { id: 9999 } }) };
    const repo = { setListingId: vi.fn() };
    const svc = new ListingPublishService({ api, repo });

    const result = await svc.publish(makeRow(), { description: "AI desc" });
    expect(result.listingId).toBe(9999);
    expect(api.createListing).toHaveBeenCalledOnce();
    const payload = api.createListing.mock.calls[0][0];
    expect(payload.cat_id).toBe(4263);
    expect(payload.descr.uk).toBe("AI desc");
    expect(repo.setListingId).toHaveBeenCalledWith(1, 9999);
  });

  it("без description → descr.uk порожній", async () => {
    const api = { createListing: vi.fn().mockResolvedValue({ success: true, data: { id: 100 } }) };
    const repo = { setListingId: vi.fn() };
    const svc = new ListingPublishService({ api, repo });
    await svc.publish(makeRow());
    expect(api.createListing.mock.calls[0][0].descr.uk).toBe("");
  });

  it("success=false → throw", async () => {
    const api = { createListing: vi.fn().mockResolvedValue({ success: false, message: "rejected" }) };
    const repo = { setListingId: vi.fn() };
    const svc = new ListingPublishService({ api, repo });
    await expect(svc.publish(makeRow())).rejects.toThrow(/TruckMarket reply/);
    expect(repo.setListingId).not.toHaveBeenCalled();
  });

  it("успіх, але без data.id → throw", async () => {
    const api = { createListing: vi.fn().mockResolvedValue({ success: true, data: {} }) };
    const repo = { setListingId: vi.fn() };
    const svc = new ListingPublishService({ api, repo });
    await expect(svc.publish(makeRow())).rejects.toThrow(/TruckMarket reply/);
  });

  it("повертає warnings з payload-builder", async () => {
    const api = { createListing: vi.fn().mockResolvedValue({ success: true, data: { id: 1 } }) };
    const repo = { setListingId: vi.fn() };
    const svc = new ListingPublishService({ api, repo });

    const row = makeRow();
    row.viscosity_sae = "75W-90"; // не в опціях моторних
    const result = await svc.publish(row);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => /75W-90/.test(w))).toBe(true);
  });
});
