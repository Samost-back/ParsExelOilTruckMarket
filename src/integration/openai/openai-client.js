const axios = require("axios");

// SRP: лише HTTP до OpenAI Chat Completions.
// Не залежить від нашої бізнес-логіки — приймає system+user і повертає текст.

class OpenAIClient {
  constructor({ apiKey, model, baseUrl } = {}) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    this.model = model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.baseUrl = baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set");
  }

  async chat({ system, user, temperature = 0.7, maxTokens = 800 }) {
    const res = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
        validateStatus: () => true,
      },
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`OpenAI ${res.status}: ${JSON.stringify(res.data)}`);
    }
    const text = res.data && res.data.choices && res.data.choices[0]
      && res.data.choices[0].message && res.data.choices[0].message.content;
    if (!text) throw new Error(`OpenAI: empty response: ${JSON.stringify(res.data)}`);
    return text.trim();
  }
}

module.exports = { OpenAIClient };
