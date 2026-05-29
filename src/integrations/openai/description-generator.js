const FALLBACK_PROMPT = require("./system-prompt");

// SRP: перетворює row → SEO-опис через OpenAI.
// DIP: systemPrompt можна передати у конструктор (з БД) АБО викликати
// .setPromptResolver(fn) — і тоді кожен виклик буде питати свіжий промпт.
// Fallback — константа з system-prompt.js, якщо нічого не задано.

class DescriptionGenerator {
  constructor({ client, systemPrompt, promptResolver } = {}) {
    if (!client) throw new Error("DescriptionGenerator: client required");
    this.client = client;
    this.systemPrompt = systemPrompt || null;
    this.promptResolver = promptResolver || null;
  }

  static _normalizeName(name) {
    return String(name || "").replace(/\s*\|\s*/g, " — ").replace(/\s+/g, " ").trim();
  }

  async _resolvePrompt() {
    if (this.promptResolver) {
      const p = await this.promptResolver();
      if (p) return p;
    }
    return this.systemPrompt || FALLBACK_PROMPT;
  }

  async generateForOil(row) {
    const userMessage = DescriptionGenerator._normalizeName(row.name);
    const system = await this._resolvePrompt();
    return this.client.chat({ system, user: userMessage });
  }
}

module.exports = { DescriptionGenerator };
