const { buildListingPayload } = require("../mapping/payload-builder");

// SRP: створює оголошення на TruckMarket для однієї oil-row + персистить listing_id.
// OCP: щоб додати опис від OpenAI — викликати з { description } зовні.
// Не лізе у фото — це робота PhotoUploadService.

class ListingPublishService {
  constructor({ api, repo }) {
    this.api = api;
    this.repo = repo;
  }

  async publish(row, { description } = {}) {
    const { data, warnings } = buildListingPayload(row, { description });
    const res = await this.api.createListing(data);
    const listingId = res && res.data && res.data.id;
    if (!res.success || !listingId) {
      throw new Error(`TruckMarket reply: ${JSON.stringify(res)}`);
    }
    await this.repo.setListingId(row.id, listingId);
    return { listingId, warnings };
  }
}

module.exports = { ListingPublishService };
