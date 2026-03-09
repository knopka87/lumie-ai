# Development Log - Lumie AI

Журнал разработки с описанием ключевых изменений и решений.

---

## 2026-03-09

### Миграция на PostgreSQL + Docker

**Коммит:** `842785d` - Migrate from SQLite to PostgreSQL with pgvector

**Мотивация:**
- sqlite-vss имел проблемы с кроссплатформенностью (не работал на Windows)
- Необходимость в production-ready решении для деплоя
- pgvector предоставляет более эффективные индексы для векторного поиска (IVFFlat)

**Что сделано:**

1. **Docker инфраструктура**
   - `Dockerfile` — multi-stage build для Node.js приложения
   - `docker-compose.yml` — PostgreSQL 16 (pgvector/pgvector:pg16) + App
   - Healthcheck для PostgreSQL перед запуском приложения
   - Persistent volume для данных БД

2. **PostgreSQL клиент** (`src/db/client.ts`)
   - Connection pool с `pg` библиотекой
   - Async helpers: `query()`, `queryOne()`, `execute()`, `insert()`
   - Transaction support
   - Graceful shutdown

3. **Миграции** (`src/db/migrations.ts`)
   - Полная переработка для PostgreSQL синтаксиса
   - `CREATE EXTENSION vector` для pgvector
   - `vector(384)` тип для embeddings
   - IVFFlat индекс для косинусного расстояния

4. **Server.ts**
   - Все SQL запросы теперь async/await
   - Плейсхолдеры `?` → `$1, $2, $3`
   - Убран sqlite-vss, используется pgvector

**Технические решения:**

```sql
-- Векторный поиск с pgvector
SELECT id, topic, summary,
       1 - (embedding <=> $1::vector) as similarity
FROM memory
WHERE user_id = $2 AND embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 5
```

```typescript
// PostgreSQL client pattern
export async function queryOne<T>(sql: string, params?: any[]): Promise<T | null> {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}
```

---

### Исправления и рефакторинг

**Коммит:** `096f227` - Fix: remove broken db files and update tests

- Удалены неиспользуемые файлы ORM (TypeORM/Sequelize артефакты)
- Обновлены тесты для новой системы персонажей

---

### Система персонажей

**Коммит:** `979149f` - Добавил выбор персонажа, системный промпт

- Пользователь может выбрать персонажа: Lumie (женский) или Leo (мужской)
- Персонализированные системные промпты
- Сохранение выбора в профиле пользователя (`voice` поле)

---

### UserContextManager

**Коммиты:** `a2c12bb`, `4974f9f` - Add UserContextManager class

Класс для управления пользовательской памятью:

```typescript
class UserContextManager {
  async addMemory(userId: string, text: string, topic?: string): Promise<number>;
  async searchMemories(userId: string, query: string, limit?: number): Promise<Memory[]>;
  async getUserContext(userId: string): Promise<string>;
}
```

- Интеграция с embeddings (all-MiniLM-L6-v2)
- Семантический поиск по воспоминаниям
- Формирование контекста для AI

---

### Схема базы данных

**Коммиты:** `fdd122c`, `56a64ef`, `df30ad4`, `85633cf` - Database schema improvements

Эволюция схемы:
1. Базовые таблицы: users, conversations, messages, memory
2. Индексы для производительности
3. Поля для embeddings
4. Оптимизация для векторного поиска

Финальная схема (PostgreSQL):

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  native_lang TEXT DEFAULT 'Russian',
  target_lang TEXT DEFAULT 'English',
  level TEXT DEFAULT 'beginner',
  voice TEXT DEFAULT 'lumie',
  -- ...
);

CREATE TABLE memory (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  topic TEXT,
  summary TEXT,
  embedding vector(384),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_memory_embedding ON memory
USING ivfflat (embedding vector_cosine_ops);
```

---

## Архитектурные решения

### Почему PostgreSQL вместо SQLite?

| Критерий | SQLite | PostgreSQL |
|----------|--------|------------|
| Кроссплатформенность | ❌ sqlite-vss не работает на Windows | ✅ Docker везде |
| Масштабируемость | Ограничена | Высокая |
| Векторный поиск | sqlite-vss (экспериментальный) | pgvector (production-ready) |
| Деплой | Файловая БД | Контейнер |
| Concurrent writes | Ограничены | Полная поддержка |

### Почему pgvector?

- Нативная поддержка в PostgreSQL 16+
- IVFFlat индексы для O(log n) поиска
- Поддержка разных метрик (L2, cosine, inner product)
- Активное развитие и community

### Docker Compose архитектура

```yaml
services:
  db:
    image: pgvector/pgvector:pg16  # PostgreSQL с pgvector
    healthcheck: pg_isready        # Ждём готовности БД

  app:
    depends_on:
      db:
        condition: service_healthy  # Запуск только после БД
```

---

## Метрики

| Метрика | До миграции | После миграции |
|---------|-------------|----------------|
| Тесты | 126 ✅ | 126 ✅ |
| TypeCheck | ✅ | ✅ |
| Windows support | ⚠️ fallback | ✅ полная |
| Векторный поиск | O(n) JS fallback | O(log n) IVFFlat |
| Деплой | Ручной | Docker one-command |

---

### Миграция данных из SQLite

**Скрипт:** `scripts/migrate-sqlite-to-postgres.ts`

```bash
# Убедитесь что PostgreSQL запущен
docker-compose up -d db

# Запустите миграцию
npm run migrate:sqlite
```

**Что мигрируется:**
- Пользователи (users)
- Беседы (conversations)
- Сообщения (messages)
- Воспоминания (memory) — без embeddings (будут сгенерированы при использовании)
- Прогресс (user_progress)

**Особенности:**
- Использует `ON CONFLICT DO NOTHING` для безопасного повторного запуска
- Обновляет sequences для auto-increment полей
- Конвертирует embeddings из JSON/BLOB в pgvector формат

---

## Следующие шаги

- [ ] Добавить Redis для кэширования
- [ ] Настроить CI/CD с Docker
- [ ] Добавить мониторинг (Prometheus/Grafana)
