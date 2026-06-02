const { buildListingPayload } = require("../mapping/payload-builder");

// SRP: створює оголошення на TruckMarket для однієї oil-row + персистить listing_id.
// OCP: щоб додати опис від OpenAI — викликати з { description } зовні.
// Не лізе у фото — це робота PhotoUploadService.

class ListingPublishService {
  constructor({ api, repo }) {
    this.api = api;
    this.repo = repo;
  }

  // Локація оголошення завжди з міста КОМПАНІЇ (row.company_city) — резолвимо
  // у TM geo_city id; якщо не вдалось — payload візьме env-дефолт.
  async _resolveGeoCity(row) {
    const city = row.company_city || row.city;
    if (!city || typeof this.api.findCityId !== "function") return null;
    return this.api.findCityId(city);
  }

  async publish(row, { description } = {}) {
    const geoCityId = await this._resolveGeoCity(row);
    const { data, warnings } = buildListingPayload(row, { description, geoCityId });
    const res = await this.api.createListing(data);
    const listingId = res && res.data && res.data.id;
    if (!res.success || !listingId) {
      throw new Error(`TruckMarket reply: ${JSON.stringify(res)}`);
    }
    await this.repo.setListingId(row.id, listingId);
    return { listingId, warnings };
  }

  // Оновлення вже існуючого оголошення (row.truck_listing_id) — той самий
  // payload, що й при створенні, але через updateListing. Використовується для
  // олив у статусі 'outdated' (ціна змінилась після публікації).
  async update(row, { description } = {}) {
    const listingId = row.truck_listing_id;
    if (!listingId) throw new Error("update: row.truck_listing_id required");
    const { data, warnings } = buildListingPayload(row, { description });
    const res = await this.api.updateListing(listingId, data);
    if (!res || !res.success) {
      throw new Error(`TruckMarket update reply: ${JSON.stringify(res)}`);
    }
    await this.repo.markTruckUpdated(row.id);
    return { listingId, warnings };
  }
}

module.exports = { ListingPublishService };
