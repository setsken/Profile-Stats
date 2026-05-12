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

const TAG_COLORS = [
  '#8b5cf6', '#10b981', '#ef4444', '#f59e0b',
  '#3b82f6', '#ec4899', '#14b8a6', '#6b7280'
];
function tagColor(ci) { return TAG_COLORS[((ci % TAG_COLORS.length) + TAG_COLORS.length) % TAG_COLORS.length]; }

// Notes / tags state. Mirrors the badge's _notesActiveView model so the
// three sub-tabs (editor/tags/models) behave identically.
const notesState = {
  loaded: false,
  notes: {},        // { username: { text, tags: [tagId], date } }
  avatars: {},      // { username: avatar_url }
  tags: [],         // [ { id, name, ci } ]
  activeView: 'models',
  editingUsername: null,
  editingTagIds: null, // staged tag ids for the current editor session
  draftText: '',
  draftTagName: '',
  newTagColorIndex: 0,
  modelsSearch: ''
};

// Persist the active editor session so a closed popup does not eat the draft.
const DRAFT_STORAGE_KEY = 'psNoteDraft';
async function persistDraft() {
  const payload = {
    activeView: notesState.activeView,
    editingUsername: notesState.editingUsername,
    draftText: notesState.draftText,
    editingTagIds: notesState.editingTagIds
  };
  try { await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: payload }); } catch {}
}
async function loadDraft() {
  try {
    const r = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
    return r[DRAFT_STORAGE_KEY] || null;
  } catch { return null; }
}
async function clearDraft() {
  try { await chrome.storage.local.remove(DRAFT_STORAGE_KEY); } catch {}
}

// Whole-popup UI state: which screen, which top-level tab. The Notes
// sub-view lives in the existing draft so it follows the same lifecycle.
const UI_STATE_KEY = 'psPopupUi';
const uiState = { screen: 'main', tab: 'top' };
async function persistUiState() {
  try { await chrome.storage.local.set({ [UI_STATE_KEY]: uiState }); } catch {}
}
async function loadUiState() {
  try {
    const r = await chrome.storage.local.get(UI_STATE_KEY);
    return r[UI_STATE_KEY] || null;
  } catch { return null; }
}

function show(name) {
  for (const [k, el] of Object.entries(screens)) {
    if (!el) continue; // tolerate missing screens
    el.style.display = k === name ? 'flex' : 'none';
  }
  closeDropdown();
  // Persist only screens that make sense to restore after re-open. Auth
  // screens fall through — those are gated by the auth status anyway.
  if (['main', 'subscription', 'settings', 'support'].includes(name)) {
    uiState.screen = name;
    persistUiState();
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
  if (!btn) return;
  btn.disabled = on;
  const t = btn.querySelector('.btn-text');
  const l = btn.querySelector('.btn-loader');
  if (t) t.style.display = on ? 'none' : 'inline';
  if (l) l.style.display = on ? 'inline-block' : 'none';
}

function _sendOnce(action, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(resp || { success: false, error: 'Empty response' });
      });
    } catch (e) { resolve({ success: false, error: e.message }); }
  });
}

// Promise-based custom confirm dialog (replaces native window.confirm).
function showConfirm({ title = 'Confirm', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmAcceptBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const iconEl = document.getElementById('confirmIcon');

    titleEl.textContent = title;
    msgEl.textContent = message;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    okBtn.className = 'modal-btn ' + (danger ? 'modal-btn-danger' : 'modal-btn-primary');
    iconEl.className = 'modal-icon' + (danger ? '' : ' info');
    overlay.style.display = 'flex';

    function cleanup(result) {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    setTimeout(() => okBtn.focus(), 50);
  });
}

// MV3 service workers can be asleep when popup opens; the first message
// occasionally lands before the worker is fully alive. Retry once after a
// short delay to mask that cold-start race.
async function send(action, payload = {}) {
  let resp = await _sendOnce(action, payload);
  const dead = !resp || (resp.success === false &&
    typeof resp.error === 'string' &&
    (resp.error.includes('Could not establish connection') ||
     resp.error.includes('Receiving end does not exist') ||
     resp.error === 'Empty response'));
  if (dead) {
    await new Promise(r => setTimeout(r, 150));
    resp = await _sendOnce(action, payload);
  }
  return resp;
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

  // Pull saved UI state to decide where to land. Default = main / Top Models.
  const saved = await loadUiState();
  const targetScreen = saved && ['main', 'subscription', 'settings', 'support'].includes(saved.screen)
    ? saved.screen
    : 'main';
  const targetTab = saved && ['top', 'notes'].includes(saved.tab) ? saved.tab : 'top';

  show(targetScreen);

  if (targetScreen === 'main') {
    // Apply tab without going through activateTab (which would persist state
    // we just read). Inline the visible swap, then call the loader.
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.tab === targetTab));
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = p.dataset.tabPane === targetTab ? '' : 'none');
    uiState.tab = targetTab;
    if (targetTab === 'top') loadTopTab();
    else loadNotesTab();
  } else if (targetScreen === 'subscription') {
    openSubscriptionPage();
  }
  // settings / support are static — nothing to load.
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
  uiState.tab = name;
  persistUiState();
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

// ============ Notes Tab (sub-tabs: editor / tags / models) ============

async function loadNotesTab() {
  const content = document.getElementById('notesContent');
  content.innerHTML = '<div class="list-empty">Loading…</div>';

  const [notesResp, tagsResp, savedDraft] = await Promise.all([
    send('getNotes'),
    send('getNoteTags'),
    loadDraft()
  ]);
  if (!notesResp.success) {
    content.innerHTML = `<div class="list-empty">${escapeHtml(notesResp.error || 'Failed to load notes')}</div>`;
    return;
  }
  notesState.notes = notesResp.notes || {};
  notesState.avatars = notesResp.avatars || {};
  notesState.tags = tagsResp.success ? (tagsResp.tags || []) : [];
  notesState.loaded = true;

  // Restore the in-progress editor session if the popup was closed mid-edit.
  if (savedDraft && savedDraft.editingUsername) {
    notesState.editingUsername = savedDraft.editingUsername;
    notesState.draftText = savedDraft.draftText || '';
    notesState.editingTagIds = Array.isArray(savedDraft.editingTagIds) ? savedDraft.editingTagIds : null;
    notesState.activeView = savedDraft.activeView || 'editor';
    document.querySelectorAll('.notes-subtab').forEach(b => {
      b.classList.toggle('active', b.dataset.subview === notesState.activeView);
    });
  }
  renderNotesView();
}

function setNotesView(view) {
  notesState.activeView = view;
  document.querySelectorAll('.notes-subtab').forEach(b => {
    b.classList.toggle('active', b.dataset.subview === view);
  });
  renderNotesView();
}

function renderNotesView() {
  const content = document.getElementById('notesContent');
  if (!content) return;
  if (!notesState.loaded) return;
  if (notesState.activeView === 'editor') renderEditorView(content);
  else if (notesState.activeView === 'tags') renderTagsView(content);
  else renderModelsView(content);
}

// ---- Editor view ----
function renderEditorView(content) {
  const username = notesState.editingUsername;
  if (!username) {
    content.innerHTML = `
      <div class="editor-empty">
        Pick a model from the <b>Models</b> tab to edit its note,<br>
        or type a username below to add a new one.
      </div>
      <div class="form-field">
        <label class="form-label">Model username</label>
        <input type="text" id="editorUsernameInput" class="form-input" placeholder="@username" autocomplete="off">
      </div>
      <button class="auth-btn" id="editorPickBtn">
        <span class="btn-text">Open editor</span>
        <div class="btn-loader" style="display:none;"></div>
      </button>`;
    document.getElementById('editorPickBtn').addEventListener('click', () => {
      const u = document.getElementById('editorUsernameInput').value.trim().toLowerCase().replace(/^@/, '');
      if (!u) return;
      notesState.editingUsername = u;
      notesState.draftText = '';
      notesState.editingTagIds = null;
      persistDraft();
      renderEditorView(content);
      ensureAvatar(u);
    });
    return;
  }

  const note = notesState.notes[username] || { text: '', tags: [], date: 0 };
  const avatarUrl = notesState.avatars[username] || null;
  const profileUrl = `https://onlyfans.com/${encodeURIComponent(username)}`;

  content.innerHTML = `
    <div class="editor-header">
      <div class="editor-avatar-slot" id="editorAvatarSlot">
        ${avatarUrl
          ? `<img class="editor-avatar" src="${escapeHtml(avatarUrl)}" referrerpolicy="no-referrer" alt="" id="editorAvatar">`
          : `<div class="editor-avatar" style="display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-weight:700;">${escapeHtml(username.charAt(0).toUpperCase())}</div>`}
      </div>
      <span class="editor-label" id="editorOpenProfile">@${escapeHtml(username)}</span>
      <span style="flex:1;"></span>
      <button class="header-icon-btn" id="editorCloseBtn" title="Pick another">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <textarea id="editorTextarea" class="form-input form-textarea" rows="5" placeholder="Write your note about this model…" maxlength="5000">${escapeHtml(notesState.draftText || note.text || '')}</textarea>
    <div class="form-hint"><span id="editorCharCount">${(notesState.draftText || note.text || '').length}</span> / 5000</div>
    <div class="form-field" style="margin-top: 10px;">
      <label class="form-label">Tags</label>
      <div class="tag-picker" id="editorTagPicker"></div>
    </div>
    <div class="auth-error" id="editorError"></div>
    <div class="editor-actions">
      <button class="auth-btn" id="editorSaveBtn">
        <span class="btn-text">Save</span>
        <div class="btn-loader" style="display:none;"></div>
      </button>
      ${note.date ? `<button class="editor-action-delete" id="editorDeleteBtn" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/>
        </svg>
      </button>` : ''}
    </div>
  `;

  // Tag chips: assigned first (full opacity), available second (dimmed). Click toggles.
  const initialTagIds = notesState.editingTagIds || note.tags || [];
  renderEditorTagPicker(initialTagIds);

  // Auto-load avatar from server if we don't have one locally yet.
  if (!avatarUrl) ensureAvatar(username);

  // Wire up
  document.getElementById('editorOpenProfile').addEventListener('click', () => chrome.tabs.create({ url: profileUrl }));
  const av = document.getElementById('editorAvatar');
  if (av && avatarUrl) av.addEventListener('click', () => chrome.tabs.create({ url: profileUrl }));
  document.getElementById('editorCloseBtn').addEventListener('click', () => {
    notesState.editingUsername = null;
    notesState.draftText = '';
    notesState.editingTagIds = null;
    persistDraft();
    renderEditorView(content);
  });
  document.getElementById('editorTextarea').addEventListener('input', (e) => {
    notesState.draftText = e.target.value;
    document.getElementById('editorCharCount').textContent = e.target.value.length;
    persistDraft();
  });
  document.getElementById('editorSaveBtn').addEventListener('click', () => saveCurrentNote());
  const delBtn = document.getElementById('editorDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', () => deleteCurrentNote());
}

async function ensureAvatar(username) {
  if (!username) return;
  if (notesState.avatars[username]) return;
  const r = await send('getModelInfo', { username });
  if (r && r.success && r.avatarUrl) {
    notesState.avatars[username] = r.avatarUrl;
    // Swap the placeholder avatar element in place if the editor is still open.
    const slot = document.getElementById('editorAvatarSlot');
    if (slot && notesState.editingUsername === username) {
      const profileUrl = `https://onlyfans.com/${encodeURIComponent(username)}`;
      slot.innerHTML = `<img class="editor-avatar" src="${escapeHtml(r.avatarUrl)}" referrerpolicy="no-referrer" alt="" id="editorAvatar">`;
      document.getElementById('editorAvatar').addEventListener('click', () => chrome.tabs.create({ url: profileUrl }));
    }
  }
}

function renderEditorTagPicker(selectedIds) {
  const picker = document.getElementById('editorTagPicker');
  if (!picker) return;
  picker.innerHTML = '';
  if (notesState.tags.length === 0) {
    picker.innerHTML = '<div style="font-size:11px; color: var(--text-muted); padding: 8px;">No tags yet — open the Tags sub-tab to create some.</div>';
    return;
  }
  const selectedSet = new Set(selectedIds);
  const sorted = [...notesState.tags].sort((a, b) => Number(selectedSet.has(b.id)) - Number(selectedSet.has(a.id)));
  sorted.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (selectedSet.has(t.id) ? ' selected' : '');
    chip.style.background = tagColor(t.ci);
    chip.dataset.tagId = t.id;
    chip.textContent = t.name;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      // Capture the staged tag set so the draft survives a popup close.
      notesState.editingTagIds = Array.from(picker.querySelectorAll('.tag-chip.selected'))
        .map(el => Number(el.dataset.tagId)).filter(n => !Number.isNaN(n));
      persistDraft();
    });
    picker.appendChild(chip);
  });
}

async function saveCurrentNote() {
  const username = notesState.editingUsername;
  if (!username) return;
  const text = (document.getElementById('editorTextarea')?.value || '').trim();
  const tags = Array.from(document.querySelectorAll('#editorTagPicker .tag-chip.selected'))
    .map(el => Number(el.dataset.tagId)).filter(n => !Number.isNaN(n));
  setError('editorError', '');
  setLoading('editorSaveBtn', true);
  try {
    const r = await send('saveNote', {
      username, text, tags, date: Date.now(),
      avatarUrl: notesState.avatars[username] || null
    });
    if (!r.success) { setError('editorError', r.error || 'Failed to save'); return; }
    notesState.notes[username] = { text, tags, date: Date.now() };
    notesState.draftText = '';
    notesState.editingTagIds = null;
    await clearDraft();
    setNotesView('models');
  } finally { setLoading('editorSaveBtn', false); }
}

async function deleteCurrentNote() {
  const username = notesState.editingUsername;
  if (!username) return;
  const ok = await showConfirm({
    title: 'Delete note',
    message: `Are you sure you want to delete the note for @${username}? This cannot be undone.`,
    confirmText: 'Delete'
  });
  if (!ok) return;
  const r = await send('deleteNote', { username });
  if (!r.success) { setError('editorError', r.error || 'Failed to delete'); return; }
  delete notesState.notes[username];
  notesState.editingUsername = null;
  notesState.draftText = '';
  notesState.editingTagIds = null;
  await clearDraft();
  setNotesView('models');
}

// Quick delete from the Models list row.
async function deleteNoteByUsername(username) {
  if (!username) return;
  const ok = await showConfirm({
    title: 'Delete note',
    message: `Are you sure you want to delete the note for @${username}? This cannot be undone.`,
    confirmText: 'Delete'
  });
  if (!ok) return;
  const r = await send('deleteNote', { username });
  if (!r.success) { alert(r.error || 'Failed to delete'); return; }
  delete notesState.notes[username];
  if (notesState.editingUsername === username) {
    notesState.editingUsername = null;
    notesState.draftText = '';
    notesState.editingTagIds = null;
    await clearDraft();
  }
  renderModelsListBody();
}

// ---- Tags view ----
function renderTagsView(content) {
  content.innerHTML = `
    <div class="form-field">
      <label class="form-label">Create tag</label>
      <div class="tag-create-row">
        <input type="text" id="newTagName" class="form-input" placeholder="Tag name (e.g. 'Top performer')" maxlength="50" value="${escapeHtml(notesState.draftTagName || '')}">
        <div class="tag-create-row-bottom">
          <div class="color-picker" id="newTagColorPicker"></div>
          <button class="toolbar-btn primary" id="addTagBtn">Add</button>
        </div>
      </div>
      <div class="auth-error" id="tagError"></div>
    </div>
    <div class="form-field">
      <label class="form-label">Your tags</label>
      <div class="tag-list" id="tagList"></div>
    </div>
  `;
  renderColorPicker();
  renderTagList();
  const nameInput = document.getElementById('newTagName');
  nameInput.addEventListener('input', (e) => { notesState.draftTagName = e.target.value; });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });
  document.getElementById('addTagBtn').addEventListener('click', () => addTag());
}

function renderColorPicker() {
  const wrap = document.getElementById('newTagColorPicker');
  if (!wrap) return;
  wrap.innerHTML = '';
  TAG_COLORS.forEach((c, idx) => {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (idx === notesState.newTagColorIndex ? ' selected' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => {
      notesState.newTagColorIndex = idx;
      renderColorPicker();
    });
    wrap.appendChild(dot);
  });
}

function renderTagList() {
  const list = document.getElementById('tagList');
  if (!list) return;
  list.innerHTML = '';
  if (notesState.tags.length === 0) {
    list.innerHTML = '<div class="list-empty">No tags yet. Create one above.</div>';
    return;
  }
  notesState.tags.forEach(t => {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.innerHTML = `
      <div class="tag-row-dot" style="background:${tagColor(t.ci)}"></div>
      <div class="tag-row-name">${escapeHtml(t.name)}</div>
      <button class="tag-row-delete" data-tag-id="${t.id}" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/>
        </svg>
      </button>`;
    row.querySelector('.tag-row-delete').addEventListener('click', () => deleteTag(t.id));
    list.appendChild(row);
  });
}

async function syncTags() {
  const r = await send('syncNoteTags', { tags: notesState.tags });
  if (!r.success) { setError('tagError', r.error || 'Failed to sync tags'); return false; }
  notesState.tags = r.tags || notesState.tags;
  return true;
}

async function addTag() {
  const name = (document.getElementById('newTagName')?.value || '').trim().slice(0, 50);
  if (!name) { setError('tagError', 'Name is required'); return; }
  if (notesState.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    setError('tagError', 'A tag with this name already exists'); return;
  }
  setError('tagError', '');
  notesState.tags.push({ id: -Date.now(), name, ci: notesState.newTagColorIndex });
  if (await syncTags()) {
    notesState.draftTagName = '';
    renderTagsView(document.getElementById('notesContent'));
  } else {
    notesState.tags.pop();
  }
}

async function deleteTag(tagId) {
  const target = notesState.tags.find(t => t.id === tagId);
  const name = target ? target.name : 'this tag';
  const ok = await showConfirm({
    title: 'Delete tag',
    message: `Are you sure you want to delete "${name}"? It will be removed from every note that uses it.`,
    confirmText: 'Delete'
  });
  if (!ok) return;
  const before = notesState.tags;
  notesState.tags = notesState.tags.filter(t => t.id !== tagId);
  if (!(await syncTags())) { notesState.tags = before; return; }
  for (const u of Object.keys(notesState.notes)) {
    const n = notesState.notes[u];
    if (Array.isArray(n?.tags) && n.tags.includes(tagId)) {
      n.tags = n.tags.filter(id => id !== tagId);
    }
  }
  renderTagList();
}

// ---- Models view ----
function renderModelsView(content) {
  content.innerHTML = `
    <div class="notes-search-wrap">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input type="search" id="modelsSearch" class="search-input" placeholder="Search @username…" value="${escapeHtml(notesState.modelsSearch || '')}">
      </div>
    </div>
    <div class="notes-models-list" id="notesModelsList"></div>
  `;
  document.getElementById('modelsSearch').addEventListener('input', (e) => {
    notesState.modelsSearch = e.target.value.trim().toLowerCase();
    renderModelsListBody();
  });
  renderModelsListBody();
}

function renderModelsListBody() {
  const wrap = document.getElementById('notesModelsList');
  if (!wrap) return;
  const tagsById = new Map(notesState.tags.map(t => [t.id, t]));
  const q = notesState.modelsSearch || '';
  const entries = Object.entries(notesState.notes)
    .filter(([u, n]) => n && ((n.text && n.text.trim()) || (Array.isArray(n.tags) && n.tags.length)))
    .filter(([u]) => !q || u.toLowerCase().includes(q))
    .sort((a, b) => (b[1].date || 0) - (a[1].date || 0));

  if (entries.length === 0) {
    wrap.innerHTML = `<div class="list-empty">${q ? 'No models match.' : 'No notes yet.'}<br><span style="font-size:11px; color:var(--text-muted);">Open Note tab and type a username, or write a note from the badge on any profile.</span></div>`;
    return;
  }
  wrap.innerHTML = entries.map(([username, note]) => {
    const avatarUrl = notesState.avatars[username] || null;
    const preview = escapeHtml((note.text || '').slice(0, 90));
    const tagIds = Array.isArray(note.tags) ? note.tags : [];
    const chips = tagIds.map(tid => tagsById.get(tid)).filter(Boolean).map(t =>
      `<span class="tag-chip selected" style="background:${tagColor(t.ci)}; cursor:default; padding:2px 7px; font-size:10px;">${escapeHtml(t.name)}</span>`
    ).join('');
    return `
      <div class="notes-model-row" data-username="${escapeHtml(username)}">
        ${avatarUrl
          ? `<img class="notes-model-avatar" src="${escapeHtml(avatarUrl)}" referrerpolicy="no-referrer" alt="">`
          : `<div class="notes-model-avatar">${escapeHtml(username.charAt(0).toUpperCase())}</div>`}
        <div class="notes-model-main">
          <div class="notes-model-name">@${escapeHtml(username)}</div>
          <div class="notes-model-preview">${preview || '<em style="opacity:.6;">(no text)</em>'}</div>
          ${chips ? `<div class="notes-model-tags">${chips}</div>` : ''}
        </div>
        <button class="notes-model-delete" data-delete-username="${escapeHtml(username)}" title="Delete note">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>`;
  }).join('');
  // Delete buttons first (stop propagation so click does not also open editor).
  wrap.querySelectorAll('.notes-model-delete[data-delete-username]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNoteByUsername(btn.dataset.deleteUsername);
    });
  });
  // Row click anywhere else opens the editor for that model.
  wrap.querySelectorAll('.notes-model-row[data-username]').forEach(el => {
    el.addEventListener('click', () => {
      notesState.editingUsername = el.dataset.username;
      notesState.draftText = '';
      notesState.editingTagIds = null;
      persistDraft();
      setNotesView('editor');
    });
  });
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

// Notes sub-tabs
document.querySelectorAll('.notes-subtab').forEach(btn => {
  btn.addEventListener('click', () => setNotesView(btn.dataset.subview));
});

// ============ Boot ============
(async () => {
  const auth = await send('getAuthStatus');
  if (auth.isAuthenticated) await enterMainScreen({ email: auth.email });
  else show('login');
})();
