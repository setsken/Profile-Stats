const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('[db] connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err);
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production' || duration > 500) {
    console.log('[db] query', { text: text.substring(0, 60), duration, rows: result.rowCount });
  }
  return result;
}

async function getOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function getMany(text, params) {
  const result = await query(text, params);
  return result.rows;
}

module.exports = { pool, query, getOne, getMany };
