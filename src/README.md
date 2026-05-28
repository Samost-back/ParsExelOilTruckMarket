# Структура `src/`

```
src/
├── parser/                       Excel прайс → DB
│   ├── index.js                  CLI: node src/parser/index.js "<Company>" <excel>
│   └── constants.js              SECTION_RE, TYPE_OIL_MAP, COLUMN_KEYWORDS…
│
├── photos/                       Все що навколо фотографій
│   ├── import/                   Архів → таблиця oils_images
│   │   └── index.js              CLI: node src/photos/import/index.js <zip|folder>
│   ├── process/                  sharp-обробка: шаблон + прапор + країна
│   │   ├── index.js              CLI: node src/photos/process/index.js [limit] [--reprocess]
│   │   └── template-config.cjs   Геометрія шаблонів + COUNTRY_FLAGS (Node)
│   └── browser-tool/             Інтерактивна веб-утиліта (Photoshop-like)
│       ├── index.html, app.js, config.js, templates/, package.json
│
├── integrations/                 Зовнішні API
│   ├── truckmarket/              TM маркетплейс (моторні/трансм./гідр.)
│   │   ├── run.js                CLI composition root
│   │   ├── orchestrator.js       Pending → dispatch → handler
│   │   ├── client.js             HTTP-обгортка над TM API
│   │   ├── truck-token-provider.js  bearer-токен з 40 хв TTL
│   │   ├── constants.js          Мапінг полів, опцій
│   │   ├── helpers.js            findBrandId, carBrandsToBitmask
│   │   ├── mapping/              field-encoders, payload-builder
│   │   ├── repositories/         oils-repo
│   │   ├── services/             listing-publish, photo-upload, cleanup
│   │   ├── handlers/             TruckMarketHandler + registry
│   │   ├── reporting/            run-stats
│   │   └── cli/                  delete-listings.js
│   │
│   └── openai/                   SEO-описи (gpt-4o-mini)
│       ├── openai-client.js
│       ├── description-generator.js
│       ├── description-service.js
│       └── system-prompt.js
│
├── shared/                       Спільна інфраструктура
│   └── infra/                    db, http-client, logger
│
└── web/                          (placeholder) майбутній UI-флоу:
    ├── api/                      Express/Fastify endpoints
    └── ui/                       сторінка для upload Excel + папки фото
```

## Бізнес-флоу

```
1. WEB    upload xlsx + папка фото + ввести компанію        [TODO src/web/]
   │
   ▼
2. PARSE  parser/        xlsx → olivs / oils_price
   ▼
3. PHOTOS photos/import  файли → oils_images (link by articul)
   ▼
4. PHOTOS photos/process oils_images → processed_*  (sharp + flag)
   ▼
5. INTEG  integrations/openai      olivs → ai_description
   ▼
6. INTEG  integrations/truckmarket olivs → TM listing + upload photos
```

## Статуси в БД

| Таблиця | Колонки статусу |
|---|---|
| `oils_images` | `processed_status` (`done|skipped|failed`), `processed_error`, `processed_at`, `uploaded_at`, `upload_error` |
| `olivs` | `truck_listing_id`, `ai_description_status` (`done|failed`), `ai_description_error`, `ai_description_at` |

## CLI шпаргалка

```bash
# Парсинг прайсу
node src/parser/index.js "EUROLUB" Excel/eurolub.xlsx

# Імпорт фото
node src/photos/import/index.js "PRODUCT FOTO-...zip"

# Обробка фото (всі pending)
node src/photos/process/index.js
node src/photos/process/index.js 10            # тільки 10
node src/photos/process/index.js --reprocess   # перерендер усіх

# Заливка на TruckMarket
node src/integrations/truckmarket/run.js               # всі pending з OpenAI
node src/integrations/truckmarket/run.js 5             # перші 5
node src/integrations/truckmarket/run.js 5 --no-ai     # без OpenAI

# Видалення листингів
node src/integrations/truckmarket/cli/delete-listings.js          # усі
node src/integrations/truckmarket/cli/delete-listings.js 5445     # конкретний
```
