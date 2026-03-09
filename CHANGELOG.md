# Changelog - Lumie AI

Лог изменений проекта с описанием новых функций, исправлений и архитектурных решений.

---

## 2026-03-09

### Улучшенная система памяти AI

#### 45. Расширенный поиск по памяти и истории диалогов

**Проблема:**
- Система памяти была ограничена 5 фактами
- Отсутствовал поиск по истории диалогов
- Пользователь получал недостаточно контекста для персонализации

**Решение — объединённый семантический поиск:**

```
┌──────────────────────────────────────────────────────────────┐
│                    /api/memory/search                        │
│                                                              │
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │   memory table      │    │      messages table         │ │
│  │   LIMIT 50          │    │      LIMIT 20               │ │
│  │   similarity > 0.25 │    │      similarity > 0.25      │ │
│  └─────────────────────┘    └─────────────────────────────┘ │
│                    ↓                      ↓                  │
│              ┌────────────────────────────────────┐         │
│              │     Объединённый результат         │         │
│              │     отсортирован по similarity     │         │
│              └────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────┘
```

**Изменения:**

| Файл | Описание |
|------|----------|
| `src/db/migrations.ts` | Миграция v5: колонка `embedding vector(384)` в messages + IVFFlat индекс |
| `server.ts` | Endpoint `/api/messages` принимает и сохраняет embedding |
| `server.ts` | Endpoint `/api/memory/search` ищет в memory (50) + messages (20) |
| `src/App.tsx` | Передаёт embedding при сохранении user-сообщений |

**Новые параметры:**

| Параметр | Было | Стало |
|----------|------|-------|
| LIMIT memory | 5 | 50 |
| LIMIT messages | — | 20 |
| Порог similarity | 0.3 | 0.25 |

**Миграция v5 (add_messages_embedding):**

```sql
-- Добавление колонки для эмбеддингов сообщений
ALTER TABLE messages ADD COLUMN embedding vector(384);

-- IVFFlat индекс для быстрого векторного поиска
CREATE INDEX idx_messages_embedding ON messages
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**API изменения:**

`POST /api/messages` теперь принимает опциональный `embedding`:
```typescript
{
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: string;
  embedding?: number[]; // 384 dimensions, optional
}
```

`POST /api/memory/search` возвращает объединённые результаты:
```typescript
{
  source: 'memory' | 'message';
  id: number;
  topic: string;
  content: string;
  similarity: number;
}[]
```

**Результат:**
- AI получает до 70 релевантных фрагментов контекста
- Поиск работает по фактам о пользователе И по истории диалогов
- Новые сообщения автоматически индексируются для будущего поиска

---

### Миграция на PostgreSQL + Docker

#### 41. Переход с SQLite на PostgreSQL с pgvector

**Причины миграции:**
- sqlite-vss не поддерживается на Windows
- Ограниченная масштабируемость SQLite
- Необходимость в production-ready решении
- pgvector предоставляет более эффективный векторный поиск

**Новая архитектура:**

```
┌─────────────────────────────────────────────────────┐
│                 docker-compose                       │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │   lumie-app     │    │      lumie-db           │ │
│  │   (Node.js)     │───▶│   (PostgreSQL 16)       │ │
│  │   Port: 3000    │    │   + pgvector extension  │ │
│  └─────────────────┘    │   Port: 5433            │ │
│                         │   Volume: pgdata        │ │
│                         └─────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Созданные файлы:**

| Файл | Описание |
|------|----------|
| `Dockerfile` | Multi-stage Node.js образ |
| `docker-compose.yml` | PostgreSQL + App оркестрация |
| `.dockerignore` | Исключения для Docker build |
| `src/db/client.ts` | PostgreSQL connection pool |
| `.env.example` | Шаблон переменных окружения |

**Изменённые файлы:**

| Файл | Изменения |
|------|-----------|
| `server.ts` | Async/await, $1/$2 placeholders, pgvector |
| `src/db/migrations.ts` | PostgreSQL синтаксис, vector(384), IVFFlat index |
| `package.json` | pg вместо better-sqlite3/sqlite-vss |

**Ключевые преобразования SQL:**

| SQLite | PostgreSQL |
|--------|------------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `BLOB` | `vector(384)` |
| `?` placeholders | `$1, $2, $3...` |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT DO UPDATE` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `vss_search()` | `embedding <=> $1::vector` |
| `db.prepare().get()` | `await queryOne()` |
| `db.prepare().all()` | `await query()` |

**PostgreSQL client (`src/db/client.ts`):**

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

export async function query<T>(sql: string, params?: any[]): Promise<T[]>;
export async function queryOne<T>(sql: string, params?: any[]): Promise<T | null>;
export async function execute(sql: string, params?: any[]): Promise<QueryResult>;
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
```

**Новые миграции:**

1. `enable_pgvector` — CREATE EXTENSION vector
2. `initial_schema` — users, conversations, messages, memory с vector(384)
3. `add_indexes` — индексы для производительности
4. `add_vector_index` — IVFFlat индекс для косинусного расстояния

**Векторный поиск (pgvector):**

```sql
SELECT id, topic, summary,
       1 - (embedding <=> $1::vector) as similarity
FROM memory
WHERE user_id = $2 AND embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 5
```

**Команды запуска:**

```bash
# Только PostgreSQL (для локальной разработки)
docker-compose up -d db
npm run dev

# Полностью в Docker (production)
docker-compose up -d
docker-compose logs -f app
```

**Удалённые зависимости:**
- `better-sqlite3`
- `sqlite-vss`
- `@types/better-sqlite3`

**Добавленные зависимости:**
- `pg` — PostgreSQL клиент
- `@types/pg` — TypeScript типы

**Архитектурные решения:**

| Критерий | SQLite | PostgreSQL |
|----------|--------|------------|
| Кроссплатформенность | ❌ sqlite-vss не работает на Windows | ✅ Docker везде |
| Масштабируемость | Ограничена | Высокая |
| Векторный поиск | sqlite-vss (экспериментальный) | pgvector (production-ready) |
| Деплой | Файловая БД | Контейнер |
| Concurrent writes | Ограничены | Полная поддержка |

**Почему pgvector:**
- Нативная поддержка в PostgreSQL 16+
- IVFFlat индексы для O(log n) поиска
- Поддержка разных метрик (L2, cosine, inner product)
- Активное развитие и community

---

#### 44. Миграция данных из SQLite

**Скрипт:** `scripts/migrate-sqlite-to-postgres.ts`

```bash
npm run migrate:sqlite
```

**Что мигрируется:** users, conversations, messages, memory, user_progress

**Особенности:**
- `ON CONFLICT DO NOTHING` для безопасного повторного запуска
- Обновление sequences для auto-increment полей
- Конвертация embeddings из JSON/BLOB в pgvector формат

---

#### 42. Выбор персонажа и системный промпт

- Добавлена возможность выбора персонажа (Lumie/Leo)
- Персонализированные системные промпты для каждого персонажа
- Сохранение выбора в профиле пользователя

---

#### 43. UserContextManager для семантического поиска

- Класс для управления пользовательскими воспоминаниями
- Интеграция с embeddings (all-MiniLM-L6-v2)
- Методы: `addMemory()`, `searchMemories()`, `getUserContext()`

---

### Статус проекта (обновлённый)

| Метрика | Значение |
|---------|----------|
| Тестов | 126 |
| Build | ✅ Успешно |
| TypeCheck | ✅ Без ошибок |
| База данных | ✅ PostgreSQL 16 + pgvector |
| Docker | ✅ docker-compose ready |
| Векторный поиск | ✅ pgvector IVFFlat |
| Кроссплатформенность | ✅ Windows/macOS/Linux |

---

## 2026-02-28

### Критические исправления безопасности

#### 1. XSS в OAuth callback (`server.ts`)
- Добавлена функция `sanitizeForHtml()` для экранирования HTML
- JSON данные экранируются через замену `<`, `>`, `&`, `'`
- `postMessage` теперь использует конкретный origin вместо `'*'`

#### 2. Open Redirect (`server.ts`)
- Добавлена функция `isAllowedOrigin()` с whitelist разрешённых доменов
- Валидация `origin` и `state` параметров перед использованием
- Возврат ошибки 400 для недоверенных origins

#### 3. Валидация входных данных (`server.ts`)
- Добавлены функции валидации:
  - `isValidString()` - проверка строк с ограничением длины
  - `isValidLanguage()` - whitelist языков
  - `isValidGender()` - whitelist значений
  - `isValidLevel()` - whitelist CEFR уровней
  - `isValidAge()` - числовая валидация (1-150)
  - `isValidUrl()` - проверка URL
- Все endpoints теперь валидируют входящие данные
- Ограничения на длину строк и допустимые значения

#### 4. API Key защита (`server.ts` + `App.tsx`)
- Новый endpoint `/api/config/live-api-key` с rate limiting
- API key больше не используется напрямую на клиенте через `process.env`
- Проверка авторизации пользователя перед выдачей ключа
- Rate limit: 10 запросов в минуту на пользователя

---

### Важные исправления

#### 5. Модульность - кастомные хуки (`src/hooks/`)

| Файл | Описание |
|------|----------|
| `useAuth.ts` | Аутентификация, localStorage, OAuth, refresh user |
| `useTTS.ts` | Text-to-Speech с очередями без race conditions |
| `useVoiceRecognition.ts` | Web Speech API, permissions, language switching |
| `useMessages.ts` | Сообщения, streaming, fact extraction |
| `index.ts` | Экспорт всех хуков |

#### 6. Error Boundary (`src/components/ErrorBoundary.tsx`)
- React Error Boundary для отлова ошибок компонентов
- Красивый fallback UI с информацией об ошибке
- Кнопки "Try Again" и "Reload"
- Хук `useErrorHandler()` для функциональных компонентов
- Компонент `AsyncBoundary` для async операций

#### 7. Race Conditions в TTS (`src/hooks/useTTS.ts`)
- Использование `useRef` для очередей вместо `useState`
- Избежание stale closures в async операциях
- Правильная последовательность: synthesis → queue → playback
- Методы: `speak()`, `queueText()`, `stop()`, `clearQueue()`

#### 8. Замена ScriptProcessorNode (`src/services/liveService.ts`)
- Добавлен `AudioWorklet` (современный API без memory leaks)
- Inline Blob для worklet кода (не требует отдельного файла)
- Fallback на `ScriptProcessor` для старых браузеров
- Улучшенное управление памятью и cleanup
- Класс `AudioRecorder` для инкапсуляции логики записи

#### 9. Индексы базы данных (`server.ts`)
```sql
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_memory_user_id ON memory(user_id);
```

#### 10. ErrorBoundary в main.tsx
- Обёртка приложения в `ErrorBoundary`
- Глобальный обработчик ошибок с логированием

---

### Новые файлы

```
src/
├── components/
│   └── ErrorBoundary.tsx      # Error boundary компонент
├── hooks/
│   ├── index.ts               # Экспорт хуков
│   ├── useAuth.ts             # Хук аутентификации
│   ├── useMessages.ts         # Хук сообщений
│   ├── useTTS.ts              # Хук Text-to-Speech
│   └── useVoiceRecognition.ts # Хук распознавания речи
```

### Изменённые файлы

| Файл | Изменения |
|------|-----------|
| `server.ts` | Валидация, безопасность OAuth, индексы БД, rate limiting |
| `src/App.tsx` | API key через endpoint, замена `{{name}}` в systemPrompt |
| `src/main.tsx` | Добавлен ErrorBoundary |
| `src/services/liveService.ts` | AudioWorklet вместо ScriptProcessor |
| `CODE_REVIEW.md` | Обновлён статус исправлений |

---

### Желательные улучшения

#### 11. Типизация (`src/types/index.ts`)
- Создан единый файл типов для всего проекта
- Типы: `User`, `Message`, `Conversation`, `Memory`, `Topic`, `LessonData`, `Exercise`
- Интерфейсы для API ответов и состояний
- Устранение использования `any` через строгую типизацию

#### 12. ESLint и Prettier (`.eslintrc.cjs`, `.prettierrc`, `.prettierignore`)
- ESLint с поддержкой TypeScript и React
- Настроенные правила для React Hooks
- Prettier для форматирования кода
- Интеграция ESLint + Prettier

#### 13. Система миграций БД (`src/db/migrations.ts`)
- Класс `MigrationRunner` для управления миграциями
- Отслеживание версий через таблицу `_migrations`
- Поддержка rollback
- 5 готовых миграций:
  1. Создание таблицы users
  2. Создание таблицы conversations
  3. Создание таблицы messages
  4. Создание таблицы memory
  5. Добавление индексов

#### 14. i18n локализация (`src/i18n/`)
- Система интернационализации с хуком `useTranslation()`
- Поддержка интерполяции (`{{name}}`, `{{language}}`)
- Локали:
  - `en.ts` - Английский
  - `ru.ts` - Русский
- Функции: `t()`, `setLocale()`, `getLocale()`

#### 15. Мемоизация компонентов
- `MessageBubble.tsx` - React.memo с кастомным comparator
- `MessageList.tsx` - Мемоизированный список сообщений
- Оптимизация re-renders для чата

#### 16. Unit тесты (`src/__tests__/`)
- `utils.test.ts`:
  - Тесты для `cn()` (className merge)
  - Тесты для `pcmToWav()` (WAV конвертация)
- `hooks.test.ts`:
  - Тесты для `extractSentences()` (парсинг предложений)
  - Тесты для `useAuth()` (аутентификация)

---

### Новые файлы

```
src/
├── __tests__/
│   ├── setup.ts                  # Setup файл для тестов
│   ├── hooks.test.ts             # Тесты для хуков
│   └── utils.test.ts             # Тесты для утилит
├── components/
│   ├── ErrorBoundary.tsx         # Error boundary компонент
│   ├── MessageBubble.tsx         # Мемоизированный пузырь сообщения
│   └── MessageList.tsx           # Мемоизированный список сообщений
├── db/
│   └── migrations.ts             # Система миграций БД
├── hooks/
│   ├── index.ts                  # Экспорт хуков
│   ├── useAuth.ts                # Хук аутентификации
│   ├── useMessages.ts            # Хук сообщений
│   ├── useTTS.ts                 # Хук Text-to-Speech
│   └── useVoiceRecognition.ts    # Хук распознавания речи
├── i18n/
│   ├── index.ts                  # Ядро i18n системы
│   └── locales/
│       ├── en.ts                 # Английская локаль
│       └── ru.ts                 # Русская локаль
└── types/
    └── index.ts                  # Централизованные типы

.eslintrc.cjs                     # Конфигурация ESLint
.prettierrc                       # Конфигурация Prettier
.prettierignore                   # Игнорируемые файлы Prettier
vitest.config.ts                  # Конфигурация Vitest
```

### Изменённые файлы

| Файл | Изменения |
|------|-----------|
| `server.ts` | Валидация, безопасность OAuth, индексы БД, rate limiting |
| `src/App.tsx` | API key через endpoint, замена `{{name}}` в systemPrompt |
| `src/main.tsx` | Добавлен ErrorBoundary |
| `src/services/liveService.ts` | AudioWorklet вместо ScriptProcessor |
| `CODE_REVIEW.md` | Обновлён статус исправлений |
| `package.json` | Добавлены scripts и devDependencies для ESLint, Prettier, Vitest |

---

### Конфигурация package.json (✅ Выполнено)

**Обновлённые scripts:**
```json
{
  "typecheck": "tsc --noEmit",
  "lint": "eslint src --ext .ts,.tsx",
  "lint:fix": "eslint src --ext .ts,.tsx --fix",
  "format": "prettier --write \"src/**/*.{ts,tsx,css}\"",
  "format:check": "prettier --check \"src/**/*.{ts,tsx,css}\"",
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage"
}
```

**Добавленные devDependencies:**
- `@testing-library/react` - тестирование React компонентов
- `@types/better-sqlite3`, `@types/react`, `@types/react-dom` - TypeScript типы
- `@typescript-eslint/*` - ESLint для TypeScript
- `eslint`, `eslint-config-prettier`, `eslint-plugin-react*` - линтинг
- `prettier` - форматирование кода
- `vitest`, `jsdom` - тестирование

**Новые файлы:**
- `vitest.config.ts` - конфигурация Vitest
- `src/__tests__/setup.ts` - setup файл для тестов

**Установка зависимостей:**
```bash
npm install
```

---

---

## 2026-02-28 (Обновление)

### Новые хуки

#### 17. useLanguageSettings (`src/hooks/useLanguageSettings.ts`)
- Управление языковыми настройками пользователя
- Синхронизация с localStorage и сервером
- Поддержка распознавания речи (BCP-47 коды)
- Возвращает: `nativeLang`, `targetLang`, `provider`, `updateLanguages()`

#### 18. useCurriculumState (`src/hooks/useCurriculumState.ts`)
- Управление состоянием учебного плана
- Отслеживание прогресса по темам и уровням CEFR
- Синхронизация прогресса с сервером
- Возвращает: `curriculum`, `currentLevel`, `completedTopics`, `completeTopic()`, `getProgressPercent()`

---

### Интеграция i18n в компоненты

#### 19. ErrorBoundary.tsx
- Заменены хардкод строки на вызовы `t()`
- Ключи: `error.title`, `error.description`, `error.details`, `error.tryAgain`, `error.reload`

#### 20. MessageBubble.tsx
- Заменены хардкод строки на вызовы `t()`
- Ключи: `ui.readAloud`, `lesson.learningCard`

#### 21. App.tsx
- Добавлен хук `useTranslation()`
- Заменены хардкод строки в onboarding секции на `t()`

#### 22. Новые ключи локализации
Добавлены в `en.ts` и `ru.ts`:
```typescript
'ui.readAloud': 'Read aloud' / 'Слушать вслух',
'error.onboardingFailed': 'Something went wrong during onboarding. Please try again.',
'error.micInstructions': 'To enable microphone access...',
'error.title': 'Something went wrong',
'error.description': 'An unexpected error occurred...',
'error.details': 'Error details',
'error.tryAgain': 'Try Again',
'error.reload': 'Reload'
```

---

### Расширенная тестовая инфраструктура

#### 23. Тестовые моки (`src/__tests__/mocks/`)
| Файл | Описание |
|------|----------|
| `geminiService.mock.ts` | Мок для AI сервиса (generateResponse, generateSpeech, extractFacts) |
| `audioContext.mock.ts` | Мок для AudioContext и HTMLAudioElement |
| `fetch.mock.ts` | Мок для fetch API с предустановленными ответами |

#### 24. Тестовые хелперы (`src/__tests__/helpers.ts`)
- `createMockUser()` - создание тестового пользователя
- `createMockMessage()` - создание тестового сообщения
- `createMockConversation()` - создание тестовой беседы
- `createMockTopic()` - создание тестовой темы
- `createMockLessonData()` - создание тестовых данных урока

#### 25. Unit тесты хуков (`src/__tests__/hooks/`)
| Файл | Тестов | Описание |
|------|--------|----------|
| `useTTS.test.ts` | 13 | TTS очереди, extractSentences |
| `useMessages.test.ts` | 10 | Сообщения, streaming, факты |
| `useVoiceRecognition.test.ts` | 10 | Распознавание речи, permissions |
| `useCurriculumState.test.ts` | 14 | Прогресс, уровни, темы |
| `useLanguageSettings.test.ts` | 11 | Языковые настройки |

#### 26. Component тесты (`src/__tests__/components/`)
| Файл | Тестов | Описание |
|------|--------|----------|
| `ErrorBoundary.test.tsx` | 13 | Error boundary, recovery, callbacks |
| `MessageBubble.test.tsx` | 8 | Отображение сообщений, TTS |
| `MessageList.test.tsx` | 6 | Список сообщений, автоскролл |

#### 27. Service тесты (`src/__tests__/services/`)
| Файл | Тестов | Описание |
|------|--------|----------|
| `geminiService.test.ts` | 10 | System instruction, моки API |
| `liveService.test.ts` | 13 | PCMAudioPlayer, AudioRecorder |

**Итого: 126 тестов в 12 файлах**

---

### CI/CD Workflows

#### 28. GitHub Actions (`.github/workflows/`)

**test.yml** - Тесты
```yaml
- Запуск на push/PR в main, master, develop
- Node.js 20
- npm ci && npm run test:run
- Coverage report
```

**lint.yml** - Линтинг
```yaml
- ESLint с ESLINT_USE_FLAT_CONFIG=false (для legacy config)
- Prettier проверка форматирования
- TypeScript typecheck
```

**build.yml** - Сборка
```yaml
- Проверка production build
- npm run build
```

---

### Исправления

#### 29. Фикс тестов useTTS
- Добавлен мок `@google/genai` для предотвращения ошибки API key
- Исправлены ожидания тестов extractSentences

#### 30. Фикс ESLint
- Удалён плагин `react-refresh` (несовместимость версий)
- Добавлена поддержка legacy конфига через env variable

---

### Новые файлы

```
src/
├── __tests__/
│   ├── mocks/
│   │   ├── geminiService.mock.ts
│   │   ├── audioContext.mock.ts
│   │   └── fetch.mock.ts
│   ├── hooks/
│   │   ├── useTTS.test.ts
│   │   ├── useMessages.test.ts
│   │   ├── useVoiceRecognition.test.ts
│   │   ├── useCurriculumState.test.ts
│   │   └── useLanguageSettings.test.ts
│   ├── components/
│   │   ├── ErrorBoundary.test.tsx
│   │   ├── MessageBubble.test.tsx
│   │   └── MessageList.test.tsx
│   ├── services/
│   │   ├── geminiService.test.ts
│   │   └── liveService.test.ts
│   └── helpers.ts
├── hooks/
│   ├── useLanguageSettings.ts
│   └── useCurriculumState.ts
.github/
└── workflows/
    ├── test.yml
    ├── lint.yml
    └── build.yml
```

### Изменённые файлы

| Файл | Изменения |
|------|-----------|
| `src/hooks/index.ts` | Добавлен экспорт новых хуков |
| `src/i18n/locales/en.ts` | Добавлены новые ключи локализации |
| `src/i18n/locales/ru.ts` | Добавлены новые ключи локализации |
| `src/components/ErrorBoundary.tsx` | Интеграция i18n |
| `src/components/MessageBubble.tsx` | Интеграция i18n |
| `src/App.tsx` | Интеграция useTranslation |
| `.eslintrc.cjs` | Удалён react-refresh plugin |
| `src/__tests__/setup.ts` | Добавлен import jest-dom/vitest |

---

### Статус проекта

| Метрика | Значение |
|---------|----------|
| Тестов | 126 |
| Тестовых файлов | 12 |
| Build | ✅ Успешно |
| TypeCheck | ✅ Без ошибок |
| CI/CD | ✅ Настроен |

### Все задачи выполнены

- [x] Полный рефакторинг App.tsx с использованием созданных хуков
- [x] Интеграция i18n в компоненты
- [x] Добавить больше unit и integration тестов (126 тестов)
- [x] Настроить CI/CD с запуском тестов

---

## 2026-02-28 (Вечернее обновление)

### 31. Исправление распознавания речи (`App.tsx`)

**Проблемы:**
- Распознавание стартовало и сразу завершалось
- Не запрашивалось разрешение на микрофон при первом использовании
- Промежуточные результаты терялись при быстрой остановке

**Исправления:**
- `continuous = true` — слушает до ручной остановки
- `interimResults = true` — показывает текст в реальном времени
- Добавлен `lastTranscriptRef` для сохранения промежуточных результатов
- Запрос разрешения микрофона при `micPermission !== 'granted'`
- Добавлены события диагностики: `onaudiostart`, `onspeechstart`, `onspeechend`
- Фильтрация ошибок `network` и `aborted` при остановке

### 32. Улучшение Error Correction в Ultra-Fast Mode (`geminiService.ts`)

**Добавлена секция ERROR CORRECTION (CRITICAL) в TUTOR_SYSTEM_INSTRUCTION:**

```
Когда пользователь делает ошибку в {{target_lang}}, ты ДОЛЖЕН:
a) НЕМЕДЛЕННО переключиться на {{native_lang}} для объяснения
b) Сказать что он сказал неправильно
c) Показать как ПРАВИЛЬНО сказать на {{target_lang}}
d) Кратко объяснить ПОЧЕМУ на {{native_lang}}
e) Затем продолжить разговор
```

### 33. Интеграция sqlite-vss для векторного поиска (`server.ts`)

**До (медленный O(n) поиск):**
```javascript
// Загрузка ВСЕХ записей в память
const rows = db.prepare("SELECT ... FROM memory").all(userId);
// Сравнение каждого вектора в JavaScript
rows.map(row => cosineSimilarity(embedding, rowEmbedding));
```

**После (быстрый O(log n) поиск с Faiss):**
```sql
-- VSS использует Faiss под капотом
SELECT rowid, distance FROM vss_memory
WHERE vss_search(embedding, ?)
LIMIT 20
```

**Изменения:**
- Установлен пакет `sqlite-vss`
- Добавлена загрузка расширения: `sqlite_vss.load(db)`
- Создана виртуальная таблица `vss_memory` с размерностью 384 (all-MiniLM-L6-v2)
- Обновлён endpoint `/api/memory/add` — вставка в обе таблицы
- Обновлён endpoint `/api/memory/search` — использует VSS поиск
- Добавлен fallback на обычный запрос если VSS недоступен

**Архитектура БД:**

| Таблица | Назначение |
|---------|------------|
| `memory` | Метаданные (user_id, topic, summary) |
| `vss_memory` | Векторный индекс Faiss (embedding 384d) |

---

### Новые зависимости

```json
{
  "sqlite-vss": "^0.1.2"
}
```

### Изменённые файлы

| Файл | Изменения |
|------|-----------|
| `server.ts` | sqlite-vss интеграция, VSS таблица, обновлённые endpoints |
| `src/App.tsx` | Улучшенное распознавание речи с interim results |
| `src/services/geminiService.ts` | ERROR CORRECTION секция в system instruction |
| `package.json` | Добавлен sqlite-vss |

---

### Статус проекта (обновлённый)

| Метрика | Значение |
|---------|----------|
| Тестов | 126 |
| Build | ✅ Успешно |
| TypeCheck | ✅ Без ошибок |
| Векторная БД | ✅ sqlite-vss (Faiss) |
| Speech Recognition | ✅ С interim results |
| Error Correction | ✅ На родном языке |
| Google Sign-In | ✅ Google Identity Services |

---

### 34. Упрощение Google авторизации

**Проблема:**
- Старая OAuth 2.0 реализация требовала `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`
- При отсутствии credentials выдавалась ошибка "Please add GOOGLE_CLIENT_ID to environment variables"

**Решение - Google Identity Services:**

Перешли на Google Identity Services (Sign In With Google) — современный подход:
- Нужен только `GOOGLE_CLIENT_ID` (без SECRET)
- Официальная кнопка "Sign in with Google" от Google
- Верификация ID токена на бэкенде
- Автоматический fallback на demo mode если credentials не настроены

**Новые endpoints (`server.ts`):**

```typescript
// Получить Client ID для фронтенда
GET /api/auth/google-client-id
// → { clientId: string | null, demoMode: boolean }

// Авторизация с ID токеном
POST /api/auth/google
// Body: { credential: string }
// → User object
```

**Frontend (`App.tsx`):**

```typescript
// Google Sign-In button рендерится автоматически
<div ref={googleButtonRef} />

// При получении credential отправляется на сервер
const handleGoogleCredential = async (credential: string) => {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential })
  });
  // ...
};
```

**Обновлённый `useAuth.ts`:**
- `googleClientId` - ID клиента для Google Sign-In
- `isDemoMode` - флаг demo режима
- `renderGoogleButton()` - функция для рендеринга кнопки

**Изменённые файлы:**

| Файл | Изменения |
|------|-----------|
| `index.html` | Добавлен Google GSI script |
| `server.ts` | Новые endpoints, OAuth2Client verification |
| `src/App.tsx` | Google Sign-In button, handleGoogleCredential |
| `src/hooks/useAuth.ts` | Google Identity Services интеграция |
| `.env.local` | Убран GOOGLE_CLIENT_SECRET |
| `.env.example` | Обновлены инструкции |

**Как настроить:**

1. Перейти на https://console.cloud.google.com/apis/credentials
2. Создать OAuth 2.0 Client ID (Web application)
3. Добавить Authorized JavaScript origins: `http://localhost:3000`
4. Скопировать Client ID в `.env.local`

**Demo mode:**
Если `GOOGLE_CLIENT_ID` не настроен — приложение автоматически работает в demo режиме с guest пользователем

---

### 35. Обработка Rate Limit ошибок (429)

**Проблема:**
- При достижении лимита Gemini API приложение уходило в бесконечный цикл запросов
- Пользователь видел техническую ошибку вместо понятного сообщения

**Решение:**

```typescript
// Предотвращение повторных вызовов
const greetingAttemptedRef = useRef<string | null>(null);

// В triggerAiGreeting
if (greetingAttemptedRef.current === convId) return;
greetingAttemptedRef.current = convId;

// Обработка 429 ошибки
if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
  setRateLimitError(t('error.rateLimit'));
  setMessages([{
    content: `⏳ ${t('error.rateLimitMessage')}`,
    // ...
  }]);
}
```

**Добавлены локализации:**
- `error.rateLimit` — "API rate limit reached..."
- `error.rateLimitMessage` — "I need a short break!..."

---

### 36. Кастомная кнопка Google Sign-In

**Проблема:**
- Стандартная кнопка Google выбивалась из дизайна приложения

**Решение:**
- Вернули кастомную кнопку с оригинальным дизайном (#2D2D2D фон)
- Добавили цветной SVG логотип Google
- При клике вызывается Google One Tap
- Fallback на demo mode при ошибке

```tsx
<button onClick={() => {
  if (googleClientId && !isDemoMode) {
    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        handleDemoLogin(); // fallback
      }
    });
  }
}}>
  <svg>...</svg> {/* Google logo */}
  {t('auth.continueWithGoogle')}
</button>
```

---

### 37. Удалён HUGGINGFACE_API_KEY

- Ключ нигде не использовался (артефакт от ранней версии)
- Удалён из `.env.local` и `.env.example`

**Текущие переменные окружения:**
- `GEMINI_API_KEY` — для AI (обязательно)
- `GOOGLE_CLIENT_ID` — для авторизации (обязательно)
- `APP_URL` — URL приложения

---

### 38. Интеграция системы миграций БД

**Проблема:**
- Таблицы создавались вручную в `server.ts`
- Миграции существовали в `src/db/migrations.ts`, но не использовались

**Решение:**

```typescript
// server.ts
import { runMigrations } from "./src/db/migrations.js";

// Загрузка VSS extension (должен быть до миграций)
sqlite_vss.load(db);

// Запуск миграций
runMigrations(db);
```

**Добавлена миграция 6 — vss_memory:**

```typescript
{
  version: 6,
  name: 'add_vss_memory_table',
  up: db => {
    const vssLoaded = db.prepare(
      "SELECT * FROM pragma_module_list WHERE name = 'vss0'"
    ).get();

    if (vssLoaded) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vss_memory USING vss0(
          embedding(384)
        );
      `);
    }
  }
}
```

**Текущие миграции:**
1. `initial_schema` — users, conversations, messages, memory
2. `add_indexes` — индексы для производительности
3. `add_user_settings` — provider, ollama_url, ollama_model
4. `add_message_metadata` — tokens, model
5. `add_memory_indexes_for_search` — idx_memory_topic, idx_memory_created_at
6. `add_vss_memory_table` — виртуальная таблица для векторного поиска

---

### 39. Обновлён README.md

Полностью переписан README с пошаговой инструкцией установки:

1. Установка Node.js (macOS/Windows)
2. Скачивание проекта
3. Установка зависимостей
4. Получение Gemini API ключа
5. Получение Google Client ID (обязательно)
6. Настройка .env.local
7. Запуск приложения

**Добавлены разделы:**
- Команды (npm scripts)
- Структура проекта
- Технологии
- Решение проблем (FAQ)

---

### 40. JavaScript Fallback для векторного поиска (Windows)

**Проблема:**
- sqlite-vss не поддерживает Windows (зависит от C++ библиотек)
- Пользователи Windows не могли использовать функционал памяти

**Решение — JavaScript fallback:**

```typescript
// server.ts

// Отслеживание доступности VSS
let vssAvailable = false;
try {
  sqlite_vss.load(db);
  vssAvailable = true;
  console.log("sqlite-vss loaded successfully");
} catch (e) {
  console.warn("sqlite-vss not available (this is expected on Windows)");
}

// Функция косинусного сходства на JS
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**Обновлённый endpoint `/api/memory/search`:**

```typescript
app.post("/api/memory/search", async (req, res) => {
  const { userId, query } = req.body;
  const embedding = await generateEmbedding(query);

  if (!vssAvailable) {
    // JavaScript fallback для Windows
    const rows = db.prepare(
      "SELECT id, topic, summary, embedding FROM memory WHERE user_id = ?"
    ).all(userId);

    const results = rows
      .map(row => {
        const storedEmbedding = JSON.parse(row.embedding);
        const similarity = cosineSimilarity(embedding, storedEmbedding);
        return { id: row.id, topic: row.topic, summary: row.summary, similarity };
      })
      .filter(r => r.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    return res.json(results);
  }

  // VSS поиск (macOS/Linux)
  // ...
});
```

**Хранение embedding:**

Embeddings теперь сохраняются как JSON строка в поле `embedding` таблицы `memory`, что позволяет использовать их как в VSS (через vss_memory), так и в JS fallback:

```typescript
// При сохранении
db.prepare(
  "INSERT INTO memory (user_id, topic, summary, embedding) VALUES (?, ?, ?, ?)"
).run(userId, topic, summary, JSON.stringify(embedding));

// При чтении (JS fallback)
const storedEmbedding = JSON.parse(row.embedding);
```

**Производительность:**

| Метод | Сложность | Подходит для |
|-------|-----------|--------------|
| sqlite-vss (Faiss) | O(log n) | Большие БД (1000+ записей) |
| JS fallback | O(n) | Малые/средние БД (<1000 записей) |

Для типичного пользователя с <100 воспоминаний JS fallback работает мгновенно (<10ms).

**Обновлён README:**
- Windows теперь полностью поддерживается
- Добавлен раздел в FAQ: "sqlite-vss not available (Windows)"

---

### Статус проекта (финальный)

| Метрика | Значение |
|---------|----------|
| Тестов | 126 |
| Build | ✅ Успешно |
| TypeCheck | ✅ Без ошибок |
| Миграции БД | ✅ 6 миграций |
| Векторная БД | ✅ sqlite-vss + JS fallback |
| Windows Support | ✅ Полная поддержка |
| Google Sign-In | ✅ Обязательно |
| Rate Limit | ✅ Обработка 429 |
| README | ✅ Полная документация |
