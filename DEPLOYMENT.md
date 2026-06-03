# Деплоймент

Інструкція з розгортання ParsExelOilTruckMarket на сервері. Стек піднімається
через Docker Compose: контейнер `db` (PostgreSQL 16) і контейнер `app`
(Node.js + Fastify).

---

## Передумови

- Docker + Docker Compose на сервері (доступ по SSH).
- **Доменне імʼя**, що вказує на сервер. На AWS EC2 годиться публічний DNS-хост
  інстансу, напр. `ec2-34-205-88-192.compute-1.amazonaws.com` — на нього
  Let's Encrypt видає валідний сертифікат (на голий IP — ні).
- Відкриті порти **80 і 443** (HTTP-челендж + HTTPS). На EC2 — у Security Group.
- Доступи до TruckMarket API (ключі) і, за бажанням, ключ OpenAI.

> **HTTPS-only, усе в Docker.** У стек входить контейнер **Caddy** — reverse-proxy
> з автоматичним TLS (Let's Encrypt). Він єдина точка входу (80/443); `app` слухає
> HTTP `:3000` лише у приватній docker-мережі й **назовні не публікується**.
> Окремий nginx на хості не потрібен.

---

## Деплой однією командою

```bash
git clone <repo> && cd ParsExelOilTruckMarket
cp .env.example .env          # заповнити (обовʼязково APP_DOMAIN + секрети)
make deploy                   # build → up (app+db+caddy) → міграції → seed
make create-user U=admin P=надійний_пароль
```

`make deploy` робить усе сам: збирає образ, піднімає `db`+`app`+`caddy`, чекає поки
`app` стане healthy, проганяє міграції, додає базові інтеграції. Наприкінці друкує
адресу `https://<APP_DOMAIN>`.

Caddy при першому старті отримає TLS-сертифікат на `APP_DOMAIN` (потрібні
відкриті 80/443 і коректний DNS). Сертифікати зберігаються у томі `caddy_data`,
тож переживають перезапуски.

> **EC2 Security Group:** дозвольте вхідні **80** і **443** (TCP) з `0.0.0.0/0`
> (або вашого діапазону). SSH (22) — лише для адміну. Порти `3000`/`5432`
> назовні відкривати НЕ треба.

---

## Чеклист перед деплоєм

- [ ] Створено `.env` з `.env.example`, усі обов'язкові значення заповнено.
- [ ] `APP_DOMAIN` = домен/публічний DNS, що вказує на сервер (для TLS).
- [ ] `NODE_ENV=production` (вмикає secure-cookie і trustProxy за замовчуванням).
- [ ] `TRUST_PROXY=true` (за reverse-proxy — інакше вхід «не запам'ятовується»).
- [ ] `SESSION_SECRET` — випадковий рядок 32+ символів
      (`openssl rand -base64 32`).
- [ ] `PG_PASSWORD` — надійний, не дефолтний.
- [ ] TruckMarket: `TRUCK_BASE_URL`, `KEY_ID`, `SECRET_KEY`, `USER_ID`,
      `COMPANY_ID`, `GEO_CITY_ID_DEFAULT` заповнені.
- [ ] Порти **80/443** відкриті (EC2 Security Group); `3000`/`5432` — НІ.
- [ ] DNS `APP_DOMAIN` резолвиться на IP сервера (інакше TLS-челендж не пройде).
- [ ] Томи `pg_data`, `photos_storage`, `uploads`, `caddy_data` — на постійному
      сховищі, включені в резервне копіювання.
- [ ] `npm test` зелений (220+ тестів).

---

## HTTPS усередині стека (Caddy — за замовчуванням)

Стек уже містить сервіс `caddy` ([Caddyfile](Caddyfile)), який:
- отримує й автоматично оновлює TLS-сертифікат на `APP_DOMAIN`;
- редіректить HTTP(80) → HTTPS(443);
- проксує на `app:3000` у приватній мережі;
- **не буферизує** відповіді → SSE-лог задач іде в реальному часі;
- шле `X-Forwarded-Proto`/`For` (Fastify `trustProxy` робить cookie `Secure`).

Нічого додатково ставити не треба — `make deploy` піднімає Caddy разом з усім.

---

## Альтернатива: зовнішній nginx (опційно)

Якщо TLS термінується окремим nginx на хості (не через Caddy в стеку), приберіть
сервіс `caddy` з compose, опублікуйте `app` на `127.0.0.1:3000` і використайте
такий конфіг. SSE вимагає окремого `location` без буферизації.

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.example;

    ssl_certificate     /etc/letsencrypt/live/your-domain.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example/privkey.pem;

    # Максимальний розмір завантаження (прайс/фото). Узгодьте з MAX_UPLOAD_BYTES.
    client_max_body_size 512m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # ← робить cookie secure-сумісними
    }

    # SSE-стрім задач: вимикаємо буферизацію й даємо довгий таймаут.
    location ~ ^/jobs/\d+/stream$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
        proxy_buffering    off;        # ← критично для real-time SSE
        proxy_cache        off;
        proxy_read_timeout 1h;
    }
}

# HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.example;
    return 301 https://$host$request_uri;
}
```

(Застосунок уже шле `X-Accel-Buffering: no` на SSE-відповіді, тож nginx не
буферизує її навіть без явного `proxy_buffering off` — але директиву лишено для
надійності й для інших проксі.)

Caddy (простіший варіант — автоматичний TLS):

```caddy
your-domain.example {
    reverse_proxy 127.0.0.1:3000
    request_body { max_size 512MB }
}
```

Caddy не буферизує SSE за замовчуванням і коректно проксує `X-Forwarded-*`.

---

## Що саме робить `make deploy`

1. `docker compose build` — збирає образ `app` (`npm ci` всередині).
2. `docker compose up -d` — піднімає `db` + `app` + `caddy`.
3. Чекає, поки `app` стане healthy (`/health`).
4. `make migrate` — проганяє всі міграції по порядку (ідемпотентні, окрім базової
   `000_init.sql`, яка на наявній базі просто скаже «вже існує» — це не блокує
   решту, бо кожен файл виконується окремим процесом).
5. `make seed-integrations` — додає базові інтеграції (EUROLUB, Manager).

Та сама команда годиться і для **першого запуску**, і для **оновлення** релізу:

```bash
git pull
make deploy
```

Перевірка: `https://<APP_DOMAIN>/health` має повернути `{"status":"ok",...}`.

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
- Cookie сесій: `httpOnly`, `sameSite=lax`, `secure` (на production) — тобто
  передаються **лише по HTTPS**. Через це вхід працює тільки за TLS-проксі.
- `trustProxy` увімкнено на prod — застосунок довіряє `X-Forwarded-Proto`, тож
  бачить запит як HTTPS і виставляє secure-cookie. Без коректного проксі, що
  шле цей заголовок, вхід «не запам'ятовуватиметься».
- Не публікуйте порт БД (`5432`) і порт застосунку (`3000`) у зовнішню мережу —
  лише reverse-proxy має доступ до `3000`.

---

## Діагностика входу/SSE за проксі

- **Вхід не запам'ятовується (постійний редірект на /login):** проксі не передає
  `X-Forwarded-Proto: https`, або `TRUST_PROXY`/`NODE_ENV` не виставлені →
  Fastify вважає зʼєднання HTTP і не ставить secure-cookie. Перевірте заголовок
  у конфізі проксі та `TRUST_PROXY=true`.
- **Сторінка задачі не оновлюється в реальному часі:** проксі буферизує SSE.
  Додайте `proxy_buffering off` для `^/jobs/\d+/stream$` (nginx); Caddy — без
  налаштувань.
