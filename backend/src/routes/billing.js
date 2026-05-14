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

// POST /api/billing/apply-promo — redeem a promo code against the Profile
// Stats subscription. The upstream /api/promo/apply route reads the product
// off the promo code itself, so a code minted as product='profile_stats'
// updates the right subscription row even though we proxy through the
// Stats Editor backend.
router.post('/apply-promo', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Promo code is required', code: 'INVALID_CODE' });

    const r = await fetch(`${STATS_EDITOR_API}/promo/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers['authorization']
      },
      body: JSON.stringify({ code })
    });
    const data = await r.json();

    // Defence in depth: refuse to grant access if the code belongs to a
    // different product. The upstream route already gates this for
    // profile_stats codes (they target product='profile_stats' rows), but
    // some legacy stats_editor-only codes may exist and we don't want them
    // accidentally extending Profile Stats.
    if (r.ok && data.subscription && data.subscription.product
        && data.subscription.product !== 'profile_stats') {
      return res.status(400).json({
        error: 'This code is not valid for Profile Stats',
        code: 'WRONG_PRODUCT'
      });
    }

    res.status(r.status).json(data);
  } catch (e) {
    console.error('[billing] /apply-promo failed:', e.message);
    res.status(502).json({ error: 'Stats Editor billing unavailable' });
  }
});

// POST /api/billing/support — proxy a bug report / question to the
// Stats Editor /auth/support endpoint with product='profile_stats' so the
// shared mailer tags it correctly.
router.post('/support', authenticateToken, async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!message || String(message).trim().length < 10) {
      return res.status(400).json({ error: 'Message is too short' });
    }
    const r = await fetch(`${STATS_EDITOR_API}/auth/support`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers['authorization']
      },
      body: JSON.stringify({ subject, message, product: 'profile_stats' })
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[billing] /support failed:', e.message);
    res.status(502).json({ error: 'Support service unavailable' });
  }
});

module.exports = router;
