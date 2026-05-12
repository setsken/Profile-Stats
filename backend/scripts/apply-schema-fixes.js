#!/usr/bin/env node
/**
 * Applies in-place schema fixes to postgres-yo-b so the destination matches
 * the Stats Editor source schema. Idempotent.
 *
 * Run locally so the fix lands immediately, without waiting for the Railway
 * redeploy of Profile Stats backend.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/apply-schema-fixes.js
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (destination = postgres-yo-b)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const FIXES = [
  // user_models: rename concept (added_at -> created_at) + drop legacy column.
  { sql: `ALTER TABLE user_models ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`, label: 'user_models.created_at exists' },
  { sql: `ALTER TABLE user_models DROP COLUMN IF EXISTS added_at`, label: 'user_models.added_at removed' },

  // model_fans_history: extra columns + allow NULL fans_count.
  { sql: `ALTER TABLE model_fans_history ADD COLUMN IF NOT EXISTS fans_text VARCHAR(255)`, label: 'model_fans_history.fans_text exists' },
  { sql: `ALTER TABLE model_fans_history ADD COLUMN IF NOT EXISTS recorded_by INTEGER`, label: 'model_fans_history.recorded_by exists' },
  { sql: `ALTER TABLE model_fans_history ALTER COLUMN fans_count DROP NOT NULL`, label: 'model_fans_history.fans_count nullable' }
];

(async () => {
  console.log('🔧 Applying schema fixes to postgres-yo-b\n');
  for (const { sql, label } of FIXES) {
    try {
      await pool.query(sql);
      console.log(`✅ ${label}`);
    } catch (e) {
      console.log(`⚠️  ${label}: ${e.message}`);
    }
  }
  console.log('\nDone.');
  await pool.end();
})();
