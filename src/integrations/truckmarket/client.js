const path = require("path");
const FormData = require("form-data");
const { HttpClient } = require("../../shared/infra/http-client");
const { TruckTokenProvider } = require("./truck-token-provider");
const { getStorage } = require("../../shared/infra/storage");

// Тонкий API-клієнт TruckMarket. Знає тільки про ендпоінти, transport-логіку
// делегує HttpClient (DRY: retry-on-401, validateStatus, timeout).

class TruckMarketClient {
  constructor() {
    const baseUrl = process.env.TRUCK_BASE_URL;
    const tokenProvider = new TruckTokenProvider({
      baseUrl,
      keyId: process.env.KEY_ID,
      secret: process.env.SECRET_KEY,
    });
    this.http = new HttpClient({ baseUrl, tokenProvider });
  }

  createListing(data) {
    return this.http.send({ method: "POST", path: "/intapi/v1/listings/create", json: { data } });
  }

  deleteListing(listingId) {
    if (!listingId) return;
    return this.http.send({ method: "DELETE", path: `/intapi/v1/listings/delete/${listingId}` });
  }

  // Шукає TM geo_city id за назвою міста (title_uk) через geo/regions/list.
  // Кеш у пам'яті — щоб не питати TM на кожну оливу. Повертає число або null.
  async findCityId(name) {
    if (!name) return null;
    const key = String(name).trim();
    if (!key) return null;
    if (!this._cityCache) this._cityCache = new Map();
    if (this._cityCache.has(key)) return this._cityCache.get(key);
    let id = null;
    try {
      const res = await this.http.send({
        method: "POST",
        path: "/intapi/v1/geo/regions/list",
        json: { filter: { title_uk: key }, fields: ["*"], orderBy: "fav asc", limit: 1 },
      });
      const row = res && res.data && res.data[0];
      if (row && row.id != null) id = Number(row.id);
    } catch (_) {
      id = null; // не падаємо — викличе fallback на env-дефолт
    }
    this._cityCache.set(key, id);
    return id;
  }

  // Читає дані одного оголошення (для діагностики/перевірки полів).
  getListingData(listingId) {
    if (!listingId) throw new Error("getListingData: listingId required");
    return this.http.send({
      method: "GET",
      path: `/intapi/v1/listings/data/${listingId}`,
    });
  }

  // Оновлення оголошення. data — об'єкт з полями що змінюються (price, descr, ...).
  // Якщо TM віддасть 404 — endpoint неправильний (треба перевірити документацію).
  updateListing(listingId, data) {
    if (!listingId) throw new Error("updateListing: listingId required");
    return this.http.send({
      method: "POST",
      path: `/intapi/v1/listings/update/${listingId}`,
      json: { data },
    });
  }

  // Завантаження одного фото. TruckMarket робить ГОЛОВНИМ перше залите.
  // filePath — storage key (s3) або легасі-абсолютний шлях (local); читаємо
  // через storage-адаптер, тож працює однаково для обох backend'ів.
  async uploadListingImage(listingId, filePath) {
    if (!listingId) throw new Error("uploadListingImage: listingId required");

    const stream = await getStorage().openRead(filePath);
    const form = new FormData();
    form.append("file", stream, {
      filename: path.basename(filePath),
      contentType: "image/jpeg",
    });
    return this.http.send({
      method: "POST",
      path: `/intapi/v1/listings/images/${listingId}`,
      form,
      timeoutMs: 60000,
    });
  }
}

module.exports = { TruckMarketClient };
