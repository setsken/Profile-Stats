const express = require('express');
const { query, getMany } = require('../config/database');

const router = express.Router();

// ---------------------------------------------------------------------------
// Alert payloads are rendered by the badge as HTML (inject-early builds the
// alert row from `diff` / `pct` / `oldGrade` / `newGrade`). This endpoint is
// public, so every field has to come out of a fixed vocabulary — otherwise a
// stranger can POST markup for any username and have it execute inside
// onlyfans.com for every user who opens that profile.
//
// The same whitelist runs on the READ path too: rows written before this
// validation existed (and older extension builds that render them) must not
// be able to smuggle anything through.
// ---------------------------------------------------------------------------

const ALERT_TYPES = new Set([
  'fans_surge', 'fans_drop', 'likes_surge', 'likes_drop', 'score_up', 'score_down'
]);

// Exactly the three colours the badge emits; anything else becomes null and
// the client falls back to its neutral style.
const ALERT_COLORS = new Set(['#22c55e', '#ef4444', '#eab308']);

// Grade labels produced by calculateModelScore().
const GRADES = new Set(['TOP', 'Good', 'Average', 'Suspicious', 'Likely Fake']);

// OnlyFans handles: letters, digits, dot, dash, underscore.
const USERNAME_RE = /^[a-z0-9._-]{1,100}$/;

// "+1 234", "-12", "+1,234" — sign, digits, and thousands separators only.
//   /   are the non-breaking spaces toLocaleString() emits.
const DIFF_RE = /^[+-]?[\d.,\s  ]{1,40}$/;

// "+12.3%", "-0.5%"
const PCT_RE = /^[+-]?\d{1,6}([.,]\d{1,2})?%$/;

function cleanUsername(raw) {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase().replace(/^@/, '');
  return USERNAME_RE.test(u) ? u : null;
}

function cleanType(raw) {
  return typeof raw === 'string' && ALERT_TYPES.has(raw) ? raw : null;
}

function cleanColor(raw) {
  return typeof raw === 'string' && ALERT_COLORS.has(raw) ? raw : null;
}

// Icons are emoji. Reject anything containing characters that could start
// markup, and cap the length well under the VARCHAR(10) column.
function cleanIcon(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 8) return null;
  if (/[<>&"'`\\/]/.test(s)) return null;
  return s;
}

function cleanDiff(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return DIFF_RE.test(s) ? s : null;
}

function cleanPct(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return PCT_RE.test(s) ? s : null;
}

function cleanScore(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

function cleanGrade(raw) {
  return typeof raw === 'string' && GRADES.has(raw) ? raw : null;
}

// Normalise one stored row into the shape the extension expects, dropping
// every value that isn't in the vocabulary above.
function sanitizeStoredAlert(row) {
  const extra = row.extra_data || {};
  const type = cleanType(row.type);
  if (!type) return null;
  return {
    id: row.username + '_' + type + '_' + row.alert_date,
    username: row.username,
    type,
    icon: cleanIcon(row.icon),
    color: cleanColor(row.color),
    diff: cleanDiff(row.diff),
    pct: cleanPct(row.pct),
    oldScore: cleanScore(extra.oldScore),
    newScore: cleanScore(extra.newScore),
    oldGrade: cleanGrade(extra.oldGrade),
    newGrade: cleanGrade(extra.newGrade),
    date: new Date(row.created_at).getTime()
  };
}

// POST /report — public; clients send detected anomalies for a model
router.post('/report', async (req, res) => {
  try {
    const { username, alerts } = req.body;
    const cleanUser = cleanUsername(username);
    if (!cleanUser || !Array.isArray(alerts) || alerts.length === 0) {
      return res.status(400).json({ error: 'Missing username or alerts array' });
    }
    if (alerts.length > 10) {
      return res.status(400).json({ error: 'Too many alerts in one request (max 10)' });
    }

    // Validate first, then write what survived. Anything malformed is
    // silently dropped rather than 400'd so one bad entry from an older
    // client doesn't discard the whole batch.
    const rows = [];
    for (const a of alerts) {
      if (!a || typeof a !== 'object') continue;
      const type = cleanType(a.type);
      const icon = cleanIcon(a.icon);
      const color = cleanColor(a.color);
      if (!type || !icon || !color) continue;

      let alertDate;
      if (a.date) {
        const d = new Date(a.date);
        if (isNaN(d.getTime())) continue;
        alertDate = d.toISOString().slice(0, 10);
      } else {
        alertDate = new Date().toISOString().slice(0, 10);
      }

      rows.push({
        type,
        icon,
        color,
        diff: cleanDiff(a.diff),
        pct: cleanPct(a.pct),
        extra: {
          oldScore: cleanScore(a.oldScore),
          newScore: cleanScore(a.newScore),
          oldGrade: cleanGrade(a.oldGrade),
          newGrade: cleanGrade(a.newGrade)
        },
        alertDate
      });
    }

    if (rows.length === 0) {
      return res.json({ success: true, inserted: 0 });
    }

    // ON CONFLICT DO NOTHING replaces the previous SELECT-then-INSERT loop:
    // one round-trip instead of two per alert, and no race between the check
    // and the write.
    let inserted = 0;
    for (const r of rows) {
      const result = await query(
        `INSERT INTO model_alerts (model_username, alert_type, icon, color, diff, pct, extra_data, alert_date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (model_username, alert_type, alert_date) DO NOTHING`,
        [cleanUser, r.type, r.icon, r.color, r.diff, r.pct, JSON.stringify(r.extra), r.alertDate]
      );
      inserted += result.rowCount || 0;
    }

    res.json({ success: true, inserted });
  } catch (error) {
    console.error('Report alerts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /:username — public; recent alerts for a model
router.get('/:username', async (req, res) => {
  try {
    const cleanUser = cleanUsername(req.params.username);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    if (!cleanUser) {
      return res.status(400).json({ error: 'Missing username' });
    }

    const rows = await getMany(
      `SELECT id, model_username AS username, alert_type AS type, icon, color, diff, pct, extra_data, alert_date, created_at
       FROM model_alerts
       WHERE model_username = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [cleanUser, limit]
    );

    const alerts = rows.map(sanitizeStoredAlert).filter(Boolean);

    res.json({ success: true, alerts });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
