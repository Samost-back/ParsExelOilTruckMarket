# Деплоймент

Інструкція з розгортання ParsExelOilTruckMarket на сервері. Стек піднімається
через Docker Compose: контейнер `db` (PostgreSQL 16) і контейнер `app`
(Node.js + Fastify).

---

## Передумови

- Docker + Docker Compose на сервері.
- Доменне ім'я та reverse-proxy з HTTPS (nginx / Caddy / Traefik) — обов'язково
  для production, бо session-cookie видається з прапорцем `secure` (працює лише
  поверх HTTPS).
- Доступи до TruckMarket API (ключі) і, за бажанням, ключ OpenAI.

---

## Чеклист перед деплоєм

- [ ] Створено `.env` з `.env.example`, усі обов'язкові значення заповнено.
- [ ] `NODE_ENV=production`.
- [ ] `SESSION_SECRET` — випадковий рядок 32+ символів
      (`openssl rand -base64 32`).
- [ ] `PG_PASSWORD` — надійний, не дефолтний.
- [ ] TruckMarket: `TRUCK_BASE_URL`, `KEY_ID`, `SECRET_KEY`, `USER_ID`,
      `COMPANY_ID`, `GEO_CITY_ID_DEFAULT` заповнені.
- [ ] БД **не** публікується назовні: у `docker-compose.yml` порт `db`
      прив'язаний до `127.0.0.1`; на prod краще прибрати публікацію зовсім.
- [ ] Reverse-proxy термінує HTTPS і проксує на `app:3000`.
- [ ] Томи `pg_data`, `photos_storage`, `uploads` — на постійному сховищі,
      включені в резервне копіювання.
- [ ] `npm test` зелений (180+ тестів).

---

## Перший запуск (чиста база)

```bash
git clone <repo> && cd ParsExelOilTruckMarket
cp .env.example .env          # заповнити значення
make init                     # build+up, міграції, базові інтеграції
make create-user U=admin P=надійний_пароль
```

`make init` робить:
1. `docker compose up -d` — піднімає `db` і `app`.
2. На **чистому** томі БД Postgres автоматично проганяє всі файли з
   `database/migrations/` (через `docker-entrypoint-initdb.d`).
3. `make migrate` — повторно застосовує міграції (ідемпотентні, окрім базової
   `000_init.sql`, яка вже відпрацювала).
4. `make seed-integrations` — додає базові інтеграції (EUROLUB, Manager).

Перевірка: `curl http://localhost:3000/health` має повернути
`{"status":"ok",...}`.

---

## Оновлення (новий реліз на наявній базі)

Важливо: автоматичний `initdb` спрацьовує **лише на порожньому томі**. Для
наявної бази нові міграції треба прогнати вручну.

```bash
git pull
make build                    # перебудувати образ app і підняти
make migrate                  # застосувати нові міграції (ідемпотентні)
make seed-integrations        # за потреби
```

Усі міграції, крім `000_init.sql`, мають `IF NOT EXISTS` / `ON CONFLICT`, тож
повторний прогін безпечний. `000_init.sql` на наявній базі видасть «вже існує» —
це очікувано й не блокує решту (кожен файл виконується окремим процесом).

---

## Бекап і відновлення

```bash
make backup-db                # дамп у backup.sql на хості
# відновлення:
cat backup.sql | docker compose exec -T db psql -U "$PG_USER" -d "$PG_DB"
```

Фотографії (оброблені та вихідні) лежать у томі `photos_storage` —
включіть його у бекап окремо.

---

## Health, логи, керування

| Дія | Команда |
|-----|---------|
| Статус контейнерів | `make ps` |
| Логи app (follow) | `make logs` |
| Перезапуск | `make restart` |
| Зупинка (томи лишаються) | `make down` |
| Health-перевірка | `curl http://localhost:3000/health` |

Healthcheck контейнера `app` пінгує `/health` (БД + лічильник активних задач).
Контейнер `db` має `pg_isready`-healthcheck; `app` стартує лише після того, як
БД здорова.

---

## Примітки щодо безпеки

- `.env`, прайси (`Excel/`), вхідні фото та секрети виключені з образу
  (`.dockerignore`) і з репозиторію (`.gitignore`).
- `app` працює під непривілейованим користувачем (`USER app` у Dockerfile).
- Cookie сесій: `httpOnly`, `sameSite=lax`, `secure` (на production).
- Не публікуйте порт БД у зовнішню мережу.
