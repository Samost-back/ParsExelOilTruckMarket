// Хендлер інтеграції TruckMarket: бере одну oil-row → опис → listing → фото.
// SRP: тільки координує три сервіси, не виконує сам ні HTTP, ні SQL.
// DIP: всі залежності — через конструктор; легко підмінити mock'ами в тестах.

class TruckMarketHandler {
  constructor({ publishService, photoService, descriptionService = null, oilsRepo = null }) {
    this.publishService = publishService;
    this.photoService = photoService;
    this.descriptionService = descriptionService; // опціонально (можна вимкнути OpenAI)
    this.oilsRepo = oilsRepo; // опціонально — для оновлення truck_status у БД
  }

  get label() { return "TruckMarket"; }

  async handle(row) {
    // 0. Позначити "в роботі" одразу — щоб у БД було видно
    if (this.oilsRepo) await this.oilsRepo.markTruckInProgress(row.id);

    // 1. Опис (опціонально). Сервіс не кидає винятків — повертає {text} або {error}.
    let description;
    let descriptionWarn = null;
    if (this.descriptionService) {
      const r = await this.descriptionService.ensureFor(row);
      if (r.text) description = r.text;
      else descriptionWarn = `AI description: ${r.error}`;
    }

    // 2. Створення listing'а.
    let listingId, warnings;
    try {
      const r = await this.publishService.publish(row, { description });
      listingId = r.listingId;
      warnings = r.warnings || [];
    } catch (e) {
      const isMapping = /Немає мапінгу/.test(e.message);
      if (this.oilsRepo) await this.oilsRepo.markTruckFailed(row.id, e.message);
      return {
        status: isMapping ? "mapping_error" : "api_error",
        reason: e.message,
        warnings: descriptionWarn ? [descriptionWarn] : [],
      };
    }
    // успіх — truck_status='done' вже виставлений у publishService.setListingId
    if (descriptionWarn) warnings.push(descriptionWarn);

    // 3. Фото.
    const photos = await this.photoService.uploadAllFor({ oilsId: row.id, listingId });

    return { status: "created", listingId, warnings, photos };
  }
}

module.exports = { TruckMarketHandler };
