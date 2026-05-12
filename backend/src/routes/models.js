const express = require('express');
const { query, getOne, getMany } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// NOTE: Subscription/model-limit gating is intentionally omitted in this phase.
// It will be re-introduced in the Profile Stats billing step (Etap 6), once the
// product owns its own subscription source of truth. Until then, the Stats
// Editor backend keeps enforcing limits for the legacy combined extension.

// GET / — list user's models (excludes soft-deleted)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const models = await getMany(`
      SELECT
        um.id,
        um.model_username,
        um.display_name,
        um.created_at,
        (
          SELECT json_build_object(
            'fans_count', mfh.fans_count,
            'fans_text', mfh.fans_text,
            'recorded_at', mfh.recorded_at
          )
          FROM model_fans_history mfh
          WHERE mfh.model_username = um.model_username
          ORDER BY mfh.recorded_at DESC
          LIMIT 1
        ) as last_fans
      FROM user_models um
      WHERE um.user_id = $1 AND (um.is_deleted = false OR um.is_deleted IS NULL)
      ORDER BY um.created_at DESC
    `, [req.user.id]);

    res.json({
      models: models.map(m => ({
        id: m.id,
        username: m.model_username,
        displayName: m.display_name,
        createdAt: m.created_at,
        lastFans: m.last_fans
      })),
      count: models.length
    });
  } catch (error) {
    console.error('Get models error:', error);
    res.status(500).json({ error: 'Failed to get models' });
  }
});

// POST /add — add a model (or restore a previously soft-deleted one)
router.post('/add', authenticateToken, async (req, res) => {
  try {
    const { username, displayName } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Model username is required' });
    }

    const cleanUsername = username.trim().toLowerCase().replace('@', '');

    const existingModel = await getOne(
      'SELECT id, is_deleted, created_at FROM user_models WHERE user_id = $1 AND model_username = $2',
      [req.user.id, cleanUsername]
    );

    if (existingModel) {
      if (existingModel.is_deleted) {
        await query(
          'UPDATE user_models SET is_deleted = false, deleted_at = NULL, display_name = COALESCE($2, display_name) WHERE id = $1',
          [existingModel.id, displayName]
        );
        return res.status(200).json({
          success: true,
          message: 'Model restored successfully',
          restored: true,
          model: {
            id: existingModel.id,
            username: cleanUsername,
            displayName,
            createdAt: existingModel.created_at
          }
        });
      }
      return res.status(409).json({ error: 'Model already added', code: 'MODEL_EXISTS' });
    }

    const result = await query(`
      INSERT INTO user_models (user_id, model_username, display_name, is_deleted)
      VALUES ($1, $2, $3, false)
      RETURNING id, model_username, display_name, created_at
    `, [req.user.id, cleanUsername, displayName || null]);

    const model = result.rows[0];
    res.status(201).json({
      success: true,
      message: 'Model added successfully',
      model: {
        id: model.id,
        username: model.model_username,
        displayName: model.display_name,
        createdAt: model.created_at
      }
    });
  } catch (error) {
    console.error('Add model error:', error);
    res.status(500).json({ error: 'Failed to add model' });
  }
});

// DELETE /:username — soft delete
router.delete('/:username', authenticateToken, async (req, res) => {
  try {
    const cleanUsername = req.params.username.trim().toLowerCase().replace('@', '');
    const result = await query(
      `UPDATE user_models
       SET is_deleted = true, deleted_at = NOW()
       WHERE user_id = $1 AND model_username = $2 AND (is_deleted = false OR is_deleted IS NULL)
       RETURNING id`,
      [req.user.id, cleanUsername]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Model not found' });
    }
    res.json({ message: 'Model removed successfully' });
  } catch (error) {
    console.error('Remove model error:', error);
    res.status(500).json({ error: 'Failed to remove model' });
  }
});

// GET /leaderboard — full model database, paginated and filterable.
// Query params:
//   offset, limit (max 200)
//   search    — substring of model_username (case-insensitive)
//   sort      — 'score' | 'fans' | 'quality' | 'recent' (default 'score')
//   minScore, maxScore  (0..100)
//   minQuality (0..1, e.g. 0.85)
//   minFans   — minimum last-known fan count
router.get('/leaderboard', authenticateToken, async (req, res) => {
  try {
    const offset    = Math.max(0, parseInt(req.query.offset) || 0);
    const limit     = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const search    = (typeof req.query.search === 'string' && req.query.search.trim()) ? req.query.search.trim() : null;
    const sort      = ['score', 'fans', 'quality', 'recent'].includes(req.query.sort) ? req.query.sort : 'score';
    const minScore  = Math.max(0, Math.min(100, Number(req.query.minScore) || 0));
    const maxScore  = Math.max(0, Math.min(100, Number(req.query.maxScore) || 100));
    const minQuality = Math.max(0, Math.min(1, Number(req.query.minQuality) || 0));
    const minFans   = Math.max(0, parseInt(req.query.minFans) || 0);

    const params = [];
    const where = [];
    where.push(`ms.score BETWEEN $${params.length + 1} AND $${params.length + 2}`);
    params.push(minScore, maxScore);
    if (minQuality > 0) {
      params.push(minQuality);
      where.push(`ms.quality_score >= $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`ms.model_username ILIKE $${params.length}`);
    }

    // Inner select pulls the last fan count per model so we can both filter
    // and sort on it without repeating the correlated subquery everywhere.
    let havingClause = '';
    if (minFans > 0) {
      params.push(minFans);
      havingClause = `WHERE last_fans >= $${params.length}`;
    }

    // Sort key drives BOTH the leaderboard ordering and the global rank,
    // so users can search a single model and still see its true position.
    // After unwrapping into a CTE all the helper columns (last_fans etc.) are
    // plain names — drop the ms. prefix from every order/where expression.
    const orderBy = sort === 'fans'    ? 'last_fans DESC NULLS LAST, score DESC'
                  : sort === 'quality' ? 'quality_score DESC, score DESC'
                  : sort === 'recent'  ? 'updated_at DESC, score DESC'
                  :                      'score DESC, quality_score DESC';

    params.push(limit, offset);
    const limitParamIdx = params.length - 1;
    const offsetParamIdx = params.length;

    const filterWhere = where.join(' AND ').replace(/\bms\./g, '');

    const sql = `
      WITH base AS (
        SELECT
          ms.model_username,
          ms.score,
          ms.quality_score,
          ms.organicity,
          ms.engagement_rate,
          ms.updated_at,
          (
            SELECT mfh.fans_count
            FROM model_fans_history mfh
            WHERE mfh.model_username = ms.model_username
            ORDER BY mfh.recorded_at DESC LIMIT 1
          ) AS last_fans,
          (
            SELECT mfh.fans_text
            FROM model_fans_history mfh
            WHERE mfh.model_username = ms.model_username
            ORDER BY mfh.recorded_at DESC LIMIT 1
          ) AS last_fans_text,
          (
            SELECT un.avatar_url
            FROM user_notes un
            WHERE un.model_username = ms.model_username AND un.avatar_url IS NOT NULL
            LIMIT 1
          ) AS avatar_url
        FROM model_quality_snapshots ms
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS global_rank
        FROM base
      ),
      filtered AS (
        SELECT * FROM ranked
        WHERE ${filterWhere}
        ${havingClause}
      )
      SELECT *, COUNT(*) OVER() AS total_count
      FROM filtered
      ORDER BY ${orderBy}
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `;

    const result = await query(sql, params);
    const rows = result.rows;
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

    res.json({
      total,
      offset,
      limit,
      sort,
      models: rows.map(r => ({
        username: r.model_username,
        score: Number(r.score),
        qualityScore: Number(r.quality_score),
        organicity: Number(r.organicity),
        engagementRate: Number(r.engagement_rate),
        fansCount: r.last_fans,
        fansText: r.last_fans_text,
        avatarUrl: r.avatar_url,
        updatedAt: r.updated_at,
        globalRank: Number(r.global_rank)
      }))
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// GET /top — leaderboard of models by aggregated quality_score.
// Joins last known fan count and the best available avatar (taken from any
// user_notes row that ever stored one).
router.get('/top', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 100);
    const rows = await getMany(`
      SELECT
        ms.model_username,
        ms.quality_score,
        ms.score,
        ms.organicity,
        ms.engagement_rate,
        ms.updated_at,
        (
          SELECT mfh.fans_count
          FROM model_fans_history mfh
          WHERE mfh.model_username = ms.model_username
          ORDER BY mfh.recorded_at DESC
          LIMIT 1
        ) AS fans_count,
        (
          SELECT mfh.fans_text
          FROM model_fans_history mfh
          WHERE mfh.model_username = ms.model_username
          ORDER BY mfh.recorded_at DESC
          LIMIT 1
        ) AS fans_text,
        (
          SELECT un.avatar_url
          FROM user_notes un
          WHERE un.model_username = ms.model_username AND un.avatar_url IS NOT NULL
          LIMIT 1
        ) AS avatar_url
      FROM model_quality_snapshots ms
      ORDER BY ms.score DESC, ms.quality_score DESC, ms.updated_at DESC
      LIMIT $1
    `, [limit]);

    res.json({
      count: rows.length,
      models: rows.map(r => ({
        username: r.model_username,
        score: Number(r.score),
        qualityScore: Number(r.quality_score),
        organicity: Number(r.organicity),
        engagementRate: Number(r.engagement_rate),
        fansCount: r.fans_count,
        fansText: r.fans_text,
        avatarUrl: r.avatar_url,
        updatedAt: r.updated_at
      }))
    });
  } catch (error) {
    console.error('Get top models error:', error);
    res.status(500).json({ error: 'Failed to get top models' });
  }
});

// GET /check/:username — check whether model is in user's list
router.get('/check/:username', authenticateToken, async (req, res) => {
  try {
    const cleanUsername = req.params.username.trim().toLowerCase().replace('@', '');
    const model = await getOne(
      'SELECT id FROM user_models WHERE user_id = $1 AND model_username = $2 AND (is_deleted = false OR is_deleted IS NULL)',
      [req.user.id, cleanUsername]
    );
    res.json({ username: cleanUsername, isAdded: !!model, modelId: model?.id || null });
  } catch (error) {
    console.error('Check model error:', error);
    res.status(500).json({ error: 'Failed to check model' });
  }
});

module.exports = router;
