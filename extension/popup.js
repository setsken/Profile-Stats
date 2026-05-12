// Profile Stats — popup script (skeleton stage).
// All API calls go through background.js so the service worker keeps the
// in-memory token + cache hot for content scripts and side panel reloads.

const PROFILE_STATS_API = 'https://profile-stats-production.up.railway.app/api';

const screens = {
  login:    document.getElementById('loginScreen'),
  register: document.getElementById('registerScreen'),
  forgot:   document.getElementById('forgotScreen'),
  main:     document.getElementById('mainScreen'),
  payment:  document.getElementById('paymentScreen')
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) {
    el.style.display = k === name ? 'flex' : 'none';
  }
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
  btn.disabled = on;
  btn.querySelector('.btn-text').style.display = on ? 'none' : 'inline';
  btn.querySelector('.btn-loader').style.display = on ? 'inline-block' : 'none';
}

function send(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { success: false, error: 'Empty response' });
      }
    });
  });
}

// ============ Flows ============
async function doLogin(email, password) {
  setError('loginError', '');
  setLoading('loginBtn', true);
  try {
    const r = await send('login', { email, password });
    if (!r.success) { setError('loginError', r.error || 'Login failed'); return; }
    await enterMainScreen(r.user);
  } finally {
    setLoading('loginBtn', false);
  }
}

async function doRegister(email, password) {
  setError('registerError', '');
  setLoading('registerBtn', true);
  try {
    const r = await send('register', { email, password });
    if (!r.success) { setError('registerError', r.error || 'Registration failed'); return; }
    if (r.requiresVerification) {
      setError('registerError', 'Account created. Check your email then sign in.');
      show('login');
      return;
    }
    await enterMainScreen(r.user);
  } finally {
    setLoading('registerBtn', false);
  }
}

async function doForgot(email) {
  setError('forgotError', '');
  setSuccess('forgotSuccess', '');
  setLoading('forgotBtn', true);
  try {
    const r = await send('forgotPassword', { email });
    if (!r.success) { setError('forgotError', r.error || 'Failed to send reset code'); return; }
    setSuccess('forgotSuccess', r.message || 'Reset code sent. Check your email.');
  } finally {
    setLoading('forgotBtn', false);
  }
}

async function doLogout() {
  await send('logout');
  show('login');
}

// Stats Editor extension ID (matches manifest "key"). Has to be updated to the
// production ID once Stats Editor is published to the Chrome Web Store.
const STATS_EDITOR_EXTENSION_ID = 'mflgdblgjakdfkjnfdkfmmobgppgjgom';

async function doSSO() {
  setError('loginError', '');
  setLoading('loginBtn', true);
  try {
    const resp = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(STATS_EDITOR_EXTENSION_ID, { action: 'getStatsEditorToken' }, (r) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(r || { success: false, error: 'Empty response' });
          }
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
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

    // Hand the borrowed token to background so it lives in the same place a
    // normal login would put it (in-memory + chrome.storage + broadcast to
    // OnlyFans tabs), and content scripts pick it up immediately.
    const stored = await send('setTokenFromSSO', { token: resp.token, email: resp.email });
    if (!stored.success) {
      setError('loginError', stored.error || 'Failed to store token');
      return;
    }
    await enterMainScreen({ email: resp.email });
  } finally {
    setLoading('loginBtn', false);
  }
}

// ============ Main screen ============
async function enterMainScreen(user) {
  const email = user?.email || (await send('getAuthStatus')).email || '';
  document.getElementById('userEmail').textContent = email;
  show('main');

  const activeCard = document.getElementById('activeCard');
  const upgradeCard = document.getElementById('upgradeCard');

  const { authToken } = await chrome.storage.local.get('authToken');
  try {
    const r = await fetch(`${PROFILE_STATS_API}/health/check-access`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (r.status === 401) { await doLogout(); return; }
    const data = await r.json();
    const sub = data.subscription || {};
    if (sub.hasAccess) {
      const exp = sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : '?';
      const via = sub.grantedVia === 'stats_editor_pro' ? ' (via Stats Editor Pro)' : '';
      document.getElementById('userSub').textContent = `${(sub.plan || 'Active').toUpperCase()} until ${exp}${via}`;
      activeCard.style.display = '';
      upgradeCard.style.display = 'none';
    } else {
      document.getElementById('userSub').textContent = 'No active subscription';
      activeCard.style.display = 'none';
      upgradeCard.style.display = '';
      await loadPlanInto(upgradeCard, authToken);
    }
  } catch (e) {
    document.getElementById('userSub').textContent = 'Subscription check failed';
    activeCard.style.display = 'none';
    upgradeCard.style.display = 'none';
  }
}

async function loadPlanInto(card, token) {
  try {
    const r = await fetch(`${PROFILE_STATS_API}/billing/plan`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return;
    const { plan } = await r.json();
    if (!plan) return;
    const ul = card.querySelector('#upgradeFeatures');
    ul.innerHTML = '';
    (plan.features || []).forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      ul.appendChild(li);
    });
  } catch {}
}

// ============ Payment flow ============
let paymentPollInterval = null;
let currentPaymentId = null;

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
    if (!r.ok || !data.success) {
      setError('buyError', data.error || 'Could not start payment');
      return;
    }

    currentPaymentId = data.paymentId;
    const invoiceUrl = data.invoiceUrl || (data.payAddress ? null : null);
    if (invoiceUrl) chrome.tabs.create({ url: invoiceUrl });

    document.getElementById('paymentAmount').textContent = '$15.00 USD';
    document.getElementById('paymentStatus').textContent = 'Waiting for payment confirmation…';
    const link = document.getElementById('paymentInvoiceLink');
    if (invoiceUrl) { link.href = invoiceUrl; link.style.display = ''; } else { link.style.display = 'none'; }
    show('payment');
    pollPayment(currentPaymentId, authToken);
  } finally {
    setLoading('buyBtn', false);
  }
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
  }, 10000); // poll every 10s
}

function closePaymentScreen() {
  if (paymentPollInterval) { clearInterval(paymentPollInterval); paymentPollInterval = null; }
  show('main');
}

// ============ Wire up ============
document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doLogin(document.getElementById('loginEmail').value.trim(),
          document.getElementById('loginPassword').value);
});
document.getElementById('registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doRegister(document.getElementById('registerEmail').value.trim(),
             document.getElementById('registerPassword').value);
});
document.getElementById('forgotForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doForgot(document.getElementById('forgotEmail').value.trim());
});
document.getElementById('showRegister').addEventListener('click', (e) => { e.preventDefault(); show('register'); });
document.getElementById('showLogin').addEventListener('click', (e) => { e.preventDefault(); show('login'); });
document.getElementById('forgotLink').addEventListener('click', (e) => { e.preventDefault(); show('forgot'); });
document.getElementById('backToLoginFromForgot').addEventListener('click', (e) => { e.preventDefault(); show('login'); });
document.getElementById('ssoBtn').addEventListener('click', () => doSSO());
document.getElementById('logoutBtn').addEventListener('click', () => doLogout());
document.getElementById('buyBtn').addEventListener('click', () => startBuy());
document.getElementById('paymentCloseBtn').addEventListener('click', () => closePaymentScreen());

// ============ Boot ============
(async () => {
  const auth = await send('getAuthStatus');
  if (auth.isAuthenticated) {
    await enterMainScreen({ email: auth.email });
  } else {
    show('login');
  }
})();
