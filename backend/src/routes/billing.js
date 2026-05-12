const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const STATS_EDITOR_API = (process.env.STATS_EDITOR_API_URL || 'https://stats-editor-production.up.railway.app').replace(/\/$/, '') + '/api';

// Thin proxies to Stats Editor: it owns the subscriptions table and the
// NOWPayments integration. Profile Stats only adds 'product=profile_stats'
// where the upstream endpoint understands that filter, and forwards the
// caller's JWT so the user identity stays the same on both sides.

// GET /api/billing/plan — single Profile Stats plan from Stats Editor /plans.
router.get('/plan', authenticateToken, async (req, res) => {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/subscription/plans?product=profile_stats`);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    const plan = (data.plans || []).find(p => p.id === 'profile_stats');
    if (!plan) return res.status(404).json({ error: 'profile_stats plan not configured upstream' });
    res.json({ plan });
  } catch (e) {
    console.error('[billing] /plan failed:', e.message);
    res.status(502).json({ error: 'Stats Editor billing unavailable' });
  }
});

// GET /api/billing/status — subscription status for Profile Stats only.
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/subscription/status?product=profile_stats`, {
      headers: { Authorization: req.headers['authorization'] }
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[billing] /status failed:', e.message);
    res.status(502).json({ error: 'Stats Editor billing unavailable' });
  }
});

// POST /api/billing/create-payment — proxies to Stats Editor with plan=profile_stats.
router.post('/create-payment', authenticateToken, async (req, res) => {
  try {
    const { currency } = req.body || {};
    const r = await fetch(`${STATS_EDITOR_API}/subscription/create-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers['authorization']
      },
      body: JSON.stringify({ plan: 'profile_stats', currency: currency || null })
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[billing] /create-payment failed:', e.message);
    res.status(502).json({ error: 'Stats Editor billing unavailable' });
  }
});

// GET /api/billing/payment-status/:id — proxies through.
router.get('/payment-status/:id', authenticateToken, async (req, res) => {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/subscription/payment-status/${encodeURIComponent(req.params.id)}`, {
      headers: { Authorization: req.headers['authorization'] }
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[billing] /payment-status failed:', e.message);
    res.status(502).json({ error: 'Stats Editor billing unavailable' });
  }
});

// GET /api/billing/crypto-currencies — proxy supported pay currencies.
router.get('/crypto-currencies', async (req, res) => {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/subscription/crypto-currencies`);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[billing] /crypto-currencies failed:', e.message);
    res.status(502).json({ error: 'Stats Editor billing unavailable' });
  }
});

module.exports = router;
