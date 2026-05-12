const express = require('express');
const { query, pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

// ==================== TAGS ====================

// GET /tags — list user's tags
router.get('/tags', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, color_index FROM user_tags WHERE user_id = $1 ORDER BY created_at ASC',
      [req.user.id]
    );
    res.json({
      success: true,
      tags: result.rows.map(r => ({ id: r.id, name: r.name, ci: r.color_index }))
    });
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to load tags' });
  }
});

// PUT /tags — replace all of user's tags
router.put('/tags', async (req, res) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' });
    }
    if (tags.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 tags allowed' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT id, name FROM user_tags WHERE user_id = $1',
        [req.user.id]
      );
      const existingMap = new Map(existing.rows.map(r => [r.id, r.name]));

      const incomingIds = new Set();
      for (const tag of tags) {
        if (typeof tag.id === 'number' && existingMap.has(tag.id)) {
          incomingIds.add(tag.id);
        }
      }

      for (const [existId] of existingMap) {
        if (!incomingIds.has(existId)) {
          await client.query('DELETE FROM user_tags WHERE id = $1 AND user_id = $2', [existId, req.user.id]);
        }
      }

      const idMap = {};
      for (const tag of tags) {
        if (!tag.name || typeof tag.name !== 'string') continue;
        const name = tag.name.trim().substring(0, 50);
        const ci = typeof tag.ci === 'number' ? tag.ci : 0;

        if (typeof tag.id === 'number' && existingMap.has(tag.id)) {
          await client.query(
            'UPDATE user_tags SET name = $1, color_index = $2 WHERE id = $3 AND user_id = $4',
            [name, ci, tag.id, req.user.id]
          );
          idMap[tag.id] = tag.id;
        } else {
          const inserted = await client.query(
            'INSERT INTO user_tags (user_id, name, color_index) VALUES ($1, $2, $3) RETURNING id',
            [req.user.id, name, ci]
          );
          idMap[tag.id !== undefined ? tag.id : ('new_' + name)] = inserted.rows[0].id;
        }
      }

      await client.query('COMMIT');

      const updated = await query(
        'SELECT id, name, color_index FROM user_tags WHERE user_id = $1 ORDER BY created_at ASC',
        [req.user.id]
      );
      res.json({
        success: true,
        tags: updated.rows.map(r => ({ id: r.id, name: r.name, ci: r.color_index })),
        idMap
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Sync tags error:', error);
    res.status(500).json({ error: 'Failed to sync tags' });
  }
});

// ==================== NOTES ====================

// GET / — all user's notes (keyed by model_username)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT model_username, note_text, tags, note_date, avatar_url
       FROM user_notes
       WHERE user_id = $1
       ORDER BY note_date DESC`,
      [req.user.id]
    );

    const notes = {};
    const avatars = {};
    for (const row of result.rows) {
      notes[row.model_username] = {
        text: row.note_text || '',
        tags: row.tags || [],
        date: row.note_date ? new Date(row.note_date).getTime() : 0
      };
      if (row.avatar_url) avatars[row.model_username] = row.avatar_url;
    }
    res.json({ success: true, notes, avatars });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

// PUT /sync — full sync (replace) of user's notes
router.put('/sync', async (req, res) => {
  try {
    const { notes, avatars } = req.body;
    if (!notes || typeof notes !== 'object') {
      return res.status(400).json({ error: 'Invalid notes data' });
    }
    const usernames = Object.keys(notes);
    if (usernames.length > 500) {
      return res.status(400).json({ error: 'Too many notes (max 500)' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT model_username FROM user_notes WHERE user_id = $1',
        [req.user.id]
      );
      const existingSet = new Set(existing.rows.map(r => r.model_username));
      const newSet = new Set(usernames);

      for (const u of existingSet) {
        if (!newSet.has(u)) {
          await client.query(
            'DELETE FROM user_notes WHERE user_id = $1 AND model_username = $2',
            [req.user.id, u]
          );
        }
      }

      for (const [username, note] of Object.entries(notes)) {
        if (!username) continue;
        const text = (note.text || '').substring(0, 5000);
        const tags = Array.isArray(note.tags) ? note.tags : [];
        const noteDate = note.date ? new Date(note.date) : new Date();
        const avatarUrl = (avatars && avatars[username]) ? avatars[username].substring(0, 500) : null;

        await client.query(
          `INSERT INTO user_notes (user_id, model_username, note_text, tags, note_date, avatar_url, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (user_id, model_username)
           DO UPDATE SET note_text = $3, tags = $4, note_date = $5, avatar_url = COALESCE($6, user_notes.avatar_url), updated_at = NOW()`,
          [req.user.id, username, text, JSON.stringify(tags), noteDate, avatarUrl]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true, count: usernames.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Sync notes error:', error);
    res.status(500).json({ error: 'Failed to sync notes' });
  }
});

// PUT /:username — save or update a single note
router.put('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { text, tags, date, avatarUrl } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username' });

    const noteText = (text || '').substring(0, 5000);
    const noteTags = Array.isArray(tags) ? tags : [];
    const noteDate = date ? new Date(date) : new Date();
    const avatar = avatarUrl ? avatarUrl.substring(0, 500) : null;

    await query(
      `INSERT INTO user_notes (user_id, model_username, note_text, tags, note_date, avatar_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, model_username)
       DO UPDATE SET note_text = $3, tags = $4, note_date = $5, avatar_url = COALESCE($6, user_notes.avatar_url), updated_at = NOW()`,
      [req.user.id, username, noteText, JSON.stringify(noteTags), noteDate, avatar]
    );
    res.json({ success: true, message: 'Note saved' });
  } catch (error) {
    console.error('Save note error:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// DELETE /:username — delete note for a model
router.delete('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) return res.status(400).json({ error: 'Missing username' });
    await query(
      'DELETE FROM user_notes WHERE user_id = $1 AND model_username = $2',
      [req.user.id, username]
    );
    res.json({ success: true, message: 'Note deleted' });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

module.exports = router;
