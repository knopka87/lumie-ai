import { pool, query, execute, queryOne } from './client.js';

interface Migration {
  version: number;
  name: string;
  up: () => Promise<void>;
  down?: () => Promise<void>;
}

/**
 * Database Migration System for PostgreSQL
 * Tracks applied migrations and runs them in order
 */
export class MigrationRunner {
  private async ensureMigrationTable(): Promise<void> {
    await execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async getAppliedVersions(): Promise<number[]> {
    const rows = await query<{ version: number }>('SELECT version FROM _migrations ORDER BY version');
    return rows.map(r => r.version);
  }

  async run(migrations: Migration[]): Promise<void> {
    await this.ensureMigrationTable();
    const applied = new Set(await this.getAppliedVersions());

    const sorted = [...migrations].sort((a, b) => a.version - b.version);

    for (const migration of sorted) {
      if (applied.has(migration.version)) {
        continue;
      }

      console.log(`Running migration ${migration.version}: ${migration.name}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await migration.up();
        await client.query('INSERT INTO _migrations (version, name) VALUES ($1, $2)', [
          migration.version,
          migration.name,
        ]);
        await client.query('COMMIT');
        console.log(`  ✓ Migration ${migration.version} applied`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  ✗ Migration ${migration.version} failed:`, error);
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async rollback(migrations: Migration[], targetVersion: number): Promise<void> {
    const applied = (await this.getAppliedVersions()).sort((a, b) => b - a);

    for (const version of applied) {
      if (version <= targetVersion) break;

      const migration = migrations.find(m => m.version === version);
      if (!migration) {
        console.warn(`Migration ${version} not found in definitions, skipping rollback`);
        continue;
      }

      if (!migration.down) {
        throw new Error(`Migration ${version} does not have a down() method`);
      }

      console.log(`Rolling back migration ${version}: ${migration.name}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await migration.down();
        await client.query('DELETE FROM _migrations WHERE version = $1', [version]);
        await client.query('COMMIT');
        console.log(`  ✓ Migration ${version} rolled back`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  ✗ Rollback of ${version} failed:`, error);
        throw error;
      } finally {
        client.release();
      }
    }
  }
}

/**
 * All database migrations
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'enable_pgvector',
    up: async () => {
      await execute('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('  ✓ pgvector extension enabled');
    },
    down: async () => {
      await execute('DROP EXTENSION IF EXISTS vector');
    },
  },

  {
    version: 2,
    name: 'initial_schema',
    up: async () => {
      await execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          name TEXT,
          native_lang TEXT DEFAULT 'Russian',
          target_lang TEXT DEFAULT 'English',
          level TEXT DEFAULT 'beginner',
          streak INTEGER DEFAULT 0,
          last_active TIMESTAMPTZ,
          points INTEGER DEFAULT 0,
          interests TEXT,
          weak_topics TEXT,
          age INTEGER,
          gender TEXT,
          avatar TEXT,
          is_onboarded INTEGER DEFAULT 0,
          voice TEXT DEFAULT 'lumie',
          provider TEXT DEFAULT 'gemini',
          ollama_url TEXT,
          ollama_model TEXT
        );

        CREATE TABLE IF NOT EXISTS user_progress (
          user_id TEXT,
          topic_id TEXT,
          status TEXT DEFAULT 'completed',
          completed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, topic_id),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          title TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          conversation_id TEXT,
          role TEXT,
          content TEXT,
          type TEXT DEFAULT 'text',
          tokens INTEGER,
          model TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memory (
          id SERIAL PRIMARY KEY,
          user_id TEXT,
          topic TEXT,
          summary TEXT,
          embedding vector(384),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
    down: async () => {
      await execute(`
        DROP TABLE IF EXISTS memory;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS conversations;
        DROP TABLE IF EXISTS user_progress;
        DROP TABLE IF EXISTS users;
      `);
    },
  },

  {
    version: 3,
    name: 'add_indexes',
    up: async () => {
      await execute(`
        CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
        CREATE INDEX IF NOT EXISTS idx_memory_user_id ON memory(user_id);
        CREATE INDEX IF NOT EXISTS idx_memory_topic ON memory(topic);
        CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at);
        CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress(user_id);
      `);
    },
    down: async () => {
      await execute(`
        DROP INDEX IF EXISTS idx_conversations_user_id;
        DROP INDEX IF EXISTS idx_conversations_created_at;
        DROP INDEX IF EXISTS idx_messages_conversation_id;
        DROP INDEX IF EXISTS idx_messages_created_at;
        DROP INDEX IF EXISTS idx_memory_user_id;
        DROP INDEX IF EXISTS idx_memory_topic;
        DROP INDEX IF EXISTS idx_memory_created_at;
        DROP INDEX IF EXISTS idx_user_progress_user_id;
      `);
    },
  },

  {
    version: 4,
    name: 'add_vector_index',
    up: async () => {
      // Create an IVFFlat index for fast approximate nearest neighbor search
      // Using cosine distance operator <=>
      await execute(`
        CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memory
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
      `);
      console.log('  ✓ Vector index created');
    },
    down: async () => {
      await execute('DROP INDEX IF EXISTS idx_memory_embedding');
    },
  },
];

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  const runner = new MigrationRunner();
  await runner.run(migrations);
}
