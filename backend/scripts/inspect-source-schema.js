#!/usr/bin/env node
/**
 * Read-only inspector: print column lists for Profile Stats tables
 * from the Stats Editor source database.
 *
 * Usage:
 *   STATS_EDITOR_DATABASE_URL=postgresql://... \
 *   node scripts/inspect-source-schema.js
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.STATS_EDITOR_DATABASE_URL) {
  console.error('STATS_EDITOR_DATABASE_URL is required');
  process.exit(1);
}

const TABLES = [
  'user_models',
  'user_tags',
  'user_notes',
  'model_alerts',
  'model_fans_daily',
  'model_fans_history',
  'model_quality_snapshots'
];

const pool = new Pool({
  connectionString: process.env.STATS_EDITOR_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    for (const name of TABLES) {
      const r = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1
         ORDER BY ordinal_position`,
        [name]
      );
      console.log(`\n=== ${name} ===`);
      if (r.rowCount === 0) {
        console.log('  (table not found)');
        continue;
      }
      for (const row of r.rows) {
        console.log(`  ${row.column_name.padEnd(24)} ${row.data_type.padEnd(28)} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL    '} ${row.column_default || ''}`);
      }
    }
  } catch (e) {
    console.error('Inspect failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
