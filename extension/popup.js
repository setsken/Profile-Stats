// Profile Stats — popup script (skeleton stage).
// Handles auth (login/register/forgot) against Stats Editor backend and shows a
// minimal main screen. Real product UI (models / notes / tags / badges) lands
// in follow-up phases.

const STATS_EDITOR_API = 'https://stats-editor-production.up.railway.app/api';
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

// ============ Token storage ============
async function saveToken(token, user) {
  await chrome.storage.local.set({ authToken: token, authUser: user });
}
async function loadToken() {
  const { authToken, authUser } = await chrome.storage.local.get(['authToken', 'authUser']);
  return { token: authToken, user: authUser };
}
async function clearToken() {
  await chrome.storage.local.remove(['authToken', 'authUser']);
}

// ============ API calls ============
async function apiPost(base, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { code: data.code, status: r.status });
  return data;
}

async function apiGet(base, path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { code: data.code, status: r.status });
  return data;
}

// ============ Flows ============
async function doLogin(email, password) {
  setError('loginError', '');
  setLoading('loginBtn', true);
  try {
    const data = await apiPost(STATS_EDITOR_API, '/auth/login', { email, password });
    await saveToken(data.token, data.user);
    await enterMainScreen(data.token, data.user);
  } catch (e) {
    setError('loginError', e.message || 'Login failed');
  } finally {
    setLoading('loginBtn', false);
  }
}

async function doRegister(email, password) {
  setError('registerError', '');
  setLoading('registerBtn', true);
  try {
    const data = await apiPost(STATS_EDITOR_API, '/auth/register', { email, password });
    if (data.token) {
      await saveToken(data.token, data.user);
      await enterMainScreen(data.token, data.user);
    } else {
      // If backend requires email verification, send user back to login.
      setError('registerError', 'Account created. Check your email and then sign in.');
      show('login');
    }
  } catch (e) {
    setError('registerError', e.message || 'Registration failed');
  } finally {
    setLoading('registerBtn', false);
  }
}

async function doForgot(email) {
  setError('forgotError', '');
  setSuccess('forgotSuccess', '');
  setLoading('forgotBtn', true);
  try {
    await apiPost(STATS_EDITOR_API, '/auth/forgot-password', { email });
    setSuccess('forgotSuccess', 'Reset code sent. Check your email.');
  } catch (e) {
    setError('forgotError', e.message || 'Failed to send reset code');
  } finally {
    setLoading('forgotBtn', false);
  }
}

async function doLogout() {
  await clearToken();
  show('login');
}

// ============ SSO placeholder ============
async function doSSO() {
  // In a later phase this will message the Stats Editor extension via
  // chrome.runtime.sendMessage with its extension ID and externally_connectable
  // declared on both sides. For the skeleton we surface a friendly message.
  setError('loginError', 'SSO with Stats Editor coming in the next update. Use email/password for now.');
}

// ============ Main screen bootstrap ============
async function enterMainScreen(token, user) {
  document.getElementById('userEmail').textContent = user?.email || '';
  show('main');
  try {
    const access = await apiGet(PROFILE_STATS_API, '/health/check-access', token);
    const sub = access.subscription || {};
    let line = 'No active subscription';
    if (sub.hasAccess) {
      const exp = sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : '?';
      const via = sub.grantedVia === 'stats_editor_pro' ? ' (via Stats Editor Pro)' : '';
      line = `${(sub.plan || 'Active').toUpperCase()} until ${exp}${via}`;
    }
    document.getElementById('userSub').textContent = line;
  } catch (e) {
    if (e.status === 401) {
      await doLogout();
      return;
    }
    document.getElementById('userSub').textContent = 'Subscription check failed (you can still sign out)';
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
  const { token, user } = await loadToken();
  if (token && user) {
    await enterMainScreen(token, user);
  } else {
    show('login');
  }
})();
