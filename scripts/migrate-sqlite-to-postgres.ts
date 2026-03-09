/**
 * Migration script: SQLite → PostgreSQL
 *
 * Usage:
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Prerequisites:
 *   - PostgreSQL running (docker-compose up -d db)
 *   - tutor.db file exists
 *   - DATABASE_URL set in .env
 */

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH = path.join(__dirname, '..', 'tutor.db');

interface User {
  id: string;
  email: string | null;
  name: string | null;
  native_lang: string | null;
  target_lang: string | null;
  level: string | null;
  streak: number | null;
  last_active: string | null;
  points: number | null;
  interests: string | null;
  weak_topics: string | null;
  age: number | null;
  gender: string | null;
  avatar: string | null;
  is_onboarded: number | null;
  voice: string | null;
  provider: string | null;
  ollama_url: string | null;
  ollama_model: string | null;
}

interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string | null;
}

interface Message {
  id: number;
  conversation_id: string;
  role: string | null;
  content: string | null;
  type: string | null;
  tokens: number | null;
  model: string | null;
  created_at: string | null;
}

interface Memory {
  id: number;
  user_id: string;
  topic: string | null;
  summary: string | null;
  embedding: Buffer | null;
  created_at: string | null;
}

interface UserProgress {
  user_id: string;
  topic_id: string;
  status: string | null;
  completed_at: string | null;
}

async function migrate() {
  console.log('Starting migration from SQLite to PostgreSQL...\n');

  // Connect to SQLite
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log(`✓ Connected to SQLite: ${SQLITE_PATH}`);

  // Connect to PostgreSQL
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await pool.query('SELECT 1');
    console.log('✓ Connected to PostgreSQL\n');
  } catch (err) {
    console.error('✗ Failed to connect to PostgreSQL:', err);
    console.error('  Make sure PostgreSQL is running: docker-compose up -d db');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Migrate users
    console.log('Migrating users...');
    const users = sqlite.prepare('SELECT * FROM users').all() as User[];

    for (const user of users) {
      await client.query(
        `INSERT INTO users (id, email, name, native_lang, target_lang, level, streak, last_active, points, interests, weak_topics, age, gender, avatar, is_onboarded, voice, provider, ollama_url, ollama_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (id) DO UPDATE SET
           email = COALESCE(EXCLUDED.email, users.email),
           name = COALESCE(EXCLUDED.name, users.name),
           native_lang = COALESCE(EXCLUDED.native_lang, users.native_lang),
           target_lang = COALESCE(EXCLUDED.target_lang, users.target_lang)`,
        [
          user.id,
          user.email,
          user.name,
          user.native_lang || 'Russian',
          user.target_lang || 'English',
          user.level || 'beginner',
          user.streak || 0,
          user.last_active,
          user.points || 0,
          user.interests,
          user.weak_topics,
          user.age,
          user.gender,
          user.avatar,
          user.is_onboarded || 0,
          user.voice || 'lumie',
          user.provider || 'gemini',
          user.ollama_url,
          user.ollama_model,
        ]
      );
    }
    console.log(`  ✓ Migrated ${users.length} users`);

    // 2. Migrate conversations
    console.log('Migrating conversations...');
    const conversations = sqlite.prepare('SELECT * FROM conversations').all() as Conversation[];

    for (const conv of conversations) {
      await client.query(
        `INSERT INTO conversations (id, user_id, title, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [conv.id, conv.user_id, conv.title, conv.created_at]
      );
    }
    console.log(`  ✓ Migrated ${conversations.length} conversations`);

    // 3. Migrate messages
    console.log('Migrating messages...');
    const messages = sqlite.prepare('SELECT * FROM messages').all() as Message[];

    for (const msg of messages) {
      await client.query(
        `INSERT INTO messages (id, conversation_id, role, content, type, tokens, model, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [msg.id, msg.conversation_id, msg.role, msg.content, msg.type || 'text', msg.tokens, msg.model, msg.created_at]
      );
    }

    // Update sequence for messages
    const maxMsgId = messages.length > 0 ? Math.max(...messages.map((m) => m.id)) : 0;
    if (maxMsgId > 0) {
      await client.query(`SELECT setval('messages_id_seq', $1, true)`, [maxMsgId]);
    }
    console.log(`  ✓ Migrated ${messages.length} messages`);

    // 4. Migrate memory
    console.log('Migrating memory...');
    const memories = sqlite.prepare('SELECT * FROM memory').all() as Memory[];

    for (const mem of memories) {
      let embeddingVector: string | null = null;

      // Convert embedding from BLOB/JSON to pgvector format
      if (mem.embedding) {
        try {
          let embeddingArray: number[];

          if (Buffer.isBuffer(mem.embedding)) {
            // Try to parse as JSON string
            const embeddingStr = mem.embedding.toString('utf-8');
            embeddingArray = JSON.parse(embeddingStr);
          } else if (typeof mem.embedding === 'string') {
            embeddingArray = JSON.parse(mem.embedding);
          } else {
            embeddingArray = mem.embedding as unknown as number[];
          }

          if (Array.isArray(embeddingArray) && embeddingArray.length === 384) {
            embeddingVector = `[${embeddingArray.join(',')}]`;
          }
        } catch (e) {
          console.warn(`    ⚠ Could not parse embedding for memory ${mem.id}`);
        }
      }

      await client.query(
        `INSERT INTO memory (id, user_id, topic, summary, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5::vector, $6)
         ON CONFLICT (id) DO NOTHING`,
        [mem.id, mem.user_id, mem.topic, mem.summary, embeddingVector, mem.created_at]
      );
    }

    // Update sequence for memory
    const maxMemId = memories.length > 0 ? Math.max(...memories.map((m) => m.id)) : 0;
    if (maxMemId > 0) {
      await client.query(`SELECT setval('memory_id_seq', $1, true)`, [maxMemId]);
    }
    console.log(`  ✓ Migrated ${memories.length} memories`);

    // 5. Migrate user_progress
    console.log('Migrating user_progress...');
    const progress = sqlite.prepare('SELECT * FROM user_progress').all() as UserProgress[];

    for (const p of progress) {
      await client.query(
        `INSERT INTO user_progress (user_id, topic_id, status, completed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, topic_id) DO NOTHING`,
        [p.user_id, p.topic_id, p.status || 'completed', p.completed_at]
      );
    }
    console.log(`  ✓ Migrated ${progress.length} user_progress records`);

    await client.query('COMMIT');
    console.log('\n✓ Migration completed successfully!');

    // Print summary
    console.log('\n--- Summary ---');
    console.log(`Users:         ${users.length}`);
    console.log(`Conversations: ${conversations.length}`);
    console.log(`Messages:      ${messages.length}`);
    console.log(`Memories:      ${memories.length}`);
    console.log(`Progress:      ${progress.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
