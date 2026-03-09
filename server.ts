import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import { runMigrations } from "./src/db/migrations.js";
import { query, queryOne, execute, insert } from "./src/db/client.js";

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

// Helper to ensure user exists in DB (handles cases where client has stale localStorage)
async function ensureUserExists(userId: string) {
  const user = await queryOne("SELECT id FROM users WHERE id = $1", [userId]);
  if (!user) {
    await execute(
      "INSERT INTO users (id, name, is_onboarded) VALUES ($1, $2, 0) ON CONFLICT (id) DO NOTHING",
      [userId, 'Guest User']
    );
  }
}

// Convert embedding array to pgvector format string
function toVectorString(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function startServer() {
  // Run database migrations
  console.log("Running database migrations...");
  await runMigrations();
  console.log("Database migrations complete");

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
      let user = await queryOne("SELECT * FROM users WHERE id = $1", ['user_123']);
      if (!user) {
        await execute(
          "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
          ['user_123', 'demo@example.com', 'Demo User']
        );
        user = await queryOne("SELECT * FROM users WHERE id = $1", ['user_123']);
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
      let user = await queryOne("SELECT * FROM users WHERE id = $1", [googleUser.id]);
      if (!user) {
        // SECURITY: Sanitize user input from Google
        const sanitizedEmail = (googleUser.email || '').substring(0, 255);
        const sanitizedName = (googleUser.name || 'User').substring(0, 100);

        await execute(
          "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
          [googleUser.id, sanitizedEmail, sanitizedName]
        );
        user = await queryOne("SELECT * FROM users WHERE id = $1", [googleUser.id]);
      }

      sendAuthResponse(user);
    } catch (error: any) {
      console.error('OAuth Error:', error.response?.data || error.message);
      res.status(500).send('Authentication failed. Please try again.');
    }
  });

  app.get("/api/auth/demo", async (req, res) => {
    let user = await queryOne("SELECT * FROM users WHERE id = $1", ['demo_user']);
    if (!user) {
      await execute(
        "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
        ['demo_user', 'guest@example.com', 'Guest Student']
      );
      user = await queryOne("SELECT * FROM users WHERE id = $1", ['demo_user']);
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
      let user = await queryOne("SELECT * FROM users WHERE id = $1", ['demo_user']);
      if (!user) {
        await execute(
          "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
          ['demo_user', 'guest@example.com', 'Demo User']
        );
        user = await queryOne("SELECT * FROM users WHERE id = $1", ['demo_user']);
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
      let user: any = await queryOne("SELECT * FROM users WHERE id = $1", [googleId]);

      if (!user) {
        // Create new user
        await execute(
          "INSERT INTO users (id, email, name, avatar) VALUES ($1, $2, $3, $4)",
          [googleId, email, name, avatar]
        );
        user = await queryOne("SELECT * FROM users WHERE id = $1", [googleId]);
      } else {
        // Update existing user's avatar if they don't have one
        if (!user.avatar && avatar) {
          await execute("UPDATE users SET avatar = $1 WHERE id = $2", [avatar, googleId]);
          user = await queryOne("SELECT * FROM users WHERE id = $1", [googleId]);
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
  app.post("/api/user/onboard", async (req, res) => {
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
    const existingUser = await queryOne("SELECT * FROM users WHERE id = $1", [userId]);

    if (existingUser) {
      await execute(`
        UPDATE users
        SET
          name = COALESCE($1, name),
          age = COALESCE($2, age),
          gender = COALESCE($3, gender),
          native_lang = COALESCE($4, native_lang),
          target_lang = COALESCE($5, target_lang),
          avatar = COALESCE($6, avatar),
          is_onboarded = CASE WHEN $1 IS NOT NULL THEN 1 ELSE is_onboarded END
        WHERE id = $7
      `, [validatedName, validatedAge, validatedGender, validatedNativeLang, validatedTargetLang, validatedAvatar, userId]);
    } else {
      // For demo_user or cases where OAuth didn't create the record yet
      await execute(`
        INSERT INTO users (id, name, age, gender, native_lang, target_lang, avatar, is_onboarded)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
      `, [userId, validatedName || 'User', validatedAge, validatedGender, validatedNativeLang || 'Russian', validatedTargetLang || 'English', validatedAvatar]);
    }

    const user = await queryOne("SELECT * FROM users WHERE id = $1", [userId]);
    res.json(user || { error: "Failed to retrieve user after onboarding" });
  });

  app.get("/api/user/:id", async (req, res) => {
    // SECURITY: Validate user ID
    if (!isValidString(req.params.id, 100)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    const user = await queryOne("SELECT * FROM users WHERE id = $1", [req.params.id]);
    res.json(user || { error: "Not found" });
  });

  app.get("/api/user/:id/progress", async (req, res) => {
    // SECURITY: Validate user ID
    if (!isValidString(req.params.id, 100)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    const rows = await query<{ topic_id: string }>("SELECT topic_id FROM user_progress WHERE user_id = $1", [req.params.id]);
    res.json(rows.map(r => r.topic_id));
  });

  app.post("/api/user/complete-topic", async (req, res) => {
    const { userId, topicId } = req.body;

    // SECURITY: Validate input
    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!isValidString(topicId, 50)) {
      return res.status(400).json({ error: "Invalid topicId" });
    }

    await ensureUserExists(userId);
    await execute(
      "INSERT INTO user_progress (user_id, topic_id) VALUES ($1, $2) ON CONFLICT (user_id, topic_id) DO UPDATE SET completed_at = CURRENT_TIMESTAMP",
      [userId, topicId]
    );
    res.json({ success: true });
  });

  app.post("/api/user/update-progress", async (req, res) => {
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

    await execute(
      "UPDATE users SET level = COALESCE($1, level), points = points + $2, last_active = CURRENT_TIMESTAMP WHERE id = $3",
      [validatedLevel, validatedPoints, userId]
    );

    if (weakTopic && isValidString(weakTopic, 100)) {
      await execute(
        "INSERT INTO memory (user_id, topic, summary) VALUES ($1, $2, $3)",
        [userId, weakTopic, "User struggled with this topic"]
      );
    }
    res.json({ success: true });
  });

  app.post("/api/user/update-languages", async (req, res) => {
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

    await execute(
      "UPDATE users SET native_lang = $1, target_lang = $2 WHERE id = $3",
      [nativeLang, targetLang, userId]
    );
    res.json({ success: true });
  });

  app.post("/api/user/update", async (req, res) => {
    const { userId, voice, name, age, gender, avatar } = req.body;

    if (!isValidString(userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (voice && (voice === 'lumie' || voice === 'leo')) {
      updates.push(`voice = $${paramIndex++}`);
      params.push(voice);
    }
    if (name && isValidString(name, 100)) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (age !== undefined) {
      updates.push(`age = $${paramIndex++}`);
      params.push(age);
    }
    if (gender && isValidString(gender, 20)) {
      updates.push(`gender = $${paramIndex++}`);
      params.push(gender);
    }
    if (avatar && isValidString(avatar, 200)) {
      updates.push(`avatar = $${paramIndex++}`);
      params.push(avatar);
    }

    if (updates.length === 0) {
      return res.json({ success: true, message: "No updates provided" });
    }

    params.push(userId);
    await execute(`UPDATE users SET ${updates.join(", ")} WHERE id = $${paramIndex}`, params);
    res.json({ success: true });
  });

  // --- SECURE API CONFIG ---
  // SECURITY: Rate limiting for API key requests
  const apiKeyRequestCounts = new Map<string, { count: number; resetTime: number }>();
  const API_KEY_RATE_LIMIT = 10; // requests per minute
  const API_KEY_RATE_WINDOW = 60000; // 1 minute in ms

  app.get("/api/config/live-api-key", async (req, res) => {
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
      const user = await queryOne("SELECT id FROM users WHERE id = $1", [req.query.userId]);
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
    let embeddingVector: string | null = null;
    if (embedding && Array.isArray(embedding)) {
      // SECURITY: Validate embedding - must be 384 dimensions for our model
      if (embedding.length !== 384) {
        return res.status(400).json({ error: `Invalid embedding dimension: expected 384, got ${embedding.length}` });
      }
      if (!embedding.every(v => typeof v === 'number' && isFinite(v))) {
        return res.status(400).json({ error: "Invalid embedding values" });
      }
      embeddingVector = toVectorString(embedding);
    }

    await ensureUserExists(userId);

    // Insert into memory table with embedding
    const result = await queryOne<{ id: number }>(
      "INSERT INTO memory (user_id, topic, summary, embedding) VALUES ($1, $2, $3, $4::vector) RETURNING id",
      [userId, validatedTopic, text, embeddingVector]
    );

    res.json({ success: true, id: result?.id });
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
      const rows = await query(
        "SELECT 'memory' as source, id, topic, summary FROM memory WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
        [userId]
      );
      return res.json(rows.map((row: any) => ({ ...row, similarity: 0 })));
    }

    try {
      // Use pgvector for fast vector similarity search (cosine distance)
      const embeddingVector = toVectorString(embedding);

      // Search memory facts (up to 50 results)
      const memoryResults = await query<{ source: string; id: number; topic: string; content: string; similarity: number }>(`
        SELECT
          'memory' as source,
          id,
          topic,
          summary as content,
          1 - (embedding <=> $1::vector) as similarity
        FROM memory
        WHERE user_id = $2 AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT 50
      `, [embeddingVector, userId]);

      // Search conversation history (up to 20 results)
      const messageResults = await query<{ source: string; id: number; topic: string; content: string; similarity: number }>(`
        SELECT
          'message' as source,
          m.id,
          'history' as topic,
          m.content,
          1 - (m.embedding <=> $1::vector) as similarity
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE c.user_id = $2 AND m.embedding IS NOT NULL
        ORDER BY m.embedding <=> $1::vector
        LIMIT 20
      `, [embeddingVector, userId]);

      // Combine and filter by similarity threshold
      const combined = [...memoryResults, ...messageResults]
        .filter(r => r.similarity > 0.25)
        .sort((a, b) => b.similarity - a.similarity);

      res.json(combined);
    } catch (e) {
      console.error("Vector search failed:", e);
      // Fallback to returning recent memories without similarity
      const rows = await query(
        "SELECT 'memory' as source, id, topic, summary FROM memory WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
        [userId]
      );
      res.json(rows.map((row: any) => ({ ...row, similarity: 0 })));
    }
  });

  app.post("/api/conversations", async (req, res) => {
    const { id, user_id, title } = req.body;

    // SECURITY: Validate input
    if (!isValidString(id, 50)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }
    if (!isValidString(user_id, 100)) {
      return res.status(400).json({ error: "Invalid user_id" });
    }

    const validatedTitle = isValidString(title, 200) ? title : 'New Conversation';

    await ensureUserExists(user_id);
    await execute(
      "INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)",
      [id, user_id, validatedTitle]
    );
    res.json({ success: true });
  });

  app.get("/api/conversations/user/:userId", async (req, res) => {
    // SECURITY: Validate input
    if (!isValidString(req.params.userId, 100)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    const rows = await query(
      "SELECT * FROM conversations WHERE user_id = $1 ORDER BY created_at DESC",
      [req.params.userId]
    );
    res.json(rows);
  });

  app.get("/api/conversations/:id/messages", async (req, res) => {
    // SECURITY: Validate input
    if (!isValidString(req.params.id, 50)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }
    const rows = await query(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(rows);
  });

  app.post("/api/messages", async (req, res) => {
    const { conversation_id, role, content, type, embedding } = req.body;

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

    // Validate embedding if provided (all-MiniLM-L6-v2 produces 384 dimensions)
    const hasValidEmbedding = embedding && Array.isArray(embedding) && embedding.length === 384;

    // Ensure conversation exists to avoid FK error
    const conv = await queryOne("SELECT id, user_id FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    if (hasValidEmbedding) {
      const embeddingVector = toVectorString(embedding);
      await execute(
        "INSERT INTO messages (conversation_id, role, content, type, embedding) VALUES ($1, $2, $3, $4, $5::vector)",
        [conversation_id, role, content, validatedType, embeddingVector]
      );
    } else {
      await execute(
        "INSERT INTO messages (conversation_id, role, content, type) VALUES ($1, $2, $3, $4)",
        [conversation_id, role, content, validatedType]
      );
    }
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
