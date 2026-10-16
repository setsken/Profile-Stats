require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { query } = require('./config/database');

const healthRoutes = require('./routes/health');
const modelsRoutes = require('./routes/models');
const fansRoutes = require('./routes/fans');
const farmedModelsRoutes = require('./routes/farmed-models');
const alertsRoutes = require('./routes/alerts');
const notesRoutes = require('./routes/notes');
const verdictRoutes = require('./routes/verdict');
const billingRoutes = require('./routes/billing');

const app = express();

// Postgres error codes that mean "this migration is already applied".
// Anything else is a real problem and must not be swallowed silently —
// the previous blanket .catch(() => {}) hid broken migrations for months.
const MIGRATION_NOOP_CODES = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (constraint/index already exists)
  '42701', // duplicate_column
  '42P16'  // invalid_table_definition (e.g. DROP NOT NULL on a PK column)
]);

async function mig(sql, label) {
  try {
    await query(sql);
  } catch (e) {
    if (MIGRATION_NOOP_CODES.has(e.code)) return;
    console.warn('[migrations] ' + (label || sql.trim().slice(0, 60)) + ' -> ' + e.message);
  }
}

// Schema migrations — run on startup. Tables stay empty until Etap 3 (data migration).
async function runMigrations() {
  try {
    // user_models — list of OnlyFans usernames a Profile Stats user is tracking.
    // user_id is NOT a foreign key here: users live in the Stats Editor DB.
    // Schema mirrors the Stats Editor source so migration is a straight column-by-column copy.
    await mig(`
      CREATE TABLE IF NOT EXISTS user_models (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        model_username VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP
      )
    `);
    // Drop the legacy 'added_at' column from the initial skeleton (only present on fresh deploys
    // that ran before this fix; safe no-op everywhere else).
    await mig('ALTER TABLE user_models DROP COLUMN IF EXISTS added_at');
    await mig('ALTER TABLE user_models ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()');
    await mig('CREATE INDEX IF NOT EXISTS idx_user_models_user_id ON user_models(user_id)');

    // user_notes — personal notes per (user, model).
    await mig(`
      CREATE TABLE IF NOT EXISTS user_notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        model_username VARCHAR(255) NOT NULL,
        note_text TEXT DEFAULT '',
        tags JSONB DEFAULT '[]',
        note_date TIMESTAMP,
        avatar_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, model_username)
      )
    `);
    await mig('CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON user_notes(user_id)');
    await mig('CREATE INDEX IF NOT EXISTS idx_user_notes_model ON user_notes(user_id, model_username)');

    // user_tags — personal tags for notes.
    await mig(`
      CREATE TABLE IF NOT EXISTS user_tags (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(50) NOT NULL,
        color_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await mig('CREATE INDEX IF NOT EXISTS idx_user_tags_user_id ON user_tags(user_id)');

    // model_alerts — global alerts (shared across users).
    await mig(`
      CREATE TABLE IF NOT EXISTS model_alerts (
        id SERIAL PRIMARY KEY,
        model_username VARCHAR(255) NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        icon VARCHAR(10),
        color VARCHAR(20),
        diff VARCHAR(50),
        pct VARCHAR(20),
        extra_data JSONB DEFAULT '{}',
        alert_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(model_username, alert_type, alert_date)
      )
    `);
    await mig('CREATE INDEX IF NOT EXISTS idx_model_alerts_username ON model_alerts(model_username)');
    await mig('CREATE INDEX IF NOT EXISTS idx_model_alerts_date ON model_alerts(alert_date)');
    // The UNIQUE triple is what /alerts/report's ON CONFLICT DO NOTHING keys
    // on. Tables created before it was part of the CREATE statement need it
    // added explicitly, otherwise every insert throws.
    await mig(`ALTER TABLE model_alerts ADD CONSTRAINT model_alerts_username_type_date_unique
               UNIQUE (model_username, alert_type, alert_date)`, 'model_alerts unique triple');
    // Serving one model's alert list newest-first is the only read pattern.
    await mig('CREATE INDEX IF NOT EXISTS idx_model_alerts_username_created ON model_alerts(model_username, created_at DESC)');

    // model_fans_daily — aggregated daily fan count per model.
    await mig(`
      CREATE TABLE IF NOT EXISTS model_fans_daily (
        model_username VARCHAR(255) NOT NULL,
        day DATE NOT NULL,
        fans_count INTEGER NOT NULL,
        reporters INTEGER DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model_username, day)
      )
    `);
    await mig('CREATE INDEX IF NOT EXISTS idx_model_fans_daily_username ON model_fans_daily(model_username)');

    // model_fans_history — raw fan count reports (used to backfill daily).
    // fans_count is nullable in source (sometimes only a fans_text label is captured).
    await mig(`
      CREATE TABLE IF NOT EXISTS model_fans_history (
        id SERIAL PRIMARY KEY,
        model_username VARCHAR(255) NOT NULL,
        fans_count INTEGER,
        fans_text VARCHAR(255),
        recorded_at TIMESTAMP DEFAULT NOW(),
        recorded_by INTEGER
      )
    `);
    await mig('ALTER TABLE model_fans_history ADD COLUMN IF NOT EXISTS fans_text VARCHAR(255)');
    await mig('ALTER TABLE model_fans_history ADD COLUMN IF NOT EXISTS recorded_by INTEGER');
    // Source schema allows NULL fans_count (sometimes only fans_text is captured).
    await mig('ALTER TABLE model_fans_history ALTER COLUMN fans_count DROP NOT NULL');
    await mig('CREATE INDEX IF NOT EXISTS idx_model_fans_history_username ON model_fans_history(model_username)');
    // UNIQUE constraint on model_username — required for the
    // ON CONFLICT (model_username) DO UPDATE used by /fans/report and
    // the new fans-side-write inside /fans/snapshot. Without it the
    // upsert silently throws and the leaderboard goes stale.
    await mig('ALTER TABLE model_fans_history ADD CONSTRAINT model_fans_history_model_username_unique UNIQUE (model_username)');

    // model_quality_snapshots — latest aggregated quality score per model.
    await mig(`
      CREATE TABLE IF NOT EXISTS model_quality_snapshots (
        model_username VARCHAR(255) PRIMARY KEY,
        quality_score NUMERIC(6,5),
        score NUMERIC(6,2),
        organicity NUMERIC(6,2),
        engagement_rate NUMERIC(12,6),
        negative_flags INTEGER DEFAULT 0,
        avatar_url VARCHAR(500),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)');
    // /fans/snapshot inserts a row WITHOUT quality_score / score / etc
    // when a model is first seen via metrics-only path. The legacy schema
    // had NOT NULL on those columns and silently 500'd. Idempotent drops:
    await mig('ALTER TABLE model_quality_snapshots ALTER COLUMN quality_score DROP NOT NULL');
    await mig('ALTER TABLE model_quality_snapshots ALTER COLUMN score DROP NOT NULL');
    await mig('ALTER TABLE model_quality_snapshots ALTER COLUMN organicity DROP NOT NULL');
    await mig('ALTER TABLE model_quality_snapshots ALTER COLUMN engagement_rate DROP NOT NULL');
    // Extended profile signals collected from the badge so the leaderboard can
    // filter by streams / socials / posts / subscription price etc.
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS posts_count INTEGER');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS videos_count INTEGER');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS photos_count INTEGER');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS streams_count INTEGER');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS likes_count INTEGER');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS subscribe_price NUMERIC(8,2)');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS account_months INTEGER');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS fans_visible BOOLEAN');
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS has_socials BOOLEAN');
    // Comments open/closed marker derived from the badge's _farmedStatus.
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN');
    // Exact join date — account_months remains for fast filtering, but
    // joined_date is what we display and sort by in Top Models.
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS joined_date DATE');
    // Per-platform social links the badge detected on the profile page.
    // Shape: [{ platform: 'instagram', url: 'https://...' }, ...]
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS socials_json JSONB');
    // Inflation/botted verdict — true when the badge's scoring fired any
    // of the "Botted Likes" / "Boosted Likes" / "Fake Fans" / "Suspect
    // Growth" achievements. Powers the Hide-botted filter.
    await mig('ALTER TABLE model_quality_snapshots ADD COLUMN IF NOT EXISTS is_botted BOOLEAN');
    await mig('CREATE INDEX IF NOT EXISTS idx_model_quality_snapshots_quality ON model_quality_snapshots(quality_score)');
    // The leaderboard's default sort is score DESC, and 'recent' sorts by
    // updated_at — both were doing a full scan + sort on every request.
    await mig('CREATE INDEX IF NOT EXISTS idx_model_quality_snapshots_score ON model_quality_snapshots(score DESC NULLS LAST)');
    await mig('CREATE INDEX IF NOT EXISTS idx_model_quality_snapshots_updated ON model_quality_snapshots(updated_at DESC)');

    // verdict_cache — AI verdicts keyed by (model, score, language).
    // The badge asks for a verdict on every profile view; without this each
    // view was a fresh (paid) xAI call, including repeat views of the same
    // profile by the same user and views of popular profiles by everyone.
    await mig(`
      CREATE TABLE IF NOT EXISTS verdict_cache (
        model_username VARCHAR(255) NOT NULL,
        score INTEGER NOT NULL,
        lang VARCHAR(5) NOT NULL,
        verdict TEXT NOT NULL,
        hits INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model_username, score, lang)
      )
    `);

    // farmed_models is already present in this database (was previously the only table).
    // Make sure it exists so a fresh DB also boots cleanly.
    await mig(`
      CREATE TABLE IF NOT EXISTS farmed_models (
        username VARCHAR(255) PRIMARY KEY,
        of_url TEXT,
        found_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20)
      )
    `);

    console.log('[migrations] schema ready');
  } catch (error) {
    console.log('[migrations] skipped or already applied:', error.message);
  }
}
runMigrations();

const PORT = process.env.PORT || 3000;

// Trust Railway proxy
app.set('trust proxy', 1);

app.use(helmet());

// Only the extension and OnlyFans pages talk to this API. The marketing site
// never calls it. A missing Origin (server-to-server, curl, the extension's
// own service worker on some Chrome builds) is allowed through — CORS is a
// browser-side control, the real gate is the auth middleware on each route.
const ALLOWED_ORIGIN_RE = /^(chrome-extension:\/\/[a-p]{32}|https:\/\/(www\.)?onlyfans\.com|http:\/\/localhost(:\d+)?)$/;

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGIN_RE.test(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Endpoints that accept writes without a JWT (older extension builds post
// alerts anonymously) get a much tighter budget than the general limit —
// a normal user reports a handful of alerts per browsing session.
const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/alerts/report', publicWriteLimiter);

// The AI verdict is the only route that costs real money per call.
const verdictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  // Per account, not per IP: several users can share an office IP, and one
  // user on a flaky connection shouldn't lock out the rest.
  keyGenerator: (req) => {
    const h = req.headers['authorization'] || '';
    return h ? 'jwt:' + h.slice(-24) : (req.ip || 'anon');
  },
  message: { error: 'Verdict rate limit reached, try again in a minute' }
});
app.use('/api/verdict', verdictLimiter);

app.use(express.json({ limit: '1mb' }));

// Liveness for Railway healthcheck
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Profile Stats Backend',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/models', modelsRoutes);
app.use('/api/fans', fansRoutes);
app.use('/api/farmed-models', farmedModelsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/verdict', verdictRoutes);
app.use('/api/billing', billingRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Profile Stats Backend listening on :${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Stats Editor API: ${process.env.STATS_EDITOR_API_URL || '(not set)'}`);
});

module.exports = app;
