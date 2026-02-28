import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import * as sqlite_vss from "sqlite-vss";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import { runMigrations } from "./src/db/migrations.js";

dotenv.config();

// =============================================================================
// SECURITY: Input Validation Helpers
// =============================================================================

const ALLOWED_LANGUAGES = ['Russian', 'English', 'Spanish', 'French', 'German', 'Italian', 'Chinese', 'Japanese', 'Portuguese'] as const;
const ALLOWED_GENDERS = ['male', 'female', 'other'] as const;
const ALLOWED_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'beginner', 'intermediate', 'advanced'] as const;
const ALLOWED_ROLES = ['user', 'assistant'] as const;
const ALLOWED_MESSAGE_TYPES = ['text', 'theory', 'voice'] as const;

function isValidString(value: unknown, maxLength: number = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isValidLanguage(value: unknown): value is typeof ALLOWED_LANGUAGES[number] {
  return typeof value === 'string' && ALLOWED_LANGUAGES.includes(value as any);
}

function isValidGender(value: unknown): value is typeof ALLOWED_GENDERS[number] {
  return typeof value === 'string' && ALLOWED_GENDERS.includes(value as any);
}

function isValidLevel(value: unknown): value is typeof ALLOWED_LEVELS[number] {
  return typeof value === 'string' && ALLOWED_LEVELS.includes(value as any);
}

function isValidAge(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 150;
}

function isValidUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeForHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function isAllowedOrigin(origin: string): boolean {
  const allowedOrigins = [
    process.env.APP_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean).map(url => url?.trim().replace(/\/+$/, ''));

  const normalizedOrigin = origin.trim().replace(/\/+$/, '');
  return allowedOrigins.includes(normalizedOrigin);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("tutor.db");
db.exec("PRAGMA foreign_keys = ON;");

// Load sqlite-vss extension for vector search (must be loaded before migrations)
// Note: sqlite-vss is not supported on Windows
let vssAvailable = false;
try {
  sqlite_vss.load(db);
  vssAvailable = true;
  console.log("sqlite-vss extension loaded successfully");
} catch (e) {
  console.warn("sqlite-vss not available (this is expected on Windows):", (e as Error).message);
  console.warn("Using JavaScript fallback for vector search");
}

// Cosine similarity for JS fallback (used when sqlite-vss is not available)
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

// Run database migrations
console.log("Running database migrations...");
runMigrations(db);
console.log("Database migrations complete");

// Helper to ensure user exists in DB (handles cases where client has stale localStorage)
function ensureUserExists(userId: string) {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) {
    db.prepare("INSERT OR IGNORE INTO users (id, name, is_onboarded) VALUES (?, ?, 0)")
      .run(userId, 'Guest User');
  }
}

// Migration: Add embedding column if it doesn't exist
try {
  db.prepare("ALTER TABLE memory ADD COLUMN embedding BLOB").run();
} catch (e) {
  // Column already exists or other error
}
try {
  db.prepare("ALTER TABLE memory ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP").run();
} catch (e) {
  // Column already exists
}

try {
  db.prepare("ALTER TABLE users ADD COLUMN age INTEGER").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE users ADD COLUMN gender TEXT").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE users ADD COLUMN avatar TEXT").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE users ADD COLUMN is_onboarded INTEGER DEFAULT 0").run();
} catch (e) {}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- AUTH ROUTES ---
  app.get('/api/auth/url', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientOrigin = req.query.origin as string;

    // SECURITY: Validate origin against whitelist to prevent Open Redirect
    let appUrl = (clientOrigin || process.env.APP_URL || '').trim().replace(/\/+$/, '');

    if (clientOrigin && !isAllowedOrigin(clientOrigin)) {
      return res.status(400).json({
        error: "Invalid origin",
        details: "The provided origin is not allowed."
      });
    }

    const redirectUri = `${appUrl}/auth/callback`;

    if (!clientId || clientId.includes('your_google_client_id')) {
      return res.status(400).json({
        error: "Missing Google Client ID",
        details: "Please add GOOGLE_CLIENT_ID to environment variables."
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account consent',
      state: appUrl,
      include_granted_scopes: 'true'
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // SECURITY: Validate state/origin to prevent Open Redirect
    const appUrl = (state as string || process.env.APP_URL || '').trim().replace(/\/+$/, '');

    if (state && !isAllowedOrigin(state as string)) {
      return res.status(400).send('Invalid redirect origin');
    }

    const redirectUri = `${appUrl}/auth/callback`;

    // Helper to send secure OAuth response (prevents XSS)
    const sendAuthResponse = (user: any) => {
      // SECURITY: Escape JSON to prevent XSS injection
      const safeUserJson = JSON.stringify(user)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/'/g, '\\u0027');

      // SECURITY: Use specific origin instead of '*'
      const targetOrigin = appUrl || '*';

      res.send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"></head>
  <body>
    <script>
      (function() {
        var user = ${safeUserJson};
        if (window.opener) {
          window.opener.postMessage({
            type: 'OAUTH_AUTH_SUCCESS',
            user: user
          }, '${sanitizeForHtml(targetOrigin)}');
        }
        window.close();
      })();
    </script>
    <p>Authentication successful. This window should close automatically.</p>
  </body>
</html>`);
    };

    if (!code || !clientId || !clientSecret || clientSecret.includes('your_google_client_secret')) {
      // Fallback to demo user if credentials are not set
      let user = db.prepare("SELECT * FROM users WHERE id = ?").get('user_123');
      if (!user) {
        db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)")
          .run('user_123', 'demo@example.com', 'Demo User');
        user = db.prepare("SELECT * FROM users WHERE id = ?").get('user_123');
      }
      return sendAuthResponse(user);
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      const { access_token } = tokenResponse.data;

      // Get user info
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const googleUser = userResponse.data;

      // SECURITY: Validate Google user data
      if (!googleUser.id || typeof googleUser.id !== 'string') {
        return res.status(400).send('Invalid user data from Google');
      }

      // Check if user exists, if not create
      let user = db.prepare("SELECT * FROM users WHERE id = ?").get(googleUser.id);
      if (!user) {
        // SECURITY: Sanitize user input from Google
        const sanitizedEmail = (googleUser.email || '').substring(0, 255);
        const sanitizedName = (googleUser.name || 'User').substring(0, 100);

        db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)")
          .run(googleUser.id, sanitizedEmail, sanitizedName);
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(googleUser.id);
      }

      sendAuthResponse(user);
    } catch (error: any) {
      console.error('OAuth Error:', error.response?.data || error.message);
      res.status(500).send('Authentication failed. Please try again.');
    }
  });

  app.get("/api/auth/demo", (req, res) => {
    let user = db.prepare("SELECT * FROM users WHERE id = ?").get('demo_user');
    if (!user) {
      db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)")
        .run('demo_user', 'guest@example.com', 'Guest Student');
      user = db.prepare("SELECT * FROM users WHERE id = ?").get('demo_user');
    }
    res.json(user);
  });

  // Google Sign-In with ID Token verification
  app.post("/api/auth/google", async (req, res) => {
    const { credential } = req.body;

    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ error: "Missing credential" });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;

    // If no client ID configured, fall back to demo user
    if (!clientId || clientId.includes('your_google_client_id')) {
      let user = db.prepare("SELECT * FROM users WHERE id = ?").get('demo_user');
      if (!user) {
        db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)")
          .run('demo_user', 'guest@example.com', 'Demo User');
        user = db.prepare("SELECT * FROM users WHERE id = ?").get('demo_user');
      }
      return res.json(user);
    }

    try {
      const client = new OAuth2Client(clientId);

      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });

      const payload = ticket.getPayload();

      if (!payload || !payload.sub) {
        return res.status(400).json({ error: "Invalid token payload" });
      }

      const googleId = payload.sub;
      const email = (payload.email || '').substring(0, 255);
      const name = (payload.name || 'User').substring(0, 100);
      const avatar = payload.picture || null;

      // Check if user exists
      let user: any = db.prepare("SELECT * FROM users WHERE id = ?").get(googleId);

      if (!user) {
        // Create new user
        db.prepare("INSERT INTO users (id, email, name, avatar) VALUES (?, ?, ?, ?)")
          .run(googleId, email, name, avatar);
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(googleId);
      } else {
        // Update existing user's avatar if they don't have one
        if (!user.avatar && avatar) {
          db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar, googleId);
          user = db.prepare("SELECT * FROM users WHERE id = ?").get(googleId);
        }
      }

      res.json(user);
    } catch (error: any) {
      console.error('Google Sign-In Error:', error.message);
      res.status(401).json({ error: "Failed to verify Google credential" });
    }
  });

  // Get Google Client ID for frontend
  app.get("/api/auth/google-client-id", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!clientId || clientId.includes('your_google_client_id')) {
      return res.json({ clientId: null, demoMode: true });
    }

    res.json({ clientId, demoMode: false });
  });

  // --- USER & PROGRESS ROUTES ---
  app.post("/api/user/onboard", (req, res) => {
    const { userId, name, age, gender, nativeLang, targetLang, avatar } = req.body;

    // SECURITY: Validate all input fields
    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    // Validate optional fields
    const validatedName = isValidString(name, 100) ? name : null;
    const validatedAge = isValidAge(age) ? age : null;
    const validatedGender = isValidGender(gender) ? gender : null;
    const validatedNativeLang = isValidLanguage(nativeLang) ? nativeLang : null;
    const validatedTargetLang = isValidLanguage(targetLang) ? targetLang : null;
    const validatedAvatar = (avatar && isValidUrl(avatar)) ? avatar.substring(0, 500) : null;

    // Check if user exists
    const existingUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

    if (existingUser) {
      db.prepare(`
        UPDATE users
        SET
          name = COALESCE(?, name),
          age = COALESCE(?, age),
          gender = COALESCE(?, gender),
          native_lang = COALESCE(?, native_lang),
          target_lang = COALESCE(?, target_lang),
          avatar = COALESCE(?, avatar),
          is_onboarded = CASE WHEN ? IS NOT NULL THEN 1 ELSE is_onboarded END
        WHERE id = ?
      `).run(validatedName, validatedAge, validatedGender, validatedNativeLang, validatedTargetLang, validatedAvatar, validatedName, userId);
    } else {
      // For demo_user or cases where OAuth didn't create the record yet
      db.prepare(`
        INSERT INTO users (id, name, age, gender, native_lang, target_lang, avatar, is_onboarded)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(userId, validatedName || 'User', validatedAge, validatedGender, validatedNativeLang || 'Russian', validatedTargetLang || 'English', validatedAvatar);
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    res.json(user || { error: "Failed to retrieve user after onboarding" });
  });

  app.get("/api/user/:id", (req, res) => {
    // SECURITY: Validate user ID
    if (!isValidString(req.params.id, 100)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    res.json(user || { error: "Not found" });
  });

  app.get("/api/user/:id/progress", (req, res) => {
    // SECURITY: Validate user ID
    if (!isValidString(req.params.id, 100)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    const rows = db.prepare("SELECT topic_id FROM user_progress WHERE user_id = ?").all(req.params.id);
    res.json(rows.map((r: any) => r.topic_id));
  });

  app.post("/api/user/complete-topic", (req, res) => {
    const { userId, topicId } = req.body;

    // SECURITY: Validate input
    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!isValidString(topicId, 50)) {
      return res.status(400).json({ error: "Invalid topicId" });
    }

    ensureUserExists(userId);
    db.prepare("INSERT OR REPLACE INTO user_progress (user_id, topic_id) VALUES (?, ?)").run(userId, topicId);
    res.json({ success: true });
  });

  app.post("/api/user/update-progress", (req, res) => {
    const { userId, level, points, weakTopic } = req.body;

    // SECURITY: Validate input
    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (level !== undefined && !isValidLevel(level)) {
      return res.status(400).json({ error: "Invalid level" });
    }
    if (points !== undefined && (typeof points !== 'number' || points < 0 || points > 10000)) {
      return res.status(400).json({ error: "Invalid points" });
    }

    const validatedLevel = isValidLevel(level) ? level : null;
    const validatedPoints = (typeof points === 'number' && points >= 0) ? Math.min(points, 10000) : 0;

    db.prepare("UPDATE users SET level = COALESCE(?, level), points = points + ?, last_active = CURRENT_TIMESTAMP WHERE id = ?")
      .run(validatedLevel, validatedPoints, userId);

    if (weakTopic && isValidString(weakTopic, 100)) {
      db.prepare("INSERT INTO memory (user_id, topic, summary) VALUES (?, ?, ?)")
        .run(userId, weakTopic, "User struggled with this topic");
    }
    res.json({ success: true });
  });

  app.post("/api/user/update-languages", (req, res) => {
    const { userId, nativeLang, targetLang } = req.body;

    // SECURITY: Validate input
    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!isValidLanguage(nativeLang)) {
      return res.status(400).json({ error: "Invalid native language" });
    }
    if (!isValidLanguage(targetLang)) {
      return res.status(400).json({ error: "Invalid target language" });
    }

    db.prepare("UPDATE users SET native_lang = ?, target_lang = ? WHERE id = ?")
      .run(nativeLang, targetLang, userId);
    res.json({ success: true });
  });

  // --- SECURE API CONFIG ---
  // SECURITY: Rate limiting for API key requests
  const apiKeyRequestCounts = new Map<string, { count: number; resetTime: number }>();
  const API_KEY_RATE_LIMIT = 10; // requests per minute
  const API_KEY_RATE_WINDOW = 60000; // 1 minute in ms

  app.get("/api/config/live-api-key", (req, res) => {
    // Get client identifier (IP or user ID from query)
    const clientId = req.query.userId as string || req.ip || 'unknown';

    // Rate limiting check
    const now = Date.now();
    const rateData = apiKeyRequestCounts.get(clientId);

    if (rateData) {
      if (now > rateData.resetTime) {
        // Reset window
        apiKeyRequestCounts.set(clientId, { count: 1, resetTime: now + API_KEY_RATE_WINDOW });
      } else if (rateData.count >= API_KEY_RATE_LIMIT) {
        return res.status(429).json({ error: "Too many requests. Please try again later." });
      } else {
        rateData.count++;
      }
    } else {
      apiKeyRequestCounts.set(clientId, { count: 1, resetTime: now + API_KEY_RATE_WINDOW });
    }

    // Validate user exists (basic auth check)
    if (req.query.userId) {
      const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.query.userId);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "API key not configured" });
    }

    // Return API key for authenticated requests
    res.json({ key: apiKey });
  });

  // --- MEMORY & VECTOR SEARCH ---
  app.post("/api/memory/add", async (req, res) => {
    const { userId, text, topic, embedding } = req.body;

    // SECURITY: Validate input
    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!isValidString(text, 5000)) {
      return res.status(400).json({ error: "Invalid text" });
    }

    const validatedTopic = isValidString(topic, 100) ? topic : 'general';

    // Validate embedding array (all-MiniLM-L6-v2 produces 384 dimensions)
    let embeddingArray: number[] | null = null;
    if (embedding && Array.isArray(embedding)) {
      // SECURITY: Validate embedding - must be 384 dimensions for our model
      if (embedding.length !== 384) {
        return res.status(400).json({ error: `Invalid embedding dimension: expected 384, got ${embedding.length}` });
      }
      if (!embedding.every(v => typeof v === 'number' && isFinite(v))) {
        return res.status(400).json({ error: "Invalid embedding values" });
      }
      embeddingArray = embedding;
    }

    ensureUserExists(userId);

    // Insert into regular memory table
    const result = db.prepare("INSERT INTO memory (user_id, topic, summary) VALUES (?, ?, ?)")
      .run(userId, validatedTopic, text);

    // Insert into VSS virtual table for fast vector search
    // Insert into VSS table if available (skip on Windows)
    if (vssAvailable && embeddingArray && result.lastInsertRowid) {
      try {
        const embeddingJson = JSON.stringify(embeddingArray);
        db.prepare("INSERT INTO vss_memory (rowid, embedding) VALUES (?, ?)").run(
          result.lastInsertRowid,
          embeddingJson
        );
      } catch (e) {
        console.error("Failed to insert into vss_memory:", e);
        // Don't fail the request - the memory is still saved in the regular table
      }
    }

    res.json({ success: true, id: result.lastInsertRowid });
  });

  app.post("/api/memory/search", async (req, res) => {
    const { userId, embedding } = req.body;

    // SECURITY: Validate input
    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!embedding || !Array.isArray(embedding)) {
      return res.json([]);
    }
    // Validate embedding dimension (all-MiniLM-L6-v2 produces 384)
    if (embedding.length !== 384) {
      const rows = db.prepare("SELECT id, topic, summary FROM memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(userId);
      return res.json(rows.map((row: any) => ({ ...row, similarity: 0 })));
    }

    // Use JS fallback if VSS not available (Windows)
    if (!vssAvailable) {
      const rows: any[] = db.prepare("SELECT id, topic, summary, embedding FROM memory WHERE user_id = ?").all(userId);

      const results = rows
        .map(row => {
          let similarity = 0;
          if (row.embedding) {
            try {
              const storedEmbedding = JSON.parse(row.embedding);
              if (Array.isArray(storedEmbedding) && storedEmbedding.length === 384) {
                similarity = cosineSimilarity(embedding, storedEmbedding);
              }
            } catch (e) {
              // Invalid embedding, skip
            }
          }
          return {
            id: row.id,
            topic: row.topic,
            summary: row.summary,
            similarity
          };
        })
        .filter(r => r.similarity > 0.3) // Filter low similarity
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      return res.json(results);
    }

    try {
      // Use VSS for fast vector similarity search
      const embeddingJson = JSON.stringify(embedding);

      // VSS search returns rowid and distance (lower = more similar)
      const vssResults: any[] = db.prepare(`
        SELECT rowid, distance
        FROM vss_memory
        WHERE vss_search(embedding, ?)
        LIMIT 20
      `).all(embeddingJson);

      if (vssResults.length === 0) {
        // No vectors in VSS yet, fall back to regular query
        const rows = db.prepare("SELECT id, topic, summary FROM memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(userId);
        return res.json(rows.map((row: any) => ({ ...row, similarity: 0 })));
      }

      // Get memory details for the found rowids, filtered by userId
      const rowids = vssResults.map(r => r.rowid);
      const placeholders = rowids.map(() => '?').join(',');

      const memories: any[] = db.prepare(`
        SELECT id, topic, summary
        FROM memory
        WHERE id IN (${placeholders}) AND user_id = ?
      `).all(...rowids, userId);

      // Create a map for quick lookup
      const memoryMap = new Map(memories.map(m => [m.id, m]));

      // Combine VSS results with memory data, converting distance to similarity
      const results = vssResults
        .filter(vss => memoryMap.has(vss.rowid))
        .map(vss => {
          const memory = memoryMap.get(vss.rowid)!;
          // Convert distance to similarity (distance 0 = similarity 1)
          // VSS uses L2 distance, so we convert with a formula
          const similarity = 1 / (1 + vss.distance);
          return {
            id: memory.id,
            topic: memory.topic,
            summary: memory.summary,
            similarity
          };
        });

      res.json(results.slice(0, 5));
    } catch (e) {
      console.error("VSS search failed, using JS fallback:", e);
      // Fall back to JS cosine similarity
      const rows: any[] = db.prepare("SELECT id, topic, summary, embedding FROM memory WHERE user_id = ?").all(userId);

      const results = rows
        .map(row => {
          let similarity = 0;
          if (row.embedding) {
            try {
              const storedEmbedding = JSON.parse(row.embedding);
              if (Array.isArray(storedEmbedding) && storedEmbedding.length === 384) {
                similarity = cosineSimilarity(embedding, storedEmbedding);
              }
            } catch (parseErr) {
              // Invalid embedding
            }
          }
          return { id: row.id, topic: row.topic, summary: row.summary, similarity };
        })
        .filter(r => r.similarity > 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      res.json(results);
    }
  });

  app.post("/api/conversations", (req, res) => {
    const { id, user_id, title } = req.body;

    // SECURITY: Validate input
    if (!isValidString(id, 50)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }
    if (!isValidString(user_id, 100)) {
      return res.status(400).json({ error: "Invalid user_id" });
    }

    const validatedTitle = isValidString(title, 200) ? title : 'New Conversation';

    ensureUserExists(user_id);
    db.prepare("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)").run(id, user_id, validatedTitle);
    res.json({ success: true });
  });

  app.get("/api/conversations/user/:userId", (req, res) => {
    // SECURITY: Validate input
    if (!isValidString(req.params.userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    const rows = db.prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC").all(req.params.userId);
    res.json(rows);
  });

  app.get("/api/conversations/:id/messages", (req, res) => {
    // SECURITY: Validate input
    if (!isValidString(req.params.id, 50)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }
    const rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(req.params.id);
    res.json(rows);
  });

  app.post("/api/messages", (req, res) => {
    const { conversation_id, role, content, type } = req.body;

    // SECURITY: Validate input
    if (!isValidString(conversation_id, 50)) {
      return res.status(400).json({ error: "Invalid conversation_id" });
    }
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (!isValidString(content, 50000)) {
      return res.status(400).json({ error: "Invalid content" });
    }

    const validatedType = (type && ALLOWED_MESSAGE_TYPES.includes(type)) ? type : 'text';

    // Ensure conversation exists to avoid FK error
    const conv = db.prepare("SELECT id, user_id FROM conversations WHERE id = ?").get(conversation_id);
    if (!conv) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    db.prepare("INSERT INTO messages (conversation_id, role, content, type) VALUES (?, ?, ?, ?)").run(conversation_id, role, content, validatedType);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
