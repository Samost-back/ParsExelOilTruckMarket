// SRP: координує отримання опису для оливи + персистить статус.
// Опис ОПЦІОНАЛЬНИЙ: при помилці OpenAI не кидаємо виняток, лише фіксуємо
// status='failed' в БД і повертаємо { error }. Виклик у TruckMarketHandler
// продовжиться без опису.
// Статуси у olivs.ai_description_status:
//   NULL → ще не пробували
//   'done'   → ai_description заповнений
//   'failed' → OpenAI не зміг (error у ai_description_error)

class DescriptionService {
  constructor({ generator, repo }) {
    this.generator = generator;
    this.repo = repo;
  }

  // Повертає { text } якщо опис є/згенерований; { error } якщо OpenAI впав.
  // Кеш: якщо row.ai_description вже є (status='done') — повертаємо без виклику API.
  async ensureFor(row) {
    if (row.ai_description) return { text: row.ai_description };
    try {
      const text = await this.generator.generateForOil(row);
      await this.repo.setAiDescriptionDone(row.id, text);
      return { text };
    } catch (e) {
      await this.repo.setAiDescriptionFailed(row.id, e.message);
      return { error: e.message };
    }
  }
}

module.exports = { DescriptionService };
