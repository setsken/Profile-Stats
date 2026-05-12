const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { requireProfileStatsAccess } = require('../middleware/subscription');

const router = express.Router();

// Public: simple liveness probe (no auth)
router.get('/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Auth-only: verifies JWT works and surfaces userId from token payload.
router.get('/whoami', authenticateToken, (req, res) => {
  res.json({
    ok: true,
    user: { id: req.user.id, email: req.user.email }
  });
});

// Auth + subscription: end-to-end check that JWT + remote sub gating work.
router.get('/check-access', authenticateToken, requireProfileStatsAccess, (req, res) => {
  res.json({
    ok: true,
    user: { id: req.user.id, email: req.user.email },
    subscription: req.subscription
  });
});

module.exports = router;
