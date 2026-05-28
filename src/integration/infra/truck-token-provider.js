const axios = require("axios");

const TOKEN_TTL_MS = 40 * 60 * 1000;

// SRP: тільки видача/інвалідація токена TruckMarket. Інтерфейс get()/invalidate()
// дозволяє HttpClient працювати з будь-яким провайдером (DIP).

class TruckTokenProvider {
  constructor({ baseUrl, keyId, secret }) {
    if (!baseUrl || !keyId || !secret) {
      throw new Error("TruckTokenProvider: baseUrl/keyId/secret required");
    }
    this.baseUrl = baseUrl;
    this.keyId = keyId;
    this.secret = secret;
    this._token = null;
    this._expiresAt = 0;
  }

  async get() {
    if (this._token && Date.now() < this._expiresAt) return this._token;
    const res = await axios.post(
      `${this.baseUrl}/intapi/v1/auth`,
      { secret: this.secret, id: this.keyId },
      { timeout: 15000 },
    );
    const token = res.data && res.data.data && res.data.data.token;
    if (!token) throw new Error(`auth: no token: ${JSON.stringify(res.data)}`);
    this._token = token;
    this._expiresAt = Date.now() + TOKEN_TTL_MS;
    return token;
  }

  invalidate() {
    this._token = null;
    this._expiresAt = 0;
  }
}

module.exports = { TruckTokenProvider };
