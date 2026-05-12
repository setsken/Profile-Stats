const express = require('express');
const { query, getOne, getMany } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// DEBUG: recent fans records (no auth)
router.get('/debug/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const records = await getMany(`
      SELECT model_username, fans_count, fans_text, recorded_at
      FROM model_fans_history
      ORDER BY recorded_at DESC
      LIMIT $1
    `, [limit]);
    res.json({
      count: records.length,
      records: records.map(r => ({
        username: r.model_username,
        fans: r.fans_text || r.fans_count,
        recordedAt: r.recorded_at
      }))
    });
  } catch (error) {
    console.error('Debug fans error:', error);
    res.status(500).json({ error: 'Failed to get fans data' });
  }
});

// POST /report — record fans count for a model
router.post('/report', authenticateToken, async (req, res) => {
  try {
    const { username, fansCount, fansText, reportDay } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Model username is required' });
    }
    if (fansCount === undefined && !fansText) {
      return res.status(400).json({ error: 'Fans count or text is required' });
    }

    const cleanUsername = username.trim().toLowerCase().replace('@', '');
    let parsedFansCount = fansCount;
    if (!parsedFansCount && fansText) {
      parsedFansCount = parseFansText(fansText);
    }

    const existing = await getOne(
      'SELECT fans_count FROM model_fans_history WHERE model_username = $1',
      [cleanUsername]
    );
    const historyChanged = !(existing && existing.fans_count === parsedFansCount);

    if (historyChanged) {
      await query(`
        INSERT INTO model_fans_history (model_username, fans_count, fans_text, recorded_by, recorded_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (model_username)
        DO UPDATE SET
          fans_count = EXCLUDED.fans_count,
          fans_text = EXCLUDED.fans_text,
          recorded_by = EXCLUDED.recorded_by,
          recorded_at = NOW()
      `, [cleanUsername, parsedFansCount, fansText || formatFansCount(parsedFansCount), req.user.id]);
    }

    res.json({
      message: historyChanged ? 'Fans recorded successfully' : 'Fans count unchanged (daily trend point will still be updated)',
      recorded: true,
      historyChanged,
      data: {
        username: cleanUsername,
        fansCount: parsedFansCount,
        fansText: fansText || formatFansCount(parsedFansCount)
      }
    });

    try {
      const safeReportDay = (typeof reportDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(reportDay)) ? reportDay : null;
      await query(
        `INSERT INTO model_fans_daily (model_username, day, fans_count, reporters, updated_at)
         VALUES ($1, COALESCE($3::date, CURRENT_DATE), $2, 1, NOW())
         ON CONFLICT (model_username, day)
         DO UPDATE SET fans_count = $2, reporters = model_fans_daily.reporters + 1, updated_at = NOW()`,
        [cleanUsername, parsedFansCount, safeReportDay]
      );
    } catch (trendErr) {
      console.error('Fans trend UPSERT error (non-critical):', trendErr.message);
    }
  } catch (error) {
    console.error('Report fans error:', error);
    res.status(500).json({ error: 'Failed to report fans' });
  }
});

// GET /trend/:username — daily history for sparkline (MUST be before /:username)
router.get('/trend/:username', optionalAuth, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const cleanUsername = req.params.username.trim().toLowerCase().replace('@', '');
    const result = await getMany(
      `SELECT day, fans_count FROM model_fans_daily
       WHERE model_username = $1 AND day >= CURRENT_DATE - $2::integer
       ORDER BY day ASC`,
      [cleanUsername, days]
    );
    const points = result.map(r => ({ d: r.day.toISOString().slice(0, 10), f: r.fans_count }));
    res.json({ username: cleanUsername, points });
  } catch (error) {
    console.error('Get fans trend error:', error);
    res.status(500).json({ error: 'Failed to get fans trend' });
  }
});

// POST /percentile/:username — engagement percentile based on aggregated quality snapshots
router.post('/percentile/:username', optionalAuth, async (req, res) => {
  try {
    const cleanUsername = req.params.username.trim().toLowerCase().replace('@', '');
    const rawScore = Number(req.body?.score);
    const rawOrganicity = Number(req.body?.organicity);
    const rawEngagementRate = Number(req.body?.engagementRate);
    const rawNegativeFlags = Number(req.body?.negativeFlagsCount);
    const avatarUrl = typeof req.body?.avatarUrl === 'string' && req.body.avatarUrl.startsWith('http')
      ? req.body.avatarUrl.slice(0, 500)
      : null;

    // Extended profile signals — all optional, validated/clamped before save.
    const intOrNull = (v, max = 10_000_000) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : null;
    };
    const boolOrNull = (v) => (typeof v === 'boolean' ? v : null);
    const priceOrNull = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100) / 100, 99999) : null;
    };
    const postsCount    = intOrNull(req.body?.postsCount);
    const videosCount   = intOrNull(req.body?.videosCount);
    const photosCount   = intOrNull(req.body?.photosCount);
    const streamsCount  = intOrNull(req.body?.streamsCount);
    const likesCount    = intOrNull(req.body?.likesCount, 1_000_000_000);
    const subscribePrice = priceOrNull(req.body?.subscribePrice);
    const accountMonths = intOrNull(req.body?.accountMonths, 600);
    const fansVisible   = boolOrNull(req.body?.fansVisible);
    const hasSocials    = boolOrNull(req.body?.hasSocials);

    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null;
    const organicity = Number.isFinite(rawOrganicity) ? Math.max(0, Math.min(25, rawOrganicity)) : null;
    const engagementRate = Number.isFinite(rawEngagementRate) ? Math.max(0, rawEngagementRate) : null;
    const negativeFlagsCount = Number.isFinite(rawNegativeFlags) ? Math.max(0, Math.min(50, Math.round(rawNegativeFlags))) : 0;

    if (!cleanUsername || score === null || organicity === null || engagementRate === null) {
      return res.status(400).json({ error: 'username, score, organicity and engagementRate are required' });
    }

    const scoreNorm = score / 100;
    const organicityNorm = organicity / 25;
    const engagementNorm = Math.max(0, Math.min(1, engagementRate / 5));
    const qualityRaw = (scoreNorm * 0.60) + (organicityNorm * 0.25) + (engagementNorm * 0.15) - (negativeFlagsCount * 0.04);
    const qualityScore = Math.max(0.01, Math.min(0.99, qualityRaw));

    await query(
      `INSERT INTO model_quality_snapshots
        (model_username, quality_score, score, organicity, engagement_rate, negative_flags,
         avatar_url, posts_count, videos_count, photos_count, streams_count, likes_count,
         subscribe_price, account_months, fans_visible, has_socials, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
       ON CONFLICT (model_username)
       DO UPDATE SET
         quality_score = EXCLUDED.quality_score,
         score = EXCLUDED.score,
         organicity = EXCLUDED.organicity,
         engagement_rate = EXCLUDED.engagement_rate,
         negative_flags = EXCLUDED.negative_flags,
         avatar_url = COALESCE(EXCLUDED.avatar_url, model_quality_snapshots.avatar_url),
         posts_count = COALESCE(EXCLUDED.posts_count, model_quality_snapshots.posts_count),
         videos_count = COALESCE(EXCLUDED.videos_count, model_quality_snapshots.videos_count),
         photos_count = COALESCE(EXCLUDED.photos_count, model_quality_snapshots.photos_count),
         streams_count = COALESCE(EXCLUDED.streams_count, model_quality_snapshots.streams_count),
         likes_count = COALESCE(EXCLUDED.likes_count, model_quality_snapshots.likes_count),
         subscribe_price = COALESCE(EXCLUDED.subscribe_price, model_quality_snapshots.subscribe_price),
         account_months = COALESCE(EXCLUDED.account_months, model_quality_snapshots.account_months),
         fans_visible = COALESCE(EXCLUDED.fans_visible, model_quality_snapshots.fans_visible),
         has_socials = COALESCE(EXCLUDED.has_socials, model_quality_snapshots.has_socials),
         updated_at = NOW()`,
      [
        cleanUsername, qualityScore, score, organicity, engagementRate, negativeFlagsCount,
        avatarUrl, postsCount, videosCount, photosCount, streamsCount, likesCount,
        subscribePrice, accountMonths, fansVisible, hasSocials
      ]
    );

    const MIN_MODELS_FOR_PERCENTILE = 20;
    const rank = await getOne(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE quality_score > $1 AND model_username <> $2)::int AS better_count,
         COUNT(*) FILTER (WHERE model_username <> $2)::int AS others,
         AVG(engagement_rate)::float AS avg_engagement
       FROM model_quality_snapshots`,
      [qualityScore, cleanUsername]
    );

    const total = Math.max(1, Number(rank?.total || 0));
    const others = Math.max(0, Number(rank?.others || 0));
    const better = Number(rank?.better_count || 0);
    const avgEngagement = Number(rank?.avg_engagement || 0);
    const sufficient = others >= MIN_MODELS_FOR_PERCENTILE;

    let topPercent, betterPercent;
    if (sufficient) {
      const percentileRaw = (better / others) * 100;
      topPercent = Math.max(1, Math.min(99, Math.round(percentileRaw)));
      betterPercent = Math.max(1, Math.min(99, 100 - topPercent));
    } else {
      topPercent = null;
      betterPercent = null;
    }

    res.json({
      username: cleanUsername,
      betterPercent,
      topPercent,
      modelsAnalyzed: total,
      sufficient,
      avgEngagement,
      basis: sufficient ? 'aggregated_db_quality_distribution' : 'insufficient_data'
    });
  } catch (error) {
    console.error('Get engagement percentile error:', error);
    res.status(500).json({ error: 'Failed to get engagement percentile' });
  }
});

// GET /:username — last known fans for a model
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const cleanUsername = req.params.username.trim().toLowerCase().replace('@', '');
    const lastFans = await getOne(`
      SELECT fans_count, fans_text, recorded_at
      FROM model_fans_history
      WHERE model_username = $1
      ORDER BY recorded_at DESC
      LIMIT 1
    `, [cleanUsername]);

    if (!lastFans) {
      return res.json({ username: cleanUsername, found: false, lastFans: null });
    }

    res.json({
      username: cleanUsername,
      found: true,
      lastFans: {
        count: lastFans.fans_count,
        text: lastFans.fans_text,
        recordedAt: lastFans.recorded_at,
        formattedDate: formatDate(lastFans.recorded_at)
      }
    });
  } catch (error) {
    console.error('Get fans error:', error);
    res.status(500).json({ error: 'Failed to get fans data' });
  }
});

// GET /:username/history — full history of fans reports
router.get('/:username/history', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const cleanUsername = req.params.username.trim().toLowerCase().replace('@', '');
    const history = await getMany(`
      SELECT fans_count, fans_text, recorded_at
      FROM model_fans_history
      WHERE model_username = $1
      ORDER BY recorded_at DESC
      LIMIT $2
    `, [cleanUsername, limit]);

    res.json({
      username: cleanUsername,
      history: history.map(h => ({
        count: h.fans_count,
        text: h.fans_text,
        recordedAt: h.recorded_at,
        formattedDate: formatDate(h.recorded_at)
      })),
      count: history.length
    });
  } catch (error) {
    console.error('Get fans history error:', error);
    res.status(500).json({ error: 'Failed to get fans history' });
  }
});

// POST /batch — fans for many models in one call (caps at 50)
router.post('/batch', optionalAuth, async (req, res) => {
  try {
    const { usernames } = req.body;
    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ error: 'Usernames array is required' });
    }
    const limitedUsernames = usernames.slice(0, 50).map(u => u.trim().toLowerCase().replace('@', ''));

    const results = await getMany(`
      SELECT DISTINCT ON (model_username)
        model_username, fans_count, fans_text, recorded_at
      FROM model_fans_history
      WHERE model_username = ANY($1)
      ORDER BY model_username, recorded_at DESC
    `, [limitedUsernames]);

    const fansMap = {};
    results.forEach(r => {
      fansMap[r.model_username] = {
        count: r.fans_count,
        text: r.fans_text,
        recordedAt: r.recorded_at,
        formattedDate: formatDate(r.recorded_at)
      };
    });

    res.json({ fans: fansMap, found: results.length, requested: limitedUsernames.length });
  } catch (error) {
    console.error('Batch get fans error:', error);
    res.status(500).json({ error: 'Failed to get fans data' });
  }
});

// Helpers
function parseFansText(text) {
  if (!text) return null;
  const cleaned = text.toString().trim().toUpperCase();
  if (cleaned.endsWith('K')) return Math.round(parseFloat(cleaned.replace('K', '')) * 1000);
  if (cleaned.endsWith('M')) return Math.round(parseFloat(cleaned.replace('M', '')) * 1000000);
  return parseInt(cleaned.replace(/[^0-9]/g, '')) || null;
}

function formatFansCount(count) {
  if (!count) return null;
  if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return count.toString();
}

function formatDate(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
}

module.exports = router;
