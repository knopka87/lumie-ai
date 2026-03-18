# Lumie AI - Your Personal Language Tutor

Lumie AI — это интерактивный AI-репетитор для изучения языков с голосовым управлением, персонализированными уроками и системой запоминания.

## Возможности

- **Голосовое общение** — разговаривайте с AI на изучаемом языке
- **Ultra-Fast режим** — мгновенные ответы через Gemini Live API
- **Исправление ошибок** — AI объясняет ваши ошибки на родном языке
- **Персонализация** — AI запоминает информацию о вас и ваши разговоры
- **Учебный план CEFR** — 250+ тем от A1 до C2
- **Расширенная память** — поиск по 50 фактам + 20 релевантным диалогам через pgvector

## Системные требования

- **Docker** и **Docker Compose**
- **Windows**, **macOS**, **Linux** — полная поддержка

---

## Установка Docker

### macOS

```bash
# Вариант 1: Через Homebrew (рекомендуется)
brew install --cask docker

# Вариант 2: Скачайте Docker Desktop
# https://www.docker.com/products/docker-desktop/
```

После установки запустите Docker Desktop из Applications.

### Windows

1. Скачайте **Docker Desktop** с https://www.docker.com/products/docker-desktop/
2. Запустите установщик и следуйте инструкциям
3. Перезагрузите компьютер если потребуется
4. Запустите Docker Desktop

> **Примечание:** На Windows 10/11 Home может потребоваться включить WSL 2. Docker Desktop предложит это сделать автоматически.

### Linux (Ubuntu/Debian)

```bash
# Установка Docker
curl -fsSL https://get.docker.com | sudo sh

# Добавьте пользователя в группу docker (чтобы не использовать sudo)
sudo usermod -aG docker $USER

# Перезайдите в систему или выполните
newgrp docker
```

### Проверка установки

```bash
docker --version          # Docker version 24.x или выше
docker compose version    # Docker Compose version 2.x или выше
```

---

## Быстрый старт

### Шаг 1: Скачайте проект

```bash
git clone https://github.com/your-repo/lumie-ai.git
cd lumie-ai
```

Или скачайте ZIP и распакуйте.

---

### Шаг 2: Получите Gemini API ключ

1. Откройте https://aistudio.google.com/apikey
2. Нажмите **"Create API Key"**
3. Скопируйте ключ (он начинается с `AIza...`)

---

### Шаг 3: Получите Google Client ID

1. Перейдите на https://console.cloud.google.com/apis/credentials
2. Нажмите **"Create Credentials"** → **"OAuth client ID"**
3. Если просят настроить OAuth consent screen:
   - User Type: **External**
   - App name: **Lumie AI**
   - User support email: ваш email
   - Сохраните и вернитесь к credentials
4. Тип приложения: **Web application**
5. Name: **Lumie AI Web**
6. В **Authorized JavaScript origins** добавьте:
   - `http://localhost:3000`
   - `http://localhost`
7. Нажмите **Create**
8. Скопируйте **Client ID** (выглядит как `123456789-abc.apps.googleusercontent.com`)

---

### Шаг 4: Настройте переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
cp .env.example .env
```

```env
GEMINI_API_KEY="AIzaSy...ваш_ключ_здесь..."
GOOGLE_CLIENT_ID="123456789-abc.apps.googleusercontent.com"
APP_URL="http://localhost:3000"
```

---

### Шаг 5: Запустите приложение

```bash
docker compose up -d
```

Откройте в браузере: **http://localhost:3000**

---

## Готово!

Теперь вы можете:
1. Войти через Google
2. Пройти онбординг (выбрать языки и уровень)
3. Начать разговор с Lumie!

---

## Команды

| Команда                      | Описание                    |
|------------------------------|-----------------------------|
| `docker compose up -d`       | Запуск приложения           |
| `docker compose down`        | Остановка приложения        |
| `docker compose logs -f`     | Просмотр логов              |
| `docker compose logs -f app` | Логи только приложения      |
| `docker compose logs -f db`  | Логи только базы данных     |
| `docker compose restart`     | Перезапуск                  |
| `docker compose build`       | Пересборка образа           |

---

## Миграция данных из SQLite

Если вы обновляетесь со старой версии Lumie AI (на SQLite), можно перенести существующие данные:

```bash
# 1. Убедитесь, что контейнеры запущены
docker compose up -d

# 2. Скопируйте файл tutor.db в контейнер
docker cp tutor.db lumie-app:/app/tutor.db

# 3. Запустите миграцию
docker compose exec app npm run migrate:sqlite
```

Скрипт перенесёт:
- Пользователей и их настройки
- Историю разговоров и сообщения
- Память AI (включая embeddings для векторного поиска)
- Прогресс по темам

> **Примечание:** Миграция безопасна для повторного запуска — существующие данные не будут перезаписаны (`ON CONFLICT DO NOTHING`).

---

## Структура проекта

```
lumie-ai/
├── src/
│   ├── App.tsx              # Главный компонент
│   ├── components/          # UI компоненты
│   ├── hooks/               # React хуки
│   ├── services/            # Сервисы (Gemini, TTS)
│   ├── i18n/                # Локализация (en/ru)
│   └── db/
│       ├── client.ts        # PostgreSQL connection pool
│       └── migrations.ts    # Миграции базы данных
├── server.ts                # Express сервер
├── Dockerfile               # Docker образ приложения
├── docker-compose.yml       # Оркестрация сервисов
└── .env                     # Переменные окружения
```

---

## Технологии

- **Frontend:** React, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Express.js, PostgreSQL 16, pgvector
- **Infrastructure:** Docker, Docker Compose
- **AI:** Google Gemini API, Gemini Live API (голос)
- **Embeddings:** all-MiniLM-L6-v2 (локально через Xenova/transformers)

---

## Решение проблем

### "GEMINI_API_KEY not found"
Убедитесь, что файл `.env` существует и содержит ваш API ключ.

### "Rate limit exceeded" (429)
Бесплатный лимит Gemini — 20 запросов в минуту. Подождите минуту или используйте платный план.

### "Microphone access denied"
Нажмите на замок в адресной строке браузера → разрешите микрофон.

### "Cannot connect to database" / "ECONNREFUSED" / "EAI_AGAIN"
Перезапустите контейнеры:
```bash
docker compose down && docker compose up -d
```

Если не помогло, пересоздайте сеть:
```bash
docker compose down --remove-orphans
docker network prune -f
docker compose up -d
```

### "Port 3000 already in use"
Остановите другое приложение на порту 3000 или измените порт в `docker-compose.yml`.

---

## Лицензия

MIT

---

## Контакты

Если есть вопросы — создайте Issue на GitHub.