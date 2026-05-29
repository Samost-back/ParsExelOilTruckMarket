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

  // Будує user-message для OpenAI з повним контекстом оливо з БД.
  // Промпт (system) сам вирішить як цим скористатися.
  static _buildUserMessage(row) {
    const lines = [];
    const push = (label, val) => {
      if (val == null || val === "" || (Array.isArray(val) && val.length === 0)) return;
      const s = Array.isArray(val) ? val.join(", ") : String(val).trim();
      if (s) lines.push(`${label}: ${s}`);
    };

    lines.push(`Назва товару: ${DescriptionGenerator._normalizeName(row.name)}`);
    push("Бренд", row.company_name);
    push("Категорія", row.name_type_oil);
    push("Тип оливи", row.type_oil);
    push("В'язкість SAE", row.viscosity_sae);
    push("ISO VG", row.iso_vg_viscosity_grade);
    push("Артикул", row.articul);
    push("Об'єм упаковки", row.packaging_volume ? `${row.packaging_volume} л` : null);
    push("ACEA", row.acea);
    push("API", row.api);
    push("DOT", row.dot);
    push("Низький рівень SAPS", row.low_level_saps === true ? "так"
                              : row.low_level_saps === false ? "ні" : null);
    push("Колір", row.color_liquid);
    push("Допуски виробників", row.manufacturers_tolerances);
    push("Сумісні марки авто", row.car_brand);

    return lines.join("\n");
  }

  async _resolvePrompt() {
    if (this.promptResolver) {
      const p = await this.promptResolver();
      if (p) return p;
    }
    return this.systemPrompt || FALLBACK_PROMPT;
  }

  async generateForOil(row) {
    const userMessage = DescriptionGenerator._buildUserMessage(row);
    const system = await this._resolvePrompt();
    return this.client.chat({ system, user: userMessage });
  }
}

module.exports = { DescriptionGenerator };
