import Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

/**
 * Database Migration System
 * Tracks applied migrations and runs them in order
 */
export class MigrationRunner {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureMigrationTable();
  }

  private ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  getAppliedVersions(): number[] {
    const rows = this.db.prepare('SELECT version FROM _migrations ORDER BY version').all();
    return rows.map((r: any) => r.version);
  }

  run(migrations: Migration[]): void {
    const applied = new Set(this.getAppliedVersions());

    // Sort migrations by version
    const sorted = [...migrations].sort((a, b) => a.version - b.version);

    for (const migration of sorted) {
      if (applied.has(migration.version)) {
        continue;
      }

      console.log(`Running migration ${migration.version}: ${migration.name}`);

      try {
        this.db.transaction(() => {
          migration.up(this.db);
          this.db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
            migration.version,
            migration.name
          );
        })();
        console.log(`  ✓ Migration ${migration.version} applied`);
      } catch (error) {
        console.error(`  ✗ Migration ${migration.version} failed:`, error);
        throw error;
      }
    }
  }

  rollback(migrations: Migration[], targetVersion: number): void {
    const applied = this.getAppliedVersions().sort((a, b) => b - a);

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

      try {
        this.db.transaction(() => {
          migration.down!(this.db);
          this.db.prepare('DELETE FROM _migrations WHERE version = ?').run(version);
        })();
        console.log(`  ✓ Migration ${version} rolled back`);
      } catch (error) {
        console.error(`  ✗ Rollback of ${version} failed:`, error);
        throw error;
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
    name: 'initial_schema',
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          name TEXT,
          native_lang TEXT DEFAULT 'Russian',
          target_lang TEXT DEFAULT 'English',
          level TEXT DEFAULT 'beginner',
          streak INTEGER DEFAULT 0,
          last_active DATETIME,
          points INTEGER DEFAULT 0,
          interests TEXT,
          weak_topics TEXT,
          age INTEGER,
          gender TEXT,
          avatar TEXT,
          is_onboarded INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS user_progress (
          user_id TEXT,
          topic_id TEXT,
          status TEXT DEFAULT 'completed',
          completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, topic_id),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          title TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT,
          role TEXT,
          content TEXT,
          type TEXT DEFAULT 'text',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          topic TEXT,
          summary TEXT,
          embedding BLOB,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
    down: db => {
      db.exec(`
        DROP TABLE IF EXISTS memory;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS conversations;
        DROP TABLE IF EXISTS user_progress;
        DROP TABLE IF EXISTS users;
      `);
    },
  },

  {
    version: 2,
    name: 'add_indexes',
    up: db => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
        CREATE INDEX IF NOT EXISTS idx_memory_user_id ON memory(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress(user_id);
      `);
    },
    down: db => {
      db.exec(`
        DROP INDEX IF EXISTS idx_conversations_user_id;
        DROP INDEX IF EXISTS idx_conversations_created_at;
        DROP INDEX IF EXISTS idx_messages_conversation_id;
        DROP INDEX IF EXISTS idx_messages_created_at;
        DROP INDEX IF EXISTS idx_memory_user_id;
        DROP INDEX IF EXISTS idx_user_progress_user_id;
      `);
    },
  },

  {
    version: 3,
    name: 'add_user_settings',
    up: db => {
      // Check if columns exist before adding
      const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
      const columns = new Set(tableInfo.map(c => c.name));

      if (!columns.has('provider')) {
        db.exec(`ALTER TABLE users ADD COLUMN provider TEXT DEFAULT 'gemini'`);
      }
      if (!columns.has('ollama_url')) {
        db.exec(`ALTER TABLE users ADD COLUMN ollama_url TEXT`);
      }
      if (!columns.has('ollama_model')) {
        db.exec(`ALTER TABLE users ADD COLUMN ollama_model TEXT`);
      }
    },
    down: db => {
      // SQLite doesn't support DROP COLUMN in older versions
      // Would need to recreate table
      console.warn('Rollback of user_settings migration requires table recreation');
    },
  },

  {
    version: 4,
    name: 'add_message_metadata',
    up: db => {
      const tableInfo = db.prepare("PRAGMA table_info(messages)").all() as any[];
      const columns = new Set(tableInfo.map(c => c.name));

      if (!columns.has('tokens')) {
        db.exec(`ALTER TABLE messages ADD COLUMN tokens INTEGER`);
      }
      if (!columns.has('model')) {
        db.exec(`ALTER TABLE messages ADD COLUMN model TEXT`);
      }
    },
  },

  {
    version: 5,
    name: 'add_memory_indexes_for_search',
    up: db => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memory_topic ON memory(topic);
        CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at);
      `);
    },
    down: db => {
      db.exec(`
        DROP INDEX IF EXISTS idx_memory_topic;
        DROP INDEX IF EXISTS idx_memory_created_at;
      `);
    },
  },

  {
    version: 6,
    name: 'add_vss_memory_table',
    up: db => {
      // Note: sqlite-vss extension must be loaded before this migration runs
      // The virtual table uses 384-dimensional embeddings (all-MiniLM-L6-v2)
      try {
        // Check if VSS extension is loaded
        const vssLoaded = db.prepare("SELECT * FROM pragma_module_list WHERE name = 'vss0'").get();

        if (vssLoaded) {
          db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS vss_memory USING vss0(
              embedding(384)
            );
          `);
          console.log('  ✓ VSS virtual table created');
        } else {
          console.warn('  ⚠ sqlite-vss extension not loaded, skipping vss_memory table');
        }
      } catch (e) {
        // VSS might not be available on all systems
        console.warn('  ⚠ Could not create vss_memory table:', e);
      }
    },
    down: db => {
      try {
        db.exec(`DROP TABLE IF EXISTS vss_memory`);
      } catch (e) {
        console.warn('Could not drop vss_memory table:', e);
      }
    },
  },
];

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  const runner = new MigrationRunner(db);
  runner.run(migrations);
}
