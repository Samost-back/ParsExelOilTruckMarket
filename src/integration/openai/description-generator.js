const SYSTEM_PROMPT = require("./system-prompt");

// SRP: перетворює name → SEO-опис через OpenAI. Знає лише про промпт і клієнт.
// OCP: змінити стиль промптів = редагувати system-prompt.js без правок коду.

class DescriptionGenerator {
  constructor({ client }) {
    if (!client) throw new Error("DescriptionGenerator: client required");
    this.client = client;
  }

  // Чистить '|' з назви (як вимагає промпт).
  static _normalizeName(name) {
    return String(name || "").replace(/\s*\|\s*/g, " — ").replace(/\s+/g, " ").trim();
  }

  async generateForOil(row) {
    const userMessage = DescriptionGenerator._normalizeName(row.name);
    return this.client.chat({ system: SYSTEM_PROMPT, user: userMessage });
  }
}

module.exports = { DescriptionGenerator };
