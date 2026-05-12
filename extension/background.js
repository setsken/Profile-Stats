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

// Load token on startup.
chrome.storage.local.get(['authToken'], (r) => {
  if (r.authToken) { authToken = r.authToken; log('PS: token loaded'); }
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

      case 'openSubscriptionTab':
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
        return { success: true };

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
          if (tab) await chrome.sidePanel.open({ tabId: tab.id });
          return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
      }
      case 'clearCache':     clearCache(); return { success: true };

      default:               return { success: false, error: 'Unknown action: ' + request.action };
    }
  } catch (error) {
    logError('PS: handler error', error);
    return { success: false, error: error.message };
  }
}

// Broadcast auth status to all OnlyFans tabs so inject-early can react.
async function broadcastAuthStatus(isAuthenticated) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://onlyfans.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (s) => { localStorage.setItem('ofStatsAuthStatus', s ? 'authenticated' : 'not_authenticated'); },
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

// ==================== ALARMS ====================
chrome.alarms.create('refreshToken', { periodInMinutes: 60 * 24 * 3 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshToken' && authToken) {
    log('PS: periodic token refresh');
    await tryRefreshToken();
  }
});

log('PS: background service worker initialized');
