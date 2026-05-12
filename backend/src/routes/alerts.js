const express = require('express');
const { query, getOne } = require('../config/database');

const router = express.Router();

// POST /report — public; clients send detected anomalies for a model
router.post('/report', async (req, res) => {
  try {
    const { username, alerts } = req.body;
    if (!username || !Array.isArray(alerts) || alerts.length === 0) {
      return res.status(400).json({ error: 'Missing username or alerts array' });
    }
    if (alerts.length > 10) {
      return res.status(400).json({ error: 'Too many alerts in one request (max 10)' });
    }

    let inserted = 0;
    for (const a of alerts) {
      if (!a.type || !a.icon || !a.color) continue;
      const alertDate = a.date ? new Date(a.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

      const existing = await getOne(
        'SELECT id FROM model_alerts WHERE model_username = $1 AND alert_type = $2 AND alert_date = $3',
        [username, a.type, alertDate]
      );
      if (existing) continue;

      await query(
        `INSERT INTO model_alerts (model_username, alert_type, icon, color, diff, pct, extra_data, alert_date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          username,
          a.type,
          a.icon,
          a.color,
          a.diff || null,
          a.pct || null,
          JSON.stringify({ oldScore: a.oldScore, newScore: a.newScore, oldGrade: a.oldGrade, newGrade: a.newGrade }),
          alertDate
        ]
      );
      inserted++;
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
    const { username } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    if (!username) {
      return res.status(400).json({ error: 'Missing username' });
    }

    const result = await query(
      `SELECT id, model_username AS username, alert_type AS type, icon, color, diff, pct, extra_data, alert_date, created_at
       FROM model_alerts
       WHERE model_username = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [username, limit]
    );

    const alerts = result.rows.map(row => {
      const extra = row.extra_data || {};
      return {
        id: row.username + '_' + row.type + '_' + row.alert_date,
        username: row.username,
        type: row.type,
        icon: row.icon,
        color: row.color,
        diff: row.diff,
        pct: row.pct,
        oldScore: extra.oldScore,
        newScore: extra.newScore,
        oldGrade: extra.oldGrade,
        newGrade: extra.newGrade,
        date: new Date(row.created_at).getTime()
      };
    });

    res.json({ success: true, alerts });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
