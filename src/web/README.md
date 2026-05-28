# Web частина

Fastify + EJS + HTMX + session-cookie + bcrypt.

## Структура

```
src/web/
├── server.js                  ← node src/web/server.js
├── plugins/auth.js            ← session, login/logout, requireAuth
├── routes/
│   ├── auth.routes.js         ← /login, /logout
│   ├── dashboard.routes.js    ← /
│   ├── upload.routes.js       ← /upload  (xlsx + zip + company + country)
│   ├── photos.routes.js       ← /photos/process
│   ├── integrations.routes.js ← /integrations/truckmarket/run
│   └── jobs.routes.js         ← /jobs/:id  + SSE /jobs/:id/stream
├── repositories/              ← UsersRepo, JobsRepo
├── services/
│   └── job-runner.js          ← фонові задачі + EventEmitter для SSE
├── tasks/
│   └── spawn-task.js          ← запуск CLI-скриптів як child process
├── views/                     ← EJS шаблони
├── public/                    ← style.css (htmx з CDN)
└── cli/
    └── create-user.js         ← створити користувача
```

## Запуск локально

```bash
# 1. Створити user'а
node src/web/cli/create-user.js admin <password>

# 2. Згенерувати session secret (≥32 chars), покласти в .env
#    openssl rand -base64 32
echo "SESSION_SECRET=..." >> .env

# 3. Запустити
node src/web/server.js
# → http://localhost:3000
```

## Бізнес-флоу

1. **/login** → cookie-сесія
2. **Дашборд** показує:
   - Олив у БД, фото, оброблено, на TruckMarket
   - 3 форми: upload, обробка фото, інтеграція
   - Список останніх jobs зі статусами
3. **Upload (xlsx + zip + company + country)** → job:
   - Парсинг прайсу (`src/parser/index.js`)
   - Збереження country у `company_olivs.country`
   - Імпорт фото з архіву (`src/photos/import/index.js`)
4. **"Обробити фото"** → job `src/photos/process/index.js`
5. **"Запустити інтеграцію"** → job `src/integrations/truckmarket/run.js`
6. **/jobs/:id** показує статус + лог. SSE стрім для running.

## Docker

```bash
# Згенерувати session secret
openssl rand -base64 32 > .env.session

# Запуск всього стека
docker compose up -d

# Створити першого user'а в контейнері
docker compose exec app node src/web/cli/create-user.js admin <password>

# Відкрити http://localhost:3000
```
