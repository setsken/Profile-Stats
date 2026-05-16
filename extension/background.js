// Profile Stats — background service worker.
// Routes all backend traffic to two services:
//   STATS_EDITOR_API   — owns users + subscriptions (shared SSO via JWT_SECRET)
//   PROFILE_STATS_API  — owns models / fans / notes / alerts / farmed / AI verdict

const DEBUG = false;
function log(...args) { if (DEBUG) console.log(...args); }
function logError(...args) { if (DEBUG) console.error(...args); }

const STATS_EDITOR_API  = 'https://stats-editor-production.up.railway.app/api';
const PROFILE_STATS_API = 'https://profile-stats-production.up.railway.app/api';

// ==================== TOKEN ====================
let authToken = null;
let isRefreshing = false;
let refreshPromise = null;

async function tryRefreshToken() {
  if (!authToken) return false;
  if (isRefreshing) { try { return await refreshPromise; } catch { return false; } }
  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${STATS_EDITOR_API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          authToken = data.token;
          await chrome.storage.local.set({ authToken: data.token });
          log('PS: token refreshed');
          return true;
        }
      }
      return false;
    } catch (e) {
      logError('PS: token refresh failed', e);
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

setInterval(async () => {
  if (!authToken) return;
  try {
    const payload = JSON.parse(atob(authToken.split('.')[1]));
    const expiresIn = payload.exp * 1000 - Date.now();
    if (expiresIn < 7 * 24 * 60 * 60 * 1000) await tryRefreshToken();
  } catch {}
}, 6 * 60 * 60 * 1000);

// Auth-aware fetch with one-shot refresh on 401.
async function authFetch(url, options = {}) {
  const doFetch = () => {
    const headers = { ...options.headers, 'Authorization': `Bearer ${authToken}` };
    return fetch(url, { ...options, headers });
  };
  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) response = await doFetch();
    if (response.status === 401) await logout();
  }
  return response;
}

// ==================== CACHE ====================
const apiCache = {};
const CACHE_TTL = {
  verifyAuth:             15 * 60 * 1000,
  getSubscriptionStatus:  5 * 60 * 1000,
  getModels:              30 * 60 * 1000,
  getNotes:               10 * 60 * 1000,
  getNoteTags:            10 * 60 * 1000
};
function getCached(key) {
  const entry = apiCache[key];
  if (!entry) return null;
  if (Date.now() - entry.time > (CACHE_TTL[key] || 0)) { delete apiCache[key]; return null; }
  return entry.data;
}
function setCache(key, data) { apiCache[key] = { data, time: Date.now() }; }
function clearCache(key) {
  if (key) delete apiCache[key];
  else Object.keys(apiCache).forEach(k => delete apiCache[k]);
}

// Load token on startup. If we already have one, broadcast 'authenticated'
// to every open OF tab so inject-early.js sees psAuthStatus even when the
// user never opened the popup in this session — otherwise inject-early
// falls back to Stats Editor's shared key and the badge dies when SE
// logs out.
chrome.storage.local.get(['authToken'], (r) => {
  if (r.authToken) {
    authToken = r.authToken;
    log('PS: token loaded');
    broadcastAuthStatus(true).catch(() => {});
  } else {
    // Make absence explicit so we don't leak SE's authenticated flag
    // through the legacy fallback on tabs that had it set previously.
    broadcastAuthStatus(false).catch(() => {});
  }
});

// Re-stamp psAuthStatus on every OF tab navigation. Service workers
// suspend, the user can install PS, log in, close the popup, then go
// browse OF for the first time — without this, inject-early on that
// first page load would never see our key.
chrome.webNavigation && chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!/^https:\/\/(?:www\.)?onlyfans\.com\//.test(details.url || '')) return;
  // Fire-and-forget — auth state may be stale by milliseconds, that's OK
  broadcastAuthStatus(!!authToken).catch(() => {});
}, { url: [{ hostEquals: 'onlyfans.com' }] });

// On install / update, reload every open OF tab so the freshly-installed
// content scripts attach cleanly. Just calling chrome.scripting.executeScript
// produced "Extension context invalidated" errors: the old inject-early
// from the previous extension instance was still alive in the page, the
// page-context fetch interceptor kept firing events into that dead
// context, and the user saw a noisy console + missing badge. A full
// tab reload removes the stale instance, attaches the new content
// scripts via the manifest, and the badge appears on the next load.
chrome.runtime.onInstalled.addListener(async (details) => {
  // Skip if Chrome triggered onInstalled on browser startup (rare) — the
  // event always fires with reason='install' or 'update' / 'chrome_update'.
  // Skip chrome_update — that's the browser updating, not us.
  if (details.reason === 'chrome_update') return;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://onlyfans.com/*' });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try { await chrome.tabs.reload(tab.id, { bypassCache: false }); }
      catch (e) { log('PS: tab reload failed', tab.id, e.message); }
    }
    log('PS: reloaded', tabs.length, 'OF tab(s) after', details.reason);
  } catch (e) {
    log('PS: onInstalled reload failed', e);
  }
});

// ==================== MESSAGE ROUTER ====================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender).then(sendResponse);
  return true;
});

async function handleMessage(request, sender) {
  try {
    switch (request.action) {
      // ---- Auth (Stats Editor backend) ----
      case 'register':            return await apiRegister(request.email, request.password);
      case 'login':               return await apiLogin(request.email, request.password);
      case 'logout':              clearCache(); return await logout();
      case 'setTokenFromSSO':     return await setTokenFromSSO(request.token, request.email);
      case 'verifyAuth': {
        const c = getCached('verifyAuth');
        if (c) return c;
        const r = await apiVerifyAuth();
        if (r.success) setCache('verifyAuth', r);
        return r;
      }
      case 'getAuthStatus':       return await getAuthStatus();
      case 'forgotPassword':      return await apiForgotPassword(request.email);
      case 'resetPassword':       return await apiResetPassword(request.email, request.token, request.newPassword);
      case 'verifyEmail':         return await apiVerifyEmail(request.email, request.code);
      case 'resendVerification':  return await apiResendVerification(request.email);

      // ---- Subscription (Stats Editor backend, with product=profile_stats) ----
      case 'getSubscriptionStatus': {
        const c = getCached('getSubscriptionStatus');
        if (c) return c;
        const r = await apiGetSubscriptionStatus();
        if (r.success) setCache('getSubscriptionStatus', r);
        return r;
      }

      // ---- Models (Profile Stats backend) ----
      case 'getModels': {
        const c = getCached('getModels');
        if (c) return c;
        const r = await apiGetModels();
        if (r.success) setCache('getModels', r);
        return r;
      }
      case 'addModel':    clearCache('getModels'); return await apiAddModel(request.username, request.displayName, request.avatarUrl);
      case 'removeModel': clearCache('getModels'); return await apiRemoveModel(request.username);
      case 'checkModel':                          return await apiCheckModel(request.username);
      case 'getTopModels':                         return await apiGetTopModels(request.limit);
      case 'getLeaderboard':                       return await apiGetLeaderboard(request.params);
      case 'getModelInfo':                         return await apiGetModelInfo(request.username);

      // ---- Farmed Models (Profile Stats backend) ----
      case 'checkFarmedModel':    return await apiCheckFarmedModel(request.username);

      // ---- AI Verdict (Profile Stats backend) ----
      case 'getAIVerdict': {
        const subStatus = await apiGetSubscriptionStatus();
        if (!subStatus.success || !subStatus.subscription || subStatus.subscription.status !== 'active') {
          return { success: false, error: 'Subscription not active' };
        }
        return await apiGetAIVerdict(request.scoreData);
      }

      case 'openSubscriptionTab': {
        // Open the popup as a fixed-size standalone window. Opening it as a
        // regular tab stretched the 380px-wide popup markup across the full
        // viewport with the paywall pinned to the corner — looked broken.
        // We anchor near the current focused window so the new popup lands
        // on the same monitor the user is on.
        const W = 420, H = 720;
        try {
          const cur = await new Promise((resolve) => {
            try { chrome.windows.getCurrent({}, (w) => resolve(w)); }
            catch { resolve(null); }
          }).catch(() => null);
          const baseLeft = cur?.left ?? 0;
          const baseTop  = cur?.top  ?? 0;
          const baseW    = cur?.width  ?? 1280;
          const baseH    = cur?.height ?? 800;
          const left = Math.max(0, Math.round(baseLeft + (baseW - W) / 2));
          const top  = Math.max(0, Math.round(baseTop  + (baseH - H) / 2));
          chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?mode=window'),
            type: 'popup',
            width: W, height: H, left, top, focused: true
          });
        } catch (e) {
          chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?mode=window'),
            type: 'popup', width: W, height: H, focused: true
          });
        }
        return { success: true };
      }

      // ---- Fans (Profile Stats backend) ----
      case 'reportFans':              return await apiReportFans(request.username, request.fansCount, request.fansText, request.reportDay);
      case 'getFans':                 return await apiGetFans(request.username);
      case 'batchGetFans':            return await apiBatchGetFans(request.usernames);
      case 'getFansTrend':            return await apiGetFansTrend(request.username, request.days);
      case 'getEngagementPercentile': return await apiGetEngagementPercentile(request.username, request.metrics);

      // ---- Alerts (Profile Stats backend) ----
      case 'reportAlerts':            return await apiReportAlerts(request.username, request.alerts);
      case 'getAlerts':                return await apiGetAlerts(request.username);

      // ---- Notes (Profile Stats backend) ----
      case 'getNotes': {
        const c = getCached('getNotes');
        if (c) return c;
        const r = await apiGetNotes();
        if (r.success) setCache('getNotes', r);
        return r;
      }
      case 'syncNotes':      clearCache('getNotes'); return await apiSyncNotes(request.notes, request.avatars);
      case 'saveNote':       clearCache('getNotes'); return await apiSaveNote(request.username, request.text, request.tags, request.date, request.avatarUrl);
      case 'deleteNote':     clearCache('getNotes'); return await apiDeleteNote(request.username);
      case 'getNoteTags': {
        const c = getCached('getNoteTags');
        if (c) return c;
        const r = await apiGetNoteTags();
        if (r.success) setCache('getNoteTags', r);
        return r;
      }
      case 'syncNoteTags':   clearCache('getNoteTags'); return await apiSyncNoteTags(request.tags);

      // ---- Side panel ----
      case 'openSidePanel': {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) return { success: false, error: 'No active tab' };
          // Mark the path so the popup script knows it's running inside a side
          // panel and can show the collapse button instead of the expand one.
          await chrome.sidePanel.setOptions({
            tabId: tab.id,
            path: 'popup.html?mode=sidepanel',
            enabled: true
          });
          await chrome.sidePanel.open({ tabId: tab.id });
          return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
      }
      case 'closeSidePanel': {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
            // Disable the side panel for this tab so it shuts; the popup will
            // re-enable it via openSidePanel next time.
            await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
          }
          return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
      }
      case 'clearCache':     clearCache(); return { success: true };

      // ── Billing / promo ───────────────────────────────────────────────
      case 'createPayment':         return await apiCreatePayment(request.currency);
      case 'getPaymentStatus':      return await apiGetPaymentStatus(request.paymentId);
      case 'getCryptoCurrencies':   return await apiGetCryptoCurrencies();
      case 'applyPromoCode':        return await apiApplyPromoCode(request.code);
      case 'sendSupportEmail':      return await apiSendSupportEmail(request.subject, request.message);
      case 'refreshAccess':         return await apiRefreshAccess();

      default:               return { success: false, error: 'Unknown action: ' + request.action };
    }
  } catch (error) {
    logError('PS: handler error', error);
    return { success: false, error: error.message };
  }
}

// Broadcast PS auth status to all OnlyFans tabs so inject-early can react.
// We use our own localStorage key (psAuthStatus) instead of the shared
// ofStatsAuthStatus that Stats Editor manages — otherwise an SE logout
// would wipe the shared key and silently disable the PS badge, even
// though the PS user is still signed in.
async function broadcastAuthStatus(isAuthenticated) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://onlyfans.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (s) => { localStorage.setItem('psAuthStatus', s ? 'authenticated' : 'not_authenticated'); },
          args: [isAuthenticated]
        });
      } catch {}
    }
  } catch (e) { log('PS: broadcast failed', e); }
}

// ==================== AUTH API (Stats Editor) ====================
async function apiRegister(email, password) {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await r.json();
    if (r.ok) {
      if (data.requiresVerification) return { success: true, requiresVerification: true, email: data.email };
      if (data.token) {
        authToken = data.token;
        await chrome.storage.local.set({ authToken: data.token, userEmail: data.user.email });
        await broadcastAuthStatus(true);
        return { success: true, user: data.user, subscription: data.subscription };
      }
    }
    return { success: false, error: data.error || 'Registration failed' };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiLogin(email, password) {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await r.json();
    if (r.ok && data.token) {
      authToken = data.token;
      await chrome.storage.local.set({ authToken: data.token, userEmail: data.user.email });
      await broadcastAuthStatus(true);
      return { success: true, user: data.user, subscription: data.subscription };
    }
    return { success: false, error: data.error || 'Login failed' };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function logout() {
  authToken = null;
  await chrome.storage.local.remove(['authToken', 'userEmail']);
  await broadcastAuthStatus(false);
  return { success: true };
}

// Wires an SSO-borrowed token through the same code path a normal apiLogin
// would take, so content scripts (badge, fans trend, verdict, etc.) start
// using it immediately without a tab reload.
async function setTokenFromSSO(token, email) {
  if (!token) return { success: false, error: 'Missing token' };
  authToken = token;
  await chrome.storage.local.set({ authToken: token, userEmail: email || null });
  clearCache();
  await broadcastAuthStatus(true);
  return { success: true };
}

async function apiVerifyAuth() {
  if (!authToken) { await broadcastAuthStatus(false); return { success: false, error: 'Not authenticated', code: 'NO_TOKEN' }; }
  try {
    const r = await authFetch(`${STATS_EDITOR_API}/auth/verify`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    if (r.ok) { await broadcastAuthStatus(true); return { success: true, user: data.user, subscription: data.subscription, usage: data.usage }; }
    return { success: false, error: data.error };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function getAuthStatus() {
  try {
    const r = await chrome.storage.local.get(['authToken', 'userEmail']);
    if (r.authToken) authToken = r.authToken;
    return { success: true, isAuthenticated: !!r.authToken, email: r.userEmail || null };
  } catch (e) { logError(e); return { success: true, isAuthenticated: false, email: null }; }
}

async function apiForgotPassword(email) {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/auth/forgot-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await r.json();
    return { success: true, message: data.message };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiResetPassword(email, token, newPassword) {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, newPassword })
    });
    const data = await r.json();
    if (r.ok) return { success: true, message: data.message };
    return { success: false, error: data.error || 'Failed to reset password' };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiVerifyEmail(email, code) {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/auth/verify-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await r.json();
    if (r.ok && data.token) {
      authToken = data.token;
      await chrome.storage.local.set({ authToken: data.token, userEmail: data.user.email });
      await broadcastAuthStatus(true);
      return { success: true, user: data.user, subscription: data.subscription };
    }
    return { success: false, error: data.error || 'Verification failed' };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiResendVerification(email) {
  try {
    const r = await fetch(`${STATS_EDITOR_API}/auth/resend-verification`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await r.json();
    return { success: r.ok, message: data.message };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== SUBSCRIPTION (Stats Editor, ?product=profile_stats) ====================
async function apiGetSubscriptionStatus() {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${STATS_EDITOR_API}/subscription/status?product=profile_stats`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== MODELS (Profile Stats) ====================
async function apiGetModels() {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/models`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    if (r.status === 403) { const d = await r.json(); return { success: false, error: d.error, code: d.code }; }
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiAddModel(username, displayName = null, avatarUrl = null) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/models/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, avatarUrl })
    });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiRemoveModel(username) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/models/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetTopModels(limit = 100) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/models/top?limit=${limit}`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetLeaderboard(params = {}) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const r = await authFetch(`${PROFILE_STATS_API}/models/leaderboard?${qs.toString()}`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetModelInfo(username) {
  try {
    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const r = await fetch(`${PROFILE_STATS_API}/models/info/${encodeURIComponent(username)}`, { headers });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiCheckModel(username) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/models/check/${encodeURIComponent(username)}`);
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== FARMED MODELS (Profile Stats) ====================
async function apiCheckFarmedModel(username) {
  try {
    const r = await fetch(`${PROFILE_STATS_API}/farmed-models/${encodeURIComponent(username)}`);
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== AI VERDICT (Profile Stats) ====================
async function apiGetAIVerdict(scoreData) {
  try {
    const lang = scoreData.lang || 'ru';
    const isRu = lang === 'ru';
    let fansDesc;
    if (scoreData.fansVisible && scoreData.fans > 0) {
      fansDesc = scoreData.fans + (isRu ? ' (ОТКРЫТЫ, видны всем)' : ' (PUBLIC, visible to all)');
    } else if (!scoreData.fansVisible && scoreData.lastKnownFans) {
      fansDesc = (isRu ? 'СКРЫТЫ модельёю. Последние известные: ' : 'HIDDEN by model. Last known: ') + scoreData.lastKnownFans;
    } else if (!scoreData.fansVisible) {
      fansDesc = isRu ? 'СКРЫТЫ модельёю, данных нет' : 'HIDDEN by model, no data';
    } else {
      fansDesc = '0';
    }

    const prompt = isRu
      ? `Профиль @${scoreData.username}:
Score: ${scoreData.score}/100 (${scoreData.grade})
Компоненты: MAT ${scoreData.components.maturity}/25, POP ${scoreData.components.popularity}/25, ORG ${scoreData.components.organicity}/25, ACT ${scoreData.components.activity}/15, TRS ${scoreData.components.transparency}/10
Фаны: ${fansDesc}
Лайки: ${scoreData.likes}, Посты: ${scoreData.posts}, Видео: ${scoreData.videos}, Стримы: ${scoreData.streams}
Возраст: ${scoreData.accountMonths} мес.${scoreData.price > 0 ? ' Подписка: ПЛАТНАЯ $' + scoreData.price + '/мес' + (scoreData.fansVisible && scoreData.fans > 0 ? ' (доход ~$' + Math.round(scoreData.price * scoreData.fans) + '/мес)' : '') : ' Подписка: FREE (бесплатная, дохода от подписки НЕТ)'}
Комментарии: ${scoreData.commentsOpen ? 'ОТКРЫТЫ' : scoreData.commentsClosed ? 'ЗАКРЫТЫ' : 'неизвестно'}
Флаги: ${scoreData.flags.join(', ') || 'нет'}`
      : `Profile @${scoreData.username}:
Score: ${scoreData.score}/100 (${scoreData.grade})
Components: MAT ${scoreData.components.maturity}/25, POP ${scoreData.components.popularity}/25, ORG ${scoreData.components.organicity}/25, ACT ${scoreData.components.activity}/15, TRS ${scoreData.components.transparency}/10
Fans: ${fansDesc}
Likes: ${scoreData.likes}, Posts: ${scoreData.posts}, Videos: ${scoreData.videos}, Streams: ${scoreData.streams}
Account age: ${scoreData.accountMonths} months${scoreData.price > 0 ? ' Subscription: PAID $' + scoreData.price + '/mo' + (scoreData.fansVisible && scoreData.fans > 0 ? ' (revenue ~$' + Math.round(scoreData.price * scoreData.fans) + '/mo)' : '') : ' Subscription: FREE (no subscription revenue)'}
Comments: ${scoreData.commentsOpen ? 'OPEN' : scoreData.commentsClosed ? 'CLOSED' : 'unknown'}
Flags: ${scoreData.flags.join(', ') || 'none'}`;

    const r = await authFetch(`${PROFILE_STATS_API}/verdict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, lang: isRu ? 'ru' : 'en' })
    });
    if (!r.ok) { logError('PS: verdict status', r.status); return { verdict: null }; }
    const data = await r.json();
    return { verdict: data.verdict || null };
  } catch (e) { logError('PS: verdict', e); return { verdict: null }; }
}

// ==================== FANS (Profile Stats) ====================
async function apiReportFans(username, fansCount, fansText, reportDay) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/fans/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, fansCount, fansText, reportDay })
    });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetFans(username) {
  try {
    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const r = await fetch(`${PROFILE_STATS_API}/fans/${encodeURIComponent(username)}`, { headers });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiBatchGetFans(usernames) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const r = await fetch(`${PROFILE_STATS_API}/fans/batch`, {
      method: 'POST', headers, body: JSON.stringify({ usernames })
    });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetFansTrend(username, days) {
  try {
    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const r = await fetch(`${PROFILE_STATS_API}/fans/trend/${encodeURIComponent(username)}?days=${days || 90}`, { headers });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetEngagementPercentile(username, metrics) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const r = await fetch(`${PROFILE_STATS_API}/fans/percentile/${encodeURIComponent(username)}`, {
      method: 'POST', headers, body: JSON.stringify(metrics || {})
    });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== ALERTS (Profile Stats) ====================
async function apiReportAlerts(username, alerts) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const r = await fetch(`${PROFILE_STATS_API}/alerts/report`, {
      method: 'POST', headers, body: JSON.stringify({ username, alerts })
    });
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetAlerts(username) {
  try {
    const r = await fetch(`${PROFILE_STATS_API}/alerts/${encodeURIComponent(username)}`);
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== NOTES (Profile Stats) ====================
async function apiGetNotes() {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/notes`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiSyncNotes(notes, avatars) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/notes/sync`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, avatars })
    });
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiSaveNote(username, text, tags, date, avatarUrl) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/notes/${encodeURIComponent(username)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tags, date, avatarUrl })
    });
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiDeleteNote(username) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/notes/${encodeURIComponent(username)}`, { method: 'DELETE' });
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetNoteTags() {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/notes/tags`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiSyncNoteTags(tags) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/notes/tags`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== BILLING (Profile Stats) ====================
// All routes proxy to Stats Editor through /api/billing/* — see backend
// billing.js. The popup never talks to NOWPayments directly.

async function apiCreatePayment(currency) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/billing/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: currency || null })
    });
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok && data.success !== false, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetPaymentStatus(paymentId) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/billing/payment-status/${encodeURIComponent(paymentId)}`);
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiGetCryptoCurrencies() {
  try {
    const r = await fetch(`${PROFILE_STATS_API}/billing/crypto-currencies`);
    const data = await r.json();
    return { success: r.ok, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiRefreshAccess() {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/billing/refresh-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    clearCache(); // also drop our local sub status cache
    return { success: r.ok };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiSendSupportEmail(subject, message) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  if (!message || String(message).trim().length < 10) {
    return { success: false, error: 'Message is too short' };
  }
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/billing/support`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, message })
    });
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    return { success: r.ok && data.success !== false, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

async function apiApplyPromoCode(code) {
  if (!authToken) return { success: false, error: 'Not authenticated' };
  if (!code || !code.trim()) return { success: false, error: 'Promo code is required', code: 'INVALID_CODE' };
  try {
    const r = await authFetch(`${PROFILE_STATS_API}/billing/apply-promo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase() })
    });
    if (r.status === 401) return { success: false, error: 'Session expired', code: 'TOKEN_EXPIRED' };
    const data = await r.json();
    // Drop our cached subscription so the next /health/check-access reflects reality
    clearCache();
    return { success: r.ok && data.success !== false, ...data };
  } catch (e) { logError(e); return { success: false, error: 'Network error' }; }
}

// ==================== ALARMS ====================
chrome.alarms.create('refreshToken', { periodInMinutes: 60 * 24 * 3 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshToken' && authToken) {
    log('PS: periodic token refresh');
    await tryRefreshToken();
  }
});

log('PS: background service worker initialized');
