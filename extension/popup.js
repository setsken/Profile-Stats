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

async function loadTopTab() {
  const empty = document.getElementById('topEmpty');
  empty.textContent = 'Top Models — coming in the next update.';
}

async function loadNotesTab() {
  const empty = document.getElementById('notesEmpty');
  empty.textContent = 'Notes — coming in the next update.';
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

// ============ Boot ============
(async () => {
  const auth = await send('getAuthStatus');
  if (auth.isAuthenticated) await enterMainScreen({ email: auth.email });
  else show('login');
})();
