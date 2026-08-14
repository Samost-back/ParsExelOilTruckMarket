const {
  TYPE_OIL_BLACKLIST,
  TYPE_OIL_TO_TRUCKMARKET_CATEGORY,
} = require("../constants");

// SRP: вибір хендлера для name_type_oil.
// OCP: нові інтеграції додаються через register() без правки коду.
// Можливі маршрути: { route: "blacklist" | "no_integration" | "dispatch" }.

class HandlerRegistry {
  // blacklist інжектується (дефолт — TYPE_OIL_BLACKLIST з constants), щоб
  // логіку відсіювання можна було тестувати незалежно від поточного вмісту
  // константи: зараз вона порожня, бо всі типи оливи змаплені.
  constructor({ blacklist = TYPE_OIL_BLACKLIST } = {}) {
    this.byType = new Map(); // name_type_oil → handler
    this.blacklist = blacklist;
  }

  register(types, handler) {
    for (const t of types) {
      if (this.blacklist.has(t)) continue;
      this.byType.set(t, handler);
    }
  }

  registeredTypes() { return Array.from(this.byType.keys()); }

  pick(nameTypeOil) {
    if (this.blacklist.has(nameTypeOil)) {
      return { route: "blacklist", reason: `тип "${nameTypeOil}" у blacklist` };
    }
    const handler = this.byType.get(nameTypeOil);
    if (!handler) {
      return { route: "no_integration", reason: `немає інтеграції для "${nameTypeOil}"` };
    }
    return { route: "dispatch", handler };
  }
}

// Конструювання реєстру з конкретних handler-ів — окрема відповідальність,
// щоб орекстратор не знав про TruckMarket-specific речі.
function buildDefaultRegistry({ truckMarketHandler }) {
  const reg = new HandlerRegistry();
  reg.register(Object.keys(TYPE_OIL_TO_TRUCKMARKET_CATEGORY), truckMarketHandler);
  return reg;
}

module.exports = { HandlerRegistry, buildDefaultRegistry };
