// SRP: видаляє listing'и з TM + скидає прив'язки в БД.
// Замінює і delete-listings.js, і ad-hoc cleanup-скрипти.

class CleanupService {
  constructor({ api, repo }) {
    this.api = api;
    this.repo = repo;
  }

  async deleteByListingIds(listingIds) {
    const result = { deleted: 0, failed: [] };
    for (const lid of listingIds) {
      try {
        await this.api.deleteListing(lid);
        result.deleted++;
      } catch (e) {
        result.failed.push({ listingId: lid, error: e.message });
      }
    }
    return result;
  }

  async deleteAllPublished() {
    const rows = await this.repo.findAllPublished();
    const result = await this.deleteByListingIds(rows.map((r) => r.truck_listing_id));
    const oilsIds = rows.map((r) => r.id);
    for (const id of oilsIds) await this.repo.clearListingId(id);
    const photosReset = await this.repo.resetPhotosUpload(oilsIds);
    return { ...result, oilsReset: oilsIds.length, photosReset };
  }
}

module.exports = { CleanupService };
