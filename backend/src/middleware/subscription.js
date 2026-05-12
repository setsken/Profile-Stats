// Remote subscription check against Stats Editor backend.
// Profile Stats does not store subscriptions itself; the source of truth is Stats Editor.
// Result is cached per-user for 5 minutes to keep latency low and reduce upstream load.

const SUB_CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // userId -> { hasAccess, expiresAt, grantedVia, fetchedAt }

function getCached(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > SUB_CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return entry;
}

function setCached(userId, value) {
  cache.set(userId, { ...value, fetchedAt: Date.now() });
}

function invalidateUser(userId) {
  cache.delete(userId);
}

// Calls Stats Editor /api/subscription/status?product=profile_stats with the
// user's JWT and returns { hasAccess, expiresAt, grantedVia, plan }.
async function fetchProfileStatsAccess(token) {
  const base = process.env.STATS_EDITOR_API_URL;
  if (!base) {
    throw new Error('STATS_EDITOR_API_URL is not configured');
  }
  const url = `${base.replace(/\/$/, '')}/api/subscription/status?product=profile_stats`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (resp.status === 401 || resp.status === 403) {
    return { hasAccess: false, reason: 'auth_rejected' };
  }
  if (!resp.ok) {
    throw new Error(`Stats Editor /status returned ${resp.status}`);
  }

  const data = await resp.json();
  if (!data.hasSubscription || !data.subscription) {
    return { hasAccess: false, reason: 'no_subscription' };
  }
  if (!data.subscription.isActive) {
    return { hasAccess: false, reason: 'inactive', expiresAt: data.subscription.expiresAt };
  }

  return {
    hasAccess: true,
    expiresAt: data.subscription.expiresAt,
    grantedVia: data.grantedVia || null, // 'stats_editor_pro' when Profile Stats is granted by Pro plan
    plan: data.subscription.plan
  };
}

// Express middleware: requires an active Profile Stats subscription (own or granted-by-Pro).
const requireProfileStatsAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let access = getCached(req.user.id);
    if (!access) {
      access = await fetchProfileStatsAccess(req.authToken);
      setCached(req.user.id, access);
    }

    if (!access.hasAccess) {
      return res.status(403).json({
        error: 'Active Profile Stats subscription required',
        code: 'SUBSCRIPTION_REQUIRED',
        reason: access.reason || 'unknown'
      });
    }

    req.subscription = access;
    next();
  } catch (error) {
    console.error('[subscription] remote check failed:', error.message);
    return res.status(502).json({
      error: 'Could not verify subscription with Stats Editor',
      code: 'UPSTREAM_UNAVAILABLE'
    });
  }
};

module.exports = { requireProfileStatsAccess, invalidateUser };
