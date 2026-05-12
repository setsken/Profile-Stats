#!/usr/bin/env node
/**
 * One-time data migration: copy Profile-Stats tables from the Stats Editor
 * main database into postgres-yo-b (the Profile Stats DB).
 *
 * Source (read-only):   STATS_EDITOR_DATABASE_URL  ->  postgres (main)
 * Destination (writes): DATABASE_URL               ->  postgres-yo-b
 *
 * Idempotent: re-running skips rows already present (ON CONFLICT DO NOTHING).
 * Non-destructive: never deletes or mutates the source database.
 *
 * Usage:
 *   STATS_EDITOR_DATABASE_URL=postgresql://... \
 *   DATABASE_URL=postgresql://...              \
 *   node scripts/migrate-from-stats-editor.js
 *
 * Add --dry-run to count rows on both sides without writing.
 */

require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;

if (!process.env.STATS_EDITOR_DATABASE_URL) {
  console.error('❌ STATS_EDITOR_DATABASE_URL is required (source).');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is required (destination = postgres-yo-b).');
  process.exit(1);
}

const sourcePool = new Pool({
  connectionString: process.env.STATS_EDITOR_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const destPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Each entry describes how to migrate one table.
// columns: ordered list of columns to copy.
// conflictTarget: ON CONFLICT clause; null = no conflict resolution needed.
// hasSerialId: true if the table has a SERIAL PRIMARY KEY whose sequence must be bumped after copy.
const TABLES = [
  {
    name: 'user_models',
    columns: ['id', 'user_id', 'model_username', 'display_name', 'created_at', 'is_deleted', 'deleted_at'],
    conflictTarget: '(id) DO NOTHING',
    hasSerialId: true,
    serialColumn: 'id'
  },
  {
    name: 'user_tags',
    columns: ['id', 'user_id', 'name', 'color_index', 'created_at'],
    conflictTarget: '(id) DO NOTHING',
    hasSerialId: true,
    serialColumn: 'id'
  },
  {
    name: 'user_notes',
    columns: ['id', 'user_id', 'model_username', 'note_text', 'tags', 'note_date', 'avatar_url', 'created_at', 'updated_at'],
    jsonColumns: ['tags'],
    conflictTarget: '(user_id, model_username) DO NOTHING',
    hasSerialId: true,
    serialColumn: 'id'
  },
  {
    name: 'model_alerts',
    columns: ['id', 'model_username', 'alert_type', 'icon', 'color', 'diff', 'pct', 'extra_data', 'alert_date', 'created_at'],
    jsonColumns: ['extra_data'],
    conflictTarget: '(model_username, alert_type, alert_date) DO NOTHING',
    hasSerialId: true,
    serialColumn: 'id'
  },
  {
    name: 'model_fans_daily',
    columns: ['model_username', 'day', 'fans_count', 'reporters', 'updated_at'],
    conflictTarget: '(model_username, day) DO NOTHING',
    hasSerialId: false
  },
  {
    name: 'model_fans_history',
    columns: ['id', 'model_username', 'fans_count', 'fans_text', 'recorded_at', 'recorded_by'],
    conflictTarget: '(id) DO NOTHING',
    hasSerialId: true,
    serialColumn: 'id'
  },
  {
    name: 'model_quality_snapshots',
    columns: ['model_username', 'quality_score', 'score', 'organicity', 'engagement_rate', 'negative_flags', 'updated_at'],
    conflictTarget: '(model_username) DO NOTHING',
    hasSerialId: false
  }
];

async function tableExists(pool, name) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [name]
  );
  return r.rowCount > 0;
}

async function countRows(pool, name) {
  const r = await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${name}`);
  return Number(r.rows[0].c);
}

async function copyTable(spec) {
  const { name, columns, conflictTarget, hasSerialId, serialColumn, jsonColumns = [] } = spec;

  // Source must have the table; destination must have been migrated by index.js
  const srcExists = await tableExists(sourcePool, name);
  const dstExists = await tableExists(destPool, name);

  if (!srcExists) {
    console.log(`⏭️  ${name}: source table not found, skipping`);
    return { copied: 0, skipped: true };
  }
  if (!dstExists) {
    console.log(`⚠️  ${name}: destination table not found — did the Profile Stats backend run migrations?`);
    return { copied: 0, skipped: true };
  }

  const srcCount = await countRows(sourcePool, name);
  const dstCountBefore = await countRows(destPool, name);
  console.log(`\n=== ${name} ===`);
  console.log(`  source rows: ${srcCount}`);
  console.log(`  destination rows (before): ${dstCountBefore}`);

  if (DRY_RUN) {
    console.log('  (dry-run: no writes performed)');
    return { copied: 0, dryRun: true };
  }
  if (srcCount === 0) {
    console.log('  source empty, nothing to copy');
    return { copied: 0 };
  }

  const colsSql = columns.join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `
    INSERT INTO ${name} (${colsSql})
    VALUES (${placeholders})
    ON CONFLICT ${conflictTarget}
  `;

  // Stream the source in batches via OFFSET/LIMIT keyed on stable ordering.
  // Most tables have a useful ordering column; fall back to all columns.
  const orderBy = columns.includes('id') ? 'id'
                : columns.includes('created_at') ? 'created_at'
                : columns.includes('updated_at') ? 'updated_at'
                : columns.includes('day') ? 'model_username, day'
                : columns[0];

  let copied = 0;
  let offset = 0;
  while (offset < srcCount) {
    const selectSql = `SELECT ${colsSql} FROM ${name} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`;
    const batch = await sourcePool.query(selectSql, [BATCH_SIZE, offset]);
    if (batch.rowCount === 0) break;

    const client = await destPool.connect();
    try {
      await client.query('BEGIN');
      for (const row of batch.rows) {
        const values = columns.map(c => {
          const v = row[c];
          // pg returns JSONB as parsed JS objects. To round-trip them through a
          // parameterized INSERT we must re-serialize, otherwise pg coerces the
          // object to "[object Object]" which Postgres rejects as invalid JSON.
          if (jsonColumns.includes(c) && v !== null && typeof v === 'object') {
            return JSON.stringify(v);
          }
          return v;
        });
        await client.query(insertSql, values);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    copied += batch.rowCount;
    offset += batch.rowCount;
    process.stdout.write(`  ...${copied}/${srcCount}\r`);
  }
  process.stdout.write('\n');

  // Bump the SERIAL sequence so future INSERTs don't collide with copied IDs.
  if (hasSerialId) {
    const seqName = `${name}_${serialColumn}_seq`;
    await destPool.query(
      `SELECT setval('${seqName}', GREATEST((SELECT COALESCE(MAX(${serialColumn}), 0) FROM ${name}), 1))`
    );
    console.log(`  sequence ${seqName} bumped to MAX(${serialColumn})`);
  }

  const dstCountAfter = await countRows(destPool, name);
  console.log(`  destination rows (after): ${dstCountAfter}`);
  console.log(`  copied this run: ${copied}`);
  return { copied, srcCount, dstCountBefore, dstCountAfter };
}

(async () => {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes\n' : '🚚 Migrating Profile Stats tables postgres -> postgres-yo-b\n');
  const summary = [];

  try {
    for (const spec of TABLES) {
      const result = await copyTable(spec);
      summary.push({ table: spec.name, ...result });
    }

    console.log('\n========== SUMMARY ==========');
    for (const s of summary) {
      const tag = s.skipped ? 'SKIP' : s.dryRun ? 'DRY' : 'OK';
      console.log(`[${tag}] ${s.table}: copied=${s.copied || 0}${s.srcCount != null ? ` (src=${s.srcCount}, dst_after=${s.dstCountAfter})` : ''}`);
    }
    console.log('=============================');

    await sourcePool.end();
    await destPool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    await sourcePool.end().catch(() => {});
    await destPool.end().catch(() => {});
    process.exit(1);
  }
})();
