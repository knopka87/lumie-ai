# Lumie AI - Your Personal Language Tutor

Lumie AI — это интерактивный AI-репетитор для изучения языков с голосовым управлением, персонализированными уроками и системой запоминания.

## Возможности

- **Голосовое общение** — разговаривайте с AI на изучаемом языке
- **Ultra-Fast режим** — мгновенные ответы через Gemini Live API
- **Исправление ошибок** — AI объясняет ваши ошибки на родном языке
- **Персонализация** — AI запоминает информацию о вас
- **Учебный план CEFR** — 250+ тем от A1 до C2
- **Векторный поиск** — умный поиск по памяти через sqlite-vss

## Системные требования

- **Node.js** 18+
- **Windows**, **macOS**, **Linux** — полная поддержка

---

## Быстрый старт (5 минут)

### Шаг 1: Установите Node.js

Если у вас ещё нет Node.js:

**macOS:**
```bash
brew install node
```

**Windows:**
Скачайте и установите с https://nodejs.org (выберите LTS версию)

**Проверьте установку:**
```bash
node --version   # должно показать v18 или выше
npm --version    # должно показать 9 или выше
```

---

### Шаг 2: Скачайте проект

```bash
git clone https://github.com/your-repo/lumie-ai.git
cd lumie-ai
```

Или скачайте ZIP и распакуйте.

---

### Шаг 3: Установите зависимости

```bash
npm install
```

Подождите пока установятся все пакеты (может занять 1-2 минуты).

---

### Шаг 4: Получите Gemini API ключ

1. Откройте https://aistudio.google.com/apikey
2. Нажмите **"Create API Key"**
3. Скопируйте ключ (он начинается с `AIza...`)

---

### Шаг 5: Получите Google Client ID

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

### Шаг 6: Настройте переменные окружения

Откройте файл `.env` и заполните:

```env
GEMINI_API_KEY="AIzaSy...ваш_ключ_здесь..."
GOOGLE_CLIENT_ID="123456789-abc.apps.googleusercontent.com"
APP_URL="http://localhost:3000"
```

---

### Шаг 7: Запустите приложение

```bash
npm run dev
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

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск в режиме разработки |
| `npm run build` | Сборка для продакшена |
| `npm run test` | Запуск тестов (watch mode) |
| `npm run test:run` | Запуск тестов (однократно) |
| `npm run lint` | Проверка кода ESLint |
| `npm run typecheck` | Проверка типов TypeScript |

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
│   └── db/                  # Миграции базы данных
├── server.ts                # Express сервер
├── tutor.db                 # SQLite база данных
└── .env.local               # Переменные окружения
```

---

## Технологии

- **Frontend:** React, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Express.js, SQLite, sqlite-vss (векторный поиск)
- **AI:** Google Gemini API, Gemini Live API (голос)
- **Embeddings:** all-MiniLM-L6-v2 (локально через Xenova/transformers)

---

## Решение проблем

### "GEMINI_API_KEY not found"
Убедитесь, что файл `.env.local` существует и содержит ваш API ключ.

### "Rate limit exceeded" (429)
Бесплатный лимит Gemini — 20 запросов в минуту. Подождите минуту или используйте платный план.

### "Microphone access denied"
Нажмите на замок в адресной строке браузера → разрешите микрофон.

### "sqlite-vss not available" (Windows)
Это нормально! На Windows sqlite-vss не поддерживается. Приложение автоматически использует JavaScript fallback для векторного поиска. Функционально разницы нет.

---

## Лицензия

MIT

---

## Контакты

Если есть вопросы — создайте Issue на GitHub.
