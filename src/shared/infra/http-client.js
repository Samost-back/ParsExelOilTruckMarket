const axios = require("axios");

// Тонкий HTTP-обгортковий клас з:
//   - bearer-токеном через провайдер;
//   - єдиним retry на 401 (invalidate + повтор);
//   - validateStatus=()=>true, щоб ловити non-2xx в одному місці.
// Окремий від TruckMarketClient, щоб transport-логіка не дублювалась.

class HttpClient {
  constructor({ baseUrl, tokenProvider, timeoutMs = 30000 }) {
    this.baseUrl = baseUrl;
    this.tokenProvider = tokenProvider;
    this.timeoutMs = timeoutMs;
  }

  async send({ method, path, json, form, timeoutMs }) {
    const buildRequest = async () => {
      const token = await this.tokenProvider.get();
      const headers = { Authorization: `Bearer ${token}` };
      let data;
      if (form) {
        Object.assign(headers, form.getHeaders());
        data = form;
      } else if (json !== undefined) {
        data = json;
      }
      return axios.request({
        method,
        url: `${this.baseUrl}${path}`,
        headers,
        data,
        timeout: timeoutMs || this.timeoutMs,
        validateStatus: () => true,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    };

    let res = await buildRequest();
    if (res.status === 401) {
      this.tokenProvider.invalidate();
      res = await buildRequest();
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `HTTP ${method} ${path} → ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }
}

module.exports = { HttpClient };
