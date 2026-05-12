// Profile Stats — popup script (skeleton stage).
// All API calls go through background.js so the service worker keeps the
// in-memory token + cache hot for content scripts and side panel reloads.

const PROFILE_STATS_API = 'https://profile-stats-production.up.railway.app/api';

const screens = {
  login:    document.getElementById('loginScreen'),
  register: document.getElementById('registerScreen'),
  forgot:   document.getElementById('forgotScreen'),
  main:     document.getElementById('mainScreen')
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

async function doSSO() {
  setError('loginError', 'SSO with Stats Editor coming in the next update. Use email/password for now.');
}

// ============ Main screen ============
async function enterMainScreen(user) {
  const email = user?.email || (await send('getAuthStatus')).email || '';
  document.getElementById('userEmail').textContent = email;
  show('main');

  // Subscription status via Profile Stats backend (the background-cached one
  // routes to /subscription/status?product=profile_stats on Stats Editor; the
  // direct hit here uses our richer /api/health/check-access view).
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
    } else {
      document.getElementById('userSub').textContent = 'No active subscription';
    }
  } catch (e) {
    document.getElementById('userSub').textContent = 'Subscription check failed';
  }
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

// ============ Boot ============
(async () => {
  const auth = await send('getAuthStatus');
  if (auth.isAuthenticated) {
    await enterMainScreen({ email: auth.email });
  } else {
    show('login');
  }
})();
