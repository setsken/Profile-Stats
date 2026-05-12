require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { query } = require('./config/database');

const healthRoutes = require('./routes/health');

const app = express();

// Schema migrations — run on startup. Tables stay empty until Etap 3 (data migration).
async function runMigrations() {
  try {
    // user_models — list of OnlyFans usernames a Profile Stats user is tracking.
    // user_id is NOT a foreign key here: users live in the Stats Editor DB.
    // Schema mirrors the Stats Editor source so migration is a straight column-by-column copy.
    await query(`
      CREATE TABLE IF NOT EXISTS user_models (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        model_username VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP
      )
    `).catch(() => {});
    // Drop the legacy 'added_at' column from the initial skeleton (only present on fresh deploys
    // that ran before this fix; safe no-op everywhere else).
    await query('ALTER TABLE user_models DROP COLUMN IF EXISTS added_at').catch(() => {});
    await query('ALTER TABLE user_models ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()').catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_user_models_user_id ON user_models(user_id)').catch(() => {});

    // user_notes — personal notes per (user, model).
    await query(`
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
    `).catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON user_notes(user_id)').catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_user_notes_model ON user_notes(user_id, model_username)').catch(() => {});

    // user_tags — personal tags for notes.
    await query(`
      CREATE TABLE IF NOT EXISTS user_tags (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(50) NOT NULL,
        color_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_user_tags_user_id ON user_tags(user_id)').catch(() => {});

    // model_alerts — global alerts (shared across users).
    await query(`
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
    `).catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_model_alerts_username ON model_alerts(model_username)').catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_model_alerts_date ON model_alerts(alert_date)').catch(() => {});

    // model_fans_daily — aggregated daily fan count per model.
    await query(`
      CREATE TABLE IF NOT EXISTS model_fans_daily (
        model_username VARCHAR(255) NOT NULL,
        day DATE NOT NULL,
        fans_count INTEGER NOT NULL,
        reporters INTEGER DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model_username, day)
      )
    `).catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_model_fans_daily_username ON model_fans_daily(model_username)').catch(() => {});

    // model_fans_history — raw fan count reports (used to backfill daily).
    // fans_count is nullable in source (sometimes only a fans_text label is captured).
    await query(`
      CREATE TABLE IF NOT EXISTS model_fans_history (
        id SERIAL PRIMARY KEY,
        model_username VARCHAR(255) NOT NULL,
        fans_count INTEGER,
        fans_text VARCHAR(255),
        recorded_at TIMESTAMP DEFAULT NOW(),
        recorded_by INTEGER
      )
    `).catch(() => {});
    await query('ALTER TABLE model_fans_history ADD COLUMN IF NOT EXISTS fans_text VARCHAR(255)').catch(() => {});
    await query('ALTER TABLE model_fans_history ADD COLUMN IF NOT EXISTS recorded_by INTEGER').catch(() => {});
    // Source schema allows NULL fans_count (sometimes only fans_text is captured).
    await query('ALTER TABLE model_fans_history ALTER COLUMN fans_count DROP NOT NULL').catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_model_fans_history_username ON model_fans_history(model_username)').catch(() => {});

    // model_quality_snapshots — latest aggregated quality score per model.
    await query(`
      CREATE TABLE IF NOT EXISTS model_quality_snapshots (
        model_username VARCHAR(255) PRIMARY KEY,
        quality_score NUMERIC(6,5) NOT NULL,
        score NUMERIC(6,2) NOT NULL,
        organicity NUMERIC(6,2) NOT NULL,
        engagement_rate NUMERIC(12,6) NOT NULL,
        negative_flags INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_model_quality_snapshots_quality ON model_quality_snapshots(quality_score)').catch(() => {});

    // farmed_models is already present in this database (was previously the only table).
    // Make sure it exists so a fresh DB also boots cleanly.
    await query(`
      CREATE TABLE IF NOT EXISTS farmed_models (
        username VARCHAR(255) PRIMARY KEY,
        of_url TEXT,
        found_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20)
      )
    `).catch(() => {});

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

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.startsWith('chrome-extension://')) return callback(null, true);
    if (origin.includes('onlyfans.com')) return callback(null, true);
    if (origin.includes('localhost')) return callback(null, true);
    callback(null, true); // permissive while we bring the service up; tighten later
  },
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

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
