#!/usr/bin/env node
/**
 * Quick read-only sanity check for the avatar pipeline.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/check-avatars.js
 *
 * (DATABASE_URL must point at postgres-yo-b — the Profile Stats DB.)
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (postgres-yo-b public URL)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const counts = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(avatar_url) AS with_avatar,
        ROUND(COUNT(avatar_url) * 100.0 / NULLIF(COUNT(*), 0), 1) AS pct
      FROM model_quality_snapshots
    `);
    const c = counts.rows[0];
    console.log('=== model_quality_snapshots ===');
    console.log(`  total models     : ${c.total}`);
    console.log(`  with avatar_url  : ${c.with_avatar} (${c.pct || 0}%)`);

    const recent = await pool.query(`
      SELECT model_username, avatar_url, updated_at
      FROM model_quality_snapshots
      WHERE avatar_url IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    console.log('\n=== 5 most recently updated avatars ===');
    for (const r of recent.rows) {
      console.log(`  ${r.updated_at.toISOString().slice(0, 19)}  @${r.model_username}`);
      console.log(`    ${(r.avatar_url || '').slice(0, 100)}`);
    }

    if (recent.rowCount === 0) {
      console.log('  (no avatars yet — visit a few OnlyFans profiles with Profile Stats enabled, then re-run.)');
    }
  } catch (e) {
    console.error('Check failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
