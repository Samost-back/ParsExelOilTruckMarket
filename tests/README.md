# Unit + integration tests

## Запуск

```bash
npm test              # one-shot
npm run test:watch    # watch mode
npm run test:cov      # з coverage
```

## Що покрито

| Модуль | Файл | Покриття |
|---|---|---|
| TruckMarket helpers (findBrandId, carBrandsToBitmask) | helpers.test.js | 100% |
| Field encoders (text/select/bitmask/brand) | field-encoders.test.js | 95% |
| Payload builder (cat_id, f-поля, warnings) | payload-builder.test.js | 100% |
| Handler registry (blacklist/no_integration/dispatch) | handler-registry.test.js | 100% |
| RunStats (статистика прогону) | run-stats.test.js | 100% |
| ListingPublishService (моки api+repo) | listing-publish-service.test.js | 100% |
| PhotoUploadService (моки api+repo) | photo-upload-service.test.js | 100% |
| TruckMarketHandler (інтеграція трьох сервісів) | truckmarket-handler.test.js | 96% |
| OpenAI DescriptionGenerator (mock client) | description-generator.test.js | 100% |
| DescriptionService (cache + error) | description-service.test.js | 100% |
| OpenAI PromptsRepo (моки db) | prompts-repo.test.js | 80% |
| JobRunner (semaphore, cancel, lifecycle) | job-runner.test.js | 76% |
| Parser constants (SECTION_RE, COLOR_PATTERNS, ...) | constants.test.js | 100% |
| HttpClient + TokenProvider (через local http.Server) | http-stack.integration.test.js | integration |

**110 тестів, 94% statements coverage**.

## Дизайн

- Жодного реального API виклику. Всі OpenAI/TruckMarket/Postgres — моки через `vi.fn()`.
- HTTP-стек (HttpClient + TokenProvider) тестується через **локальний http.Server** (не axios mock) — це надійніше і не залежить від CJS/ESM-нюансів.
- Тести швидкі: повний прогон ~1.5с.
