const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth');
const { requireProfileStatsAccess } = require('../middleware/subscription');

const router = express.Router();

// TEMP diagnostic — exposes JWT_SECRET length + char codes (NOT the value) and
// the exact jwt.verify error for a token passed via ?token=... .
// Remove this once auth is confirmed working end-to-end.
router.get('/jwt-debug', (req, res) => {
  const s = process.env.JWT_SECRET || '';
  const head = s.length ? s.charCodeAt(0) : null;
  const tail = s.length ? s.charCodeAt(s.length - 1) : null;
  const sample = req.query.token;
  let verify = null;
  if (sample) {
    try {
      verify = { ok: true, payload: jwt.verify(sample, s) };
    } catch (e) {
      verify = { ok: false, name: e.name, message: e.message };
    }
  }
  res.json({
    jwt_secret_length: s.length,
    first_char_code: head,
    last_char_code: tail,
    has_trailing_whitespace: /\s$/.test(s),
    has_leading_whitespace: /^\s/.test(s),
    verify
  });
});

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
