// Profile Stats popup.
// All API calls go through background.js so the service worker keeps the
// in-memory token + cache hot for content scripts and the side panel.

const PROFILE_STATS_API = 'https://profile-stats-production.up.railway.app/api';
const STATS_EDITOR_EXTENSION_ID = 'mflgdblgjakdfkjnfdkfmmobgppgjgom';

const screens = {
  login:        document.getElementById('loginScreen'),
  register:     document.getElementById('registerScreen'),
  forgot:       document.getElementById('forgotScreen'),
  main:         document.getElementById('mainScreen'),
  subscription: document.getElementById('subscriptionScreen'),
  settings:     document.getElementById('settingsScreen'),
  support:      document.getElementById('supportScreen'),
  payment:      document.getElementById('paymentScreen')
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) {
    el.style.display = k === name ? 'flex' : 'none';
  }
  closeDropdown();
}

function setError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg || '';
  el.classList.toggle('visible', Boolean(msg));
}

function setSuccess(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg || '';
  el.classList.toggle('visible', Boolean(msg));
}

function setLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  const t = btn.querySelector('.btn-text');
  const l = btn.querySelector('.btn-loader');
  if (t) t.style.display = on ? 'none' : 'inline';
  if (l) l.style.display = on ? 'inline-block' : 'none';
}

function send(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
      else resolve(resp || { success: false, error: 'Empty response' });
    });
  });
}

// ============ Auth flows ============
async function doLogin(email, password) {
  setError('loginError', '');
  setLoading('loginBtn', true);
  try {
    const r = await send('login', { email, password });
    if (!r.success) { setError('loginError', r.error || 'Login failed'); return; }
    await enterMainScreen(r.user);
  } finally { setLoading('loginBtn', false); }
}

async function doRegister(email, password) {
  setError('registerError', '');
  setLoading('registerBtn', true);
  try {
    const r = await send('register', { email, password });
    if (!r.success) { setError('registerError', r.error || 'Registration failed'); return; }
    if (r.requiresVerification) {
      setError('registerError', 'Account created. Check your email then sign in.');
      show('login'); return;
    }
    await enterMainScreen(r.user);
  } finally { setLoading('registerBtn', false); }
}

async function doForgot(email) {
  setError('forgotError', ''); setSuccess('forgotSuccess', '');
  setLoading('forgotBtn', true);
  try {
    const r = await send('forgotPassword', { email });
    if (!r.success) { setError('forgotError', r.error || 'Failed to send reset code'); return; }
    setSuccess('forgotSuccess', r.message || 'Reset code sent. Check your email.');
  } finally { setLoading('forgotBtn', false); }
}

async function doLogout() { await send('logout'); show('login'); }

async function doSSO() {
  setError('loginError', '');
  setLoading('loginBtn', true);
  try {
    const resp = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(STATS_EDITOR_EXTENSION_ID, { action: 'getStatsEditorToken' }, (r) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(r || { success: false, error: 'Empty response' });
        });
      } catch (e) { resolve({ success: false, error: e.message }); }
    });
    if (!resp.success) {
      const msg = resp.code === 'NOT_AUTHENTICATED'
        ? 'Sign in to Stats Editor first, then click this button again.'
        : (resp.error && resp.error.includes('Could not establish connection'))
          ? 'Stats Editor extension is not installed or disabled.'
          : (resp.error || 'SSO failed');
      setError('loginError', msg);
      return;
    }
    const stored = await send('setTokenFromSSO', { token: resp.token, email: resp.email });
    if (!stored.success) { setError('loginError', stored.error || 'Failed to store token'); return; }
    await enterMainScreen({ email: resp.email });
  } finally { setLoading('loginBtn', false); }
}

// ============ Main screen ============
let currentSubscription = null;

async function enterMainScreen(user) {
  const email = user?.email || (await send('getAuthStatus')).email || '';
  document.getElementById('userMenuEmail').textContent = email;

  // Load subscription status to decide subtitle + access state
  const { authToken } = await chrome.storage.local.get('authToken');
  try {
    const r = await fetch(`${PROFILE_STATS_API}/health/check-access`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (r.status === 401) { await doLogout(); return; }
    const data = await r.json();
    currentSubscription = data.subscription || null;
  } catch { currentSubscription = null; }

  applySubscriptionHeader();
  await loadPluginEnabled();
  show('main');
  loadTopTab(); // first tab is Top by default
}

function applySubscriptionHeader() {
  const sub = currentSubscription || {};
  const subtitle = document.getElementById('logoSubtitle');
  const plan = document.getElementById('userMenuPlan');
  const exp  = document.getElementById('userMenuExpires');

  if (sub.hasAccess) {
    let label = (sub.plan || 'active').toUpperCase();
    if (sub.grantedVia === 'stats_editor_pro') label = 'PRO';
    if (sub.plan === 'profile_stats') label = 'ACTIVE';
    subtitle.textContent = label;
    plan.textContent = label;
    const d = sub.expiresAt ? new Date(sub.expiresAt) : null;
    exp.textContent = d ? '• ' + d.toLocaleDateString() : '';
  } else {
    subtitle.textContent = 'NO PLAN';
    plan.textContent = 'No plan';
    exp.textContent = '';
  }
}

// ============ Dropdown menu ============
function toggleDropdown() {
  const d = document.getElementById('userMenuDropdown');
  d.style.display = d.style.display === 'none' ? '' : 'none';
}
function closeDropdown() {
  const d = document.getElementById('userMenuDropdown');
  if (d) d.style.display = 'none';
}
document.addEventListener('click', (e) => {
  const d = document.getElementById('userMenuDropdown');
  const btn = document.getElementById('headerMenuBtn');
  if (!d || !btn) return;
  if (d.style.display !== 'none' && !d.contains(e.target) && !btn.contains(e.target)) closeDropdown();
});

// ============ Tabs ============
function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = p.dataset.tabPane === name ? '' : 'none');
  if (name === 'top') loadTopTab();
  if (name === 'notes') loadNotesTab();
}

// Score -> grade letter (matches the grading used inside the badge).
function gradeFor(score) {
  const s = Number(score) || 0;
  if (s >= 90) return 'S';
  if (s >= 80) return 'A+';
  if (s >= 70) return 'A';
  if (s >= 60) return 'B+';
  if (s >= 50) return 'B';
  if (s >= 40) return 'C';
  if (s >= 30) return 'D';
  return 'F';
}

// Grade -> hue used for the round badge. Mirrors the badge color scale.
function gradeColor(grade) {
  switch (grade) {
    case 'S':  return '#10b981';
    case 'A+': return '#22c55e';
    case 'A':  return '#84cc16';
    case 'B+': return '#facc15';
    case 'B':  return '#f59e0b';
    case 'C':  return '#fb923c';
    case 'D':  return '#ef4444';
    default:   return '#dc2626';
  }
}

function formatFans(model) {
  if (model.fansText) return model.fansText;
  const c = model.fansCount;
  if (!c) return '—';
  if (c >= 1_000_000) return (c / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (c >= 1_000) return (c / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(c);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function modelRowHtml(model, extras = {}) {
  const grade = gradeFor(model.score);
  const color = gradeColor(grade);
  const avatar = model.avatarUrl
    ? `<img class="list-item-avatar" src="${escapeHtml(model.avatarUrl)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="list-item-avatar" style="display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:13px;">${escapeHtml((model.username || '?').charAt(0).toUpperCase())}</div>`;
  const qPct = Math.round((Number(model.qualityScore) || 0) * 100);
  const meta = extras.meta || `Fans: ${escapeHtml(formatFans(model))} · Quality: ${qPct}%`;
  const score = Math.round(Number(model.score) || 0);
  const rank = extras.rank;
  const rankHtml = rank ? `<div class="list-item-rank">${rank}</div>` : '';
  const itemRankClass = rank && rank <= 3 ? ` rank-${rank}` : '';
  return `
    <div class="list-item${itemRankClass}" data-username="${escapeHtml(model.username)}">
      ${rankHtml}
      ${avatar}
      <div class="list-item-main">
        <div class="list-item-name">@${escapeHtml(model.username)}</div>
        <div class="list-item-meta">${meta}</div>
      </div>
      <div class="list-item-score" style="background: ${color}; box-shadow: 0 2px 8px ${color}55;" title="Grade ${grade}">
        ${score} <span style="opacity:.8; font-weight:600; font-size:11px;">${grade}</span>
      </div>
    </div>`;
}

function bindRowClicks(container) {
  container.querySelectorAll('.list-item[data-username]').forEach(el => {
    el.addEventListener('click', () => {
      const u = el.dataset.username;
      if (u) chrome.tabs.create({ url: `https://onlyfans.com/${encodeURIComponent(u)}` });
    });
  });
}

// ============ Leaderboard state ============
const PAGE_SIZE = 50;
const lbState = {
  offset: 0,
  total: 0,
  loading: false,
  filters: { search: '', sort: 'score', minScore: '', maxScore: '', minFans: '', minQuality: '' }
};

function currentLeaderboardParams() {
  const f = lbState.filters;
  const params = { offset: lbState.offset, limit: PAGE_SIZE, sort: f.sort };
  if (f.search) params.search = f.search;
  if (f.minScore !== '') params.minScore = f.minScore;
  if (f.maxScore !== '') params.maxScore = f.maxScore;
  if (f.minFans !== '')  params.minFans  = f.minFans;
  if (f.minQuality !== '') params.minQuality = (Number(f.minQuality) / 100).toFixed(2);
  return params;
}

async function loadTopTab(reset = true) {
  if (lbState.loading) return;
  lbState.loading = true;

  const list = document.getElementById('topList');
  const empty = document.getElementById('topEmpty');
  const info = document.getElementById('leaderboardInfo');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (reset) {
    lbState.offset = 0;
    list.querySelectorAll('.list-item').forEach(n => n.remove());
    empty.textContent = 'Loading…';
    empty.style.display = '';
    info.textContent = '';
    loadMoreBtn.style.display = 'none';
  } else {
    loadMoreBtn.textContent = 'Loading…';
    loadMoreBtn.disabled = true;
  }

  const r = await send('getLeaderboard', { params: currentLeaderboardParams() });

  lbState.loading = false;
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load more';

  if (!r.success) {
    empty.textContent = r.error || 'Failed to load';
    empty.style.display = '';
    return;
  }

  lbState.total = Number(r.total) || 0;
  const models = r.models || [];
  const startRank = lbState.offset + 1;

  if (lbState.total === 0) {
    empty.textContent = 'No models match these filters.';
    empty.style.display = '';
    info.textContent = '';
    return;
  }

  empty.style.display = 'none';

  const html = models.map((m, i) => modelRowHtml(m, { rank: m.globalRank || (startRank + i) })).join('');
  list.insertAdjacentHTML('beforeend', html);
  bindRowClicks(list);

  lbState.offset += models.length;
  info.textContent = `Showing ${lbState.offset} of ${lbState.total}`;
  loadMoreBtn.style.display = lbState.offset < lbState.total ? '' : 'none';
}

async function loadNotesTab() {
  const list = document.getElementById('notesList');
  const empty = document.getElementById('notesEmpty');
  empty.textContent = 'Loading…';
  empty.style.display = '';
  list.querySelectorAll('.list-item').forEach(n => n.remove());

  const r = await send('getNotes');
  if (!r.success) {
    empty.textContent = r.error || 'Failed to load notes';
    return;
  }
  const notesObj = r.notes || {};
  const avatars = r.avatars || {};
  const entries = Object.entries(notesObj)
    .filter(([, n]) => n && ((n.text && n.text.trim()) || (Array.isArray(n.tags) && n.tags.length)))
    .sort((a, b) => (b[1].date || 0) - (a[1].date || 0));

  if (entries.length === 0) {
    empty.textContent = 'No notes yet — write notes on model profiles to see them here.';
    return;
  }
  empty.style.display = 'none';

  const html = entries.map(([username, note]) => {
    const noteText = escapeHtml((note.text || '').slice(0, 120));
    const dateStr = note.date ? new Date(note.date).toLocaleDateString() : '';
    const avatarUrl = avatars[username] || null;
    const tagsCount = Array.isArray(note.tags) ? note.tags.length : 0;
    const tagsBadge = tagsCount ? `<span style="margin-left:6px; opacity:.7;">·  ${tagsCount} tag${tagsCount > 1 ? 's' : ''}</span>` : '';
    return `
      <div class="list-item" data-username="${escapeHtml(username)}">
        ${avatarUrl
          ? `<img class="list-item-avatar" src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer">`
          : `<div class="list-item-avatar" style="display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:13px;">${escapeHtml(username.charAt(0).toUpperCase())}</div>`}
        <div class="list-item-main">
          <div class="list-item-name">@${escapeHtml(username)}</div>
          <div class="list-item-meta">${noteText || '<em style="opacity:.6;">(no text)</em>'} <span style="color:var(--text-muted);">${escapeHtml(dateStr)}</span>${tagsBadge}</div>
        </div>
      </div>`;
  }).join('');
  list.insertAdjacentHTML('beforeend', html);
  bindRowClicks(list);
}

// ============ Plugin enabled toggle ============
async function loadPluginEnabled() {
  const { ofStatsBadgeEnabled } = await chrome.storage.local.get('ofStatsBadgeEnabled');
  // default: enabled
  const enabled = ofStatsBadgeEnabled !== false;
  const a = document.getElementById('pluginEnabled');
  const b = document.getElementById('settingsPluginEnabled');
  if (a) a.checked = enabled;
  if (b) b.checked = enabled;
}

async function setPluginEnabled(enabled) {
  await chrome.storage.local.set({ ofStatsBadgeEnabled: enabled });
  // Mirror into the other checkbox so both stay in sync.
  const a = document.getElementById('pluginEnabled');
  const b = document.getElementById('settingsPluginEnabled');
  if (a) a.checked = enabled;
  if (b) b.checked = enabled;
}

// ============ Subscription page (opened via menu) ============
async function openSubscriptionPage() {
  const email = (await chrome.storage.local.get('userEmail')).userEmail || '';
  document.getElementById('subUserEmail').textContent = email;
  const sub = currentSubscription || {};
  if (sub.hasAccess) {
    const exp = sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : '?';
    const via = sub.grantedVia === 'stats_editor_pro' ? ' (via Stats Editor Pro)' : '';
    document.getElementById('subUserSub').textContent = `${(sub.plan || 'Active').toUpperCase()} until ${exp}${via}`;
    document.getElementById('upgradeCard').style.display = 'none';
  } else {
    document.getElementById('subUserSub').textContent = 'No active subscription';
    document.getElementById('upgradeCard').style.display = '';
    await loadPlanFeatures();
  }
  show('subscription');
}

async function loadPlanFeatures() {
  const { authToken } = await chrome.storage.local.get('authToken');
  try {
    const r = await fetch(`${PROFILE_STATS_API}/billing/plan`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!r.ok) return;
    const { plan } = await r.json();
    const ul = document.getElementById('upgradeFeatures');
    ul.innerHTML = '';
    (plan?.features || []).forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      ul.appendChild(li);
    });
  } catch {}
}

// ============ Payment flow ============
let paymentPollInterval = null;
async function startBuy() {
  setError('buyError', '');
  setLoading('buyBtn', true);
  try {
    const { authToken } = await chrome.storage.local.get('authToken');
    const r = await fetch(`${PROFILE_STATS_API}/billing/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({})
    });
    const data = await r.json();
    if (!r.ok || !data.success) { setError('buyError', data.error || 'Could not start payment'); return; }
    const invoiceUrl = data.invoiceUrl;
    if (invoiceUrl) chrome.tabs.create({ url: invoiceUrl });
    document.getElementById('paymentAmount').textContent = '$15.00 USD';
    document.getElementById('paymentStatus').textContent = 'Waiting for payment confirmation…';
    const link = document.getElementById('paymentInvoiceLink');
    if (invoiceUrl) { link.href = invoiceUrl; link.style.display = ''; } else { link.style.display = 'none'; }
    show('payment');
    pollPayment(data.paymentId, authToken);
  } finally { setLoading('buyBtn', false); }
}

function pollPayment(paymentId, token) {
  if (paymentPollInterval) clearInterval(paymentPollInterval);
  paymentPollInterval = setInterval(async () => {
    try {
      const r = await fetch(`${PROFILE_STATS_API}/billing/payment-status/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json();
      if (!r.ok) return;
      document.getElementById('paymentStatus').textContent = `Status: ${data.status || 'pending'}`;
      if (data.status === 'completed' || data.subscriptionActivated) {
        clearInterval(paymentPollInterval);
        paymentPollInterval = null;
        await send('clearCache');
        await enterMainScreen({ email: (await send('getAuthStatus')).email });
      }
    } catch {}
  }, 10000);
}

function closePaymentScreen() {
  if (paymentPollInterval) { clearInterval(paymentPollInterval); paymentPollInterval = null; }
  show('main');
}

// ============ Side panel toggle ============
async function openSidePanel() {
  await send('openSidePanel');
  window.close();
}

// ============ Wire up ============
function wire(id, evt, fn) { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); }

// Auth forms
document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doLogin(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
});
document.getElementById('registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doRegister(document.getElementById('registerEmail').value.trim(), document.getElementById('registerPassword').value);
});
document.getElementById('forgotForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doForgot(document.getElementById('forgotEmail').value.trim());
});
wire('showRegister', 'click', (e) => { e.preventDefault(); show('register'); });
wire('showLogin',    'click', (e) => { e.preventDefault(); show('login'); });
wire('forgotLink',   'click', (e) => { e.preventDefault(); show('forgot'); });
wire('backToLoginFromForgot', 'click', (e) => { e.preventDefault(); show('login'); });
wire('ssoBtn', 'click', () => doSSO());

// Header
wire('pluginEnabled', 'change', (e) => setPluginEnabled(e.target.checked));
wire('settingsPluginEnabled', 'change', (e) => setPluginEnabled(e.target.checked));
wire('notificationBtn', 'click', () => { /* TODO: notifications panel */ });
wire('expandPanelBtn', 'click', () => openSidePanel());
wire('headerMenuBtn', 'click', (e) => { e.stopPropagation(); toggleDropdown(); });

// Dropdown items
wire('menuSettings',     'click', () => show('settings'));
wire('menuSubscription', 'click', () => openSubscriptionPage());
wire('menuSupport',      'click', () => show('support'));
wire('menuLogout',       'click', () => doLogout());

// Back buttons
wire('subBackBtn',      'click', () => show('main'));
wire('settingsBackBtn', 'click', () => show('main'));
wire('supportBackBtn',  'click', () => show('main'));
wire('paymentCloseBtn', 'click', () => closePaymentScreen());

// Buy
wire('buyBtn', 'click', () => startBuy());

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Leaderboard filters
let searchDebounce = null;
wire('topSearch', 'input', (e) => {
  lbState.filters.search = e.target.value.trim();
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadTopTab(true), 300);
});
// Custom sort dropdown
(function setupSortDropdown() {
  const wrap = document.getElementById('sortDropdown');
  const btn = document.getElementById('sortDropdownBtn');
  const label = document.getElementById('sortDropdownLabel');
  if (!wrap || !btn) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('open');
    btn.classList.toggle('open', wrap.classList.contains('open'));
  });

  wrap.querySelectorAll('.custom-dropdown-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.value;
      wrap.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.toggle('selected', o === opt));
      label.textContent = opt.textContent.trim();
      wrap.classList.remove('open');
      btn.classList.remove('open');
      lbState.filters.sort = val;
      loadTopTab(true);
    });
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      wrap.classList.remove('open');
      btn.classList.remove('open');
    }
  });
})();
wire('filterToggleBtn', 'click', () => {
  const adv = document.getElementById('filterAdvanced');
  const btn = document.getElementById('filterToggleBtn');
  const open = adv.style.display === 'none';
  adv.style.display = open ? '' : 'none';
  btn.classList.toggle('active', open);
});
wire('filterApplyBtn', 'click', () => {
  lbState.filters.minScore   = document.getElementById('filterMinScore').value;
  lbState.filters.maxScore   = document.getElementById('filterMaxScore').value;
  lbState.filters.minFans    = document.getElementById('filterMinFans').value;
  lbState.filters.minQuality = document.getElementById('filterMinQuality').value;
  loadTopTab(true);
});
wire('filterResetBtn', 'click', () => {
  ['filterMinScore', 'filterMaxScore', 'filterMinFans', 'filterMinQuality'].forEach(id => {
    document.getElementById(id).value = '';
  });
  lbState.filters.minScore = lbState.filters.maxScore = lbState.filters.minFans = lbState.filters.minQuality = '';
  loadTopTab(true);
});
wire('loadMoreBtn', 'click', () => loadTopTab(false));

// ============ Boot ============
(async () => {
  const auth = await send('getAuthStatus');
  if (auth.isAuthenticated) await enterMainScreen({ email: auth.email });
  else show('login');
})();
