.PHONY: help start stop restart clean logs logs-app logs-db status build rebuild shell shell-db migrate-sqlite

# Default target
help:
	@echo "Lumie AI - Доступные команды:"
	@echo ""
	@echo "  make start          Запуск проекта"
	@echo "  make stop           Остановка проекта"
	@echo "  make restart        Перезапуск проекта"
	@echo "  make clean          Полная очистка и запуск (удаляет volumes)"
	@echo "  make rebuild        Пересборка образа и запуск"
	@echo ""
	@echo "  make logs           Логи всех сервисов"
	@echo "  make logs-app       Логи приложения"
	@echo "  make logs-db        Логи базы данных"
	@echo "  make status         Статус контейнеров"
	@echo ""
	@echo "  make shell          Терминал в контейнере приложения"
	@echo "  make shell-db       Терминал PostgreSQL (psql)"
	@echo "  make migrate-sqlite Миграция данных из SQLite"
	@echo ""

# Основные команды
start:
	@echo "Запуск Lumie AI..."
	@docker compose up -d
	@echo "Готово! Откройте http://localhost:3000"

stop:
	@echo "Остановка Lumie AI..."
	@docker compose down
	@echo "Остановлено."

restart:
	@echo "Перезапуск Lumie AI..."
	@docker compose restart
	@echo "Готово!"

# Очистка и пересборка
clean:
	@echo "Полная очистка (удаление volumes, сетей, образов)..."
	@docker compose down --volumes --remove-orphans
	@docker network prune -f
	@echo "Запуск с чистого листа..."
	@docker compose up -d --build
	@echo "Готово! Откройте http://localhost:3000"

rebuild:
	@echo "Пересборка образа..."
	@docker compose build --no-cache
	@docker compose up -d
	@echo "Готово!"

# Логи
logs:
	@docker compose logs -f

logs-app:
	@docker compose logs -f app

logs-db:
	@docker compose logs -f db

# Статус
status:
	@docker compose ps

# Доступ к контейнерам
shell:
	@docker compose exec app sh

shell-db:
	@docker compose exec db psql -U lumie -d lumie

# Миграция
migrate-sqlite:
	@echo "Копирование tutor.db в контейнер..."
	@docker cp tutor.db lumie-app:/app/tutor.db
	@echo "Запуск миграции..."
	@docker compose exec app npm run migrate:sqlite
	@echo "Миграция завершена!"