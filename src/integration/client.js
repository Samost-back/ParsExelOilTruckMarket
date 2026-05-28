const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { HttpClient } = require("./infra/http-client");
const { TruckTokenProvider } = require("./infra/truck-token-provider");

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

  // Завантаження одного фото. TruckMarket робить ГОЛОВНИМ перше залите.
  async uploadListingImage(listingId, filePath) {
    if (!listingId) throw new Error("uploadListingImage: listingId required");
    if (!fs.existsSync(filePath)) throw new Error(`uploadListingImage: file not found: ${filePath}`);

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), {
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
