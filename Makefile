# Makefile — зручні команди для Docker + БД + застосунку.
# Використання: make <ціль>   (напр. make up, make seed-integrations)
# Команди БД/скриптів виконуються ВСЕРЕДИНІ контейнера app, щоб ходити в ту саму
# БД, що й застосунок (сервіс db у docker-мережі).

COMPOSE ?= docker compose
APP     ?= app
DB      ?= db

.DEFAULT_GOAL := help
.PHONY: help up down restart build logs ps sh psql \
        migrate seed-integrations init create-user \
        test backup-db wipe-data export-json \
        deploy wait-healthy

help: ## Показати список команд
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

## ---- Docker ----
up: ## Підняти стек (db + app) у фоні
	$(COMPOSE) up -d

down: ## Зупинити і прибрати контейнери (volume лишається)
	$(COMPOSE) down

restart: ## Перезапустити стек
	$(COMPOSE) restart

build: ## Перебудувати образ app і підняти
	$(COMPOSE) up -d --build $(APP)

logs: ## Логи app (follow)
	$(COMPOSE) logs -f $(APP)

ps: ## Статус контейнерів
	$(COMPOSE) ps

sh: ## Shell у контейнері app
	$(COMPOSE) exec $(APP) sh

psql: ## psql до БД у контейнері db
	$(COMPOSE) exec $(DB) sh -c 'psql -U $$POSTGRES_USER -d $$POSTGRES_DB'

## ---- БД ----
migrate: ## Прогнати всі міграції (database/migrations/*.sql) по порядку
	$(COMPOSE) exec $(APP) sh -c 'for f in $$(ls database/migrations/*.sql | sort); do echo "→ $$f"; node database/run-sql.js "$$f"; done'

seed-integrations: ## Додати базові інтеграції (EUROLUB, Manager) — ідемпотентно
	$(COMPOSE) exec $(APP) node database/run-sql.js database/seeds/basic_integrations.sql

init: up migrate seed-integrations ## Підняти стек + міграції + базові інтеграції

## ---- Деплой ----
wait-healthy: ## Чекати поки app стане healthy (до ~90с)
	@echo "⏳ Чекаю app healthy..."
	@for i in $$(seq 1 30); do \
	  st=$$($(COMPOSE) ps -q $(APP) | xargs -r docker inspect --format '{{.State.Health.Status}}' 2>/dev/null); \
	  echo "  $$st"; \
	  [ "$$st" = "healthy" ] && exit 0; \
	  sleep 3; \
	done; \
	echo "✗ app не став healthy"; exit 1

deploy: ## Повний деплой однією командою: build → up (з HTTPS/Caddy) → міграції → seed
	@test -f .env || (echo "✗ Немає .env — скопіюйте .env.example і заповніть"; exit 1)
	$(COMPOSE) build
	$(COMPOSE) up -d
	@$(MAKE) wait-healthy
	@$(MAKE) migrate
	@$(MAKE) seed-integrations
	@echo ""
	@echo "✓ Деплой завершено. HTTPS: https://$$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2-)"
	@echo "  Якщо ще немає користувача: make create-user U=admin P=<пароль>"

create-user: ## Створити веб-користувача: make create-user U=admin P=secret123
	@test -n "$(U)" && test -n "$(P)" || (echo "Вкажіть U=<логін> P=<пароль>"; exit 1)
	$(COMPOSE) exec $(APP) node src/web/cli/create-user.js "$(U)" "$(P)"

backup-db: ## Дамп БД у backup.sql (на хості)
	$(COMPOSE) exec -T $(DB) sh -c 'pg_dump -U $$POSTGRES_USER $$POSTGRES_DB' > backup.sql
	@echo "✓ backup.sql"

wipe-data: ## Стерти оливи/фото/ціни/компанії/задачі (лишити юзерів+інтеграції+промпти). Підтвердження: CONFIRM=yes
	@test "$(CONFIRM)" = "yes" || (echo "⚠ Це зітре всі робочі дані. Запустіть: make wipe-data CONFIRM=yes"; exit 1)
	$(COMPOSE) exec $(APP) node database/run-sql.js database/seeds/wipe_data.sql
	@echo "✓ Дані стерто (web_users, integrations, ai_prompts збережено)"

export-json: ## Експорт усіх таблиць БД у JSON: make export-json [OUT=db-export.json]
# MSYS_NO_PATHCONV=1 — вимикає конвертацію /app у Windows-шлях у Git Bash на Windows
# (на Linux/macOS змінна ігнорується, тож команда крос-платформна).
	MSYS_NO_PATHCONV=1 $(COMPOSE) cp scripts/export-db-json.js $(APP):/app/scripts/export-db-json.js
	MSYS_NO_PATHCONV=1 $(COMPOSE) exec -e EXPORT_AT="$$(date -u +%Y-%m-%dT%H:%M:%SZ)" $(APP) node scripts/export-db-json.js /app/db-export.json
	MSYS_NO_PATHCONV=1 $(COMPOSE) cp $(APP):/app/db-export.json $(or $(OUT),db-export.json)
	@echo "✓ $(or $(OUT),db-export.json)"

## ---- Розробка ----
test: ## Запустити тести (на хості)
	npm test
