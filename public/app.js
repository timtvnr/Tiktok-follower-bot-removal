/* Sillage — logique client. Aucune dépendance, aucun secret côté navigateur. */
'use strict';

/* ─── utilitaires ─────────────────────────────────────────── */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* réponse non JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('Erreur HTTP ' + res.status));
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function toast(message, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4200);
}

function fmtCountdown(ms) {
  if (ms == null || ms < 0) ms = 0;
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + ' h ' + String(m).padStart(2, '0') + ' min';
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function fmtAgo(ts) {
  if (!ts) return 'jamais';
  const diff = Date.now() - ts;
  if (diff < 45 * 1000) return 'à l’instant';
  const min = Math.floor(diff / 60000);
  if (min < 60) return 'il y a ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 48) return 'il y a ' + h + ' h';
  return 'il y a ' + Math.floor(h / 24) + ' j';
}

function fmtPlanTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const dayKey = (x) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (dayKey(d) === dayKey(now)) return 'aujourd’hui · ' + hm;
  if (dayKey(d) === dayKey(tomorrow)) return 'demain · ' + hm;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + hm;
}

/* ─── état client ─────────────────────────────────────────── */
const state = {
  q: '',
  filter: 'active',
  sort: 'recent',
  selected: new Set(),
  currentIds: [],
  status: null,
  plan: [],
};

/* ─── onglets ─────────────────────────────────────────────── */
function gotoTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}
$$('.tab').forEach(t => t.addEventListener('click', () => gotoTab(t.dataset.tab)));
$$('[data-goto-tab]').forEach(b => b.addEventListener('click', () => gotoTab(b.dataset.gotoTab)));

/* ─── suivi temps réel ────────────────────────────────────── */
async function refreshStatus() {
  try {
    state.status = await api('/api/status');
  } catch (err) {
    console.warn('status échoué', err);
    return;
  }
  renderStatus();
}

function renderStatus() {
  const s = state.status;
  if (!s) return;

  // Badge mode
  const modeBadge = $('#modeBadge');
  if (s.mode === 'gateway') {
    modeBadge.textContent = 'CANAL D’ACTION RÉEL';
    modeBadge.className = 'mode-badge live';
    $('#demoBanner').classList.add('hidden');
  } else {
    modeBadge.textContent = 'DÉMO — gestes simulés';
    modeBadge.className = 'mode-badge demo';
    $('#demoBanner').classList.remove('hidden');
  }

  // Pilule de connexion
  const pill = $('#connectionPill');
  const conn = s.connection || {};
  if (conn.connected) {
    pill.classList.add('connected');
    $('#connectionText').textContent = (conn.displayName || 'Compte lié') + (conn.followerCount != null ? ' · ' + fmtNum(conn.followerCount) + ' abonnés' : '');
    $('#disconnectBtn').classList.remove('hidden');
  } else {
    pill.classList.remove('connected');
    $('#connectionText').textContent = conn.configured ? 'TikTok non lié — cliquer pour lier' : 'OAuth non configuré (démo)';
    $('#disconnectBtn').classList.add('hidden');
  }

  // Carte « Aujourd'hui »
  $('#todayCount').textContent = s.daily.count;
  $('#todayCap').textContent = s.daily.cap;
  $('#todayProgress').style.width = Math.min(100, (s.daily.count / s.daily.cap) * 100) + '%';
  $('#lastActionAgo').textContent = fmtAgo(s.lastActionAt);
  $('#statToday').textContent = s.daily.count;

  // Ligne de refroidissement manuel
  const cd = $('#cooldownLine');
  if (!s.canAct.ok) {
    if (s.canAct.code === 'cooldown') cd.textContent = 'Prochain geste manuel : encore ' + Math.ceil((s.canAct.retryAfterMs || 0) / 1000) + ' s';
    else if (s.canAct.code === 'daily_cap') cd.textContent = 'Plafond quotidien atteint — à demain';
    else if (s.canAct.code === 'outside_hours') cd.textContent = 'Hors plage d’activité — reprise à l’ouverture';
    else cd.textContent = s.canAct.reason || 'Indisponible';
  } else {
    cd.textContent = 'Prochain geste manuel : possible maintenant';
    cd.style.color = '';
  }

  // Boutons « Retirer » : éteints pendant le refroidissement
  $$('.remove-btn').forEach(btn => { btn.disabled = !s.canAct.ok; btn.title = s.canAct.ok ? 'Retirer ce compte, comme au doigt' : (s.canAct.reason || ''); });

  // Session assistée
  const eng = s.engine;
  const stateLabels = { idle: 'En veille', running: 'Session en cours', paused: 'Session en pause' };
  $('#sessionStateLabel').textContent = stateLabels[eng.state] || eng.state;
  $('#sessionDot').className = 'session-dot ' + eng.state;
  $('#sessionDone').textContent = eng.done;
  $('#sessionTotal').textContent = eng.targetsTotal;
  $('#sessionLeft').textContent = eng.queueLength;
  $('#sessionProgress').style.width = eng.targetsTotal ? ((eng.done / eng.targetsTotal) * 100) + '%' : '0%';

  $('#startSessionBtn').classList.toggle('hidden', eng.state !== 'idle');
  $('#pauseSessionBtn').classList.toggle('hidden', eng.state !== 'running');
  $('#resumeSessionBtn').classList.toggle('hidden', eng.state !== 'paused');
  $('#stopSessionBtn').classList.toggle('hidden', eng.state === 'idle');
  $('#startSessionBtn').disabled = eng.state === 'idle' && state.selected.size === 0;
  $('#startSelectionCount').textContent = state.selected.size;
}

/* ─── liste des followers ─────────────────────────────────── */
function escapeAttr(s) { return esc(s); }

async function loadFollowers() {
  const params = new URLSearchParams({ q: state.q, filter: state.filter, sort: state.sort });
  try {
    const data = await api('/api/followers?' + params.toString());
    renderFollowers(data.followers || []);
  } catch (err) {
    toast('Impossible de charger la liste : ' + err.message, 'error');
  }
}

function renderFollowers(list) {
  state.currentIds = list.map(f => f.id);
  const wrap = $('#followersList');
  $('#emptyState').classList.toggle('hidden', list.length > 0);

  wrap.innerHTML = list.map(f => {
    const removed = f.status === 'removed';
    const bot = f.botHint === 'élevé'
      ? '<span class="badge bot-high">indice bot élevé</span>'
      : (f.botHint === 'moyen' ? '<span class="badge bot-mid">indice bot moyen</span>' : '');
    const mutual = f.mutual ? '<span class="badge mutual">mutuel</span>' : '';
    const src = f.source === 'import' ? '<span class="badge src">importé</span>' : '<span class="badge src">démo</span>';
    const followed = new Date(f.followedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const checked = state.selected.has(f.id) ? ' checked' : '';
    const actionBtn = removed
      ? '<button class="btn btn-ghost remove-btn" data-restore="' + esc(f.id) + '">Restaurer</button>'
      : '<button class="btn btn-danger-ghost remove-btn" data-remove="' + esc(f.id) + '">Retirer</button>';
    const removedBadge = removed ? '<span class="badge removed-badge">retiré</span>' : '';
    return (
      '<div class="follower-row' + (removed ? ' removed' : '') + '" data-id="' + esc(f.id) + '">' +
        '<input type="checkbox" class="row-check" data-id="' + esc(f.id) + '" aria-label="Sélectionner ' + escapeAttr(f.handle) + '"' + (removed ? ' disabled' : '') + checked + '>' +
        '<div class="avatar" style="--hue:' + Number(f.hue || 0) + '">' + esc(f.initials || '?') + '</div>' +
        '<div class="follower-meta">' +
          '<div class="follower-top"><span class="follower-handle">' + esc(f.handle) + '</span>' +
            '<span class="follower-name">' + esc(f.name || '') + '</span>' + mutual + bot + src + removedBadge + '</div>' +
          (f.bio ? '<div class="follower-bio">' + esc(f.bio) + '</div>' : '') +
          '<div class="follower-foot"><span>suivi depuis le ' + esc(followed) + '</span><span>' + fmtNum(f.followersCount) + ' abonnés</span><span>suit ' + fmtNum(f.followingCount) + '</span></div>' +
        '</div>' +
        actionBtn +
      '</div>'
    );
  }).join('');

  // Délégation d'événements
  $$('.row-check', wrap).forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) state.selected.add(cb.dataset.id); else state.selected.delete(cb.dataset.id);
    updateSelectionUI();
  }));
  $$('[data-remove]', wrap).forEach(btn => btn.addEventListener('click', () => removeFollower(btn.dataset.remove, btn)));
  $$('[data-restore]', wrap).forEach(btn => btn.addEventListener('click', () => restoreFollower(btn.dataset.restore)));

  updateSelectionUI();
  updateStats();
  renderStatus(); // re-applique l'état des boutons Retirer
}

function updateSelectionUI() {
  const info = $('#selectionInfo');
  info.textContent = 'Sélection : ' + state.selected.size + ' cible' + (state.selected.size > 1 ? 's' : '');
  $('#startFromSelectionBtn').disabled = state.selected.size === 0;
  $('#startSelectionCount').textContent = state.selected.size;
  const all = $('#selectAllBox');
  const selectable = state.currentIds.filter(id => {
    const row = $('.follower-row[data-id="' + id + '"] .row-check');
    return row && !row.disabled;
  });
  const checkedCount = selectable.filter(id => state.selected.has(id)).length;
  all.checked = selectable.length > 0 && checkedCount === selectable.length;
  all.indeterminate = checkedCount > 0 && checkedCount < selectable.length;
}

async function updateStats() {
  try {
    const [active, removed, suspect] = await Promise.all([
      api('/api/followers?filter=active'),
      api('/api/followers?filter=removed'),
      api('/api/followers?filter=suspect'),
    ]);
    $('#statActive').textContent = active.total;
    $('#statRemoved').textContent = removed.total;
    $('#statSuspect').textContent = suspect.total;
    $('#tabCount').textContent = active.total;
  } catch { /* silencieux */ }
}

$('#selectAllBox').addEventListener('change', (e) => {
  const checked = e.target.checked;
  $$('.row-check').forEach(cb => {
    if (cb.disabled) return;
    cb.checked = checked;
    if (checked) state.selected.add(cb.dataset.id); else state.selected.delete(cb.dataset.id);
  });
  updateSelectionUI();
});

// Recherche débouncée + tri + filtres
let searchTimer = null;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadFollowers(); }, 160);
});
$('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; loadFollowers(); });
$('#filterChips').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip'); if (!btn) return;
  state.filter = btn.dataset.filter;
  $$('#filterChips .chip').forEach(c => c.classList.toggle('active', c === btn));
  loadFollowers();
});

async function removeFollower(id, btn) {
  if (btn) btn.disabled = true;
  try {
    await api('/api/followers/' + encodeURIComponent(id) + '/remove', { method: 'POST' });
    state.selected.delete(id);
    toast('Geste enregistré — comme au doigt.', 'success');
    await Promise.all([loadFollowers(), refreshStatus()]);
  } catch (err) {
    toast(err.message, 'error');
    await refreshStatus(); // re-synchronise les boutons
    if (btn) btn.disabled = false;
  }
}

async function restoreFollower(id) {
  try {
    await api('/api/followers/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
    toast('Compte restauré dans la liste.', 'success');
    await loadFollowers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#importBtn').addEventListener('click', async () => {
  const text = $('#importText').value;
  $('#importResult').textContent = '';
  try {
    const out = await api('/api/import', { method: 'POST', body: JSON.stringify({ text }) });
    $('#importResult').textContent = out.imported + ' importé(s), ' + out.skipped + ' ignoré(s)/doublon(s).';
    $('#importText').value = '';
    await loadFollowers();
  } catch (err) {
    $('#importResult').textContent = err.message;
  }
});

/* ─── session assistée ────────────────────────────────────── */
$('#startFromSelectionBtn').addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length) return;
  try {
    await api('/api/session/start', { method: 'POST', body: JSON.stringify({ ids }) });
    toast('Session démarrée — à rythme humain.', 'success');
    state.selected.clear();
    gotoTab('session');
    await Promise.all([loadFollowers(), refreshStatus()]);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#startSessionBtn').addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length) { toast('Sélectionnez des cibles dans l’onglet Abonnés.', 'error'); return; }
  try {
    await api('/api/session/start', { method: 'POST', body: JSON.stringify({ ids }) });
    state.selected.clear();
    toast('Session démarrée.', 'success');
    await Promise.all([loadFollowers(), refreshStatus()]);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#pauseSessionBtn').addEventListener('click', () => api('/api/session/pause', { method: 'POST' }).then(refreshStatus).catch(e => toast(e.message, 'error')));
$('#resumeSessionBtn').addEventListener('click', () => api('/api/session/resume', { method: 'POST' }).then(refreshStatus).catch(e => toast(e.message, 'error')));
$('#stopSessionBtn').addEventListener('click', () => api('/api/session/stop', { method: 'POST' }).then(refreshStatus).catch(e => toast(e.message, 'error')));

/* ─── aperçu du plan ──────────────────────────────────────── */
async function loadPlan() {
  try {
    const data = await api('/api/plan?n=12');
    state.plan = data.plan || [];
    $('#planList').innerHTML = state.plan.map(p => (
      '<li class="plan-item' + (p.longPause ? ' long-pause' : '') + '">' +
        '<span class="plan-idx">' + p.index + '</span>' +
        '<span class="plan-time">' + esc(fmtPlanTime(p.at)) + '</span>' +
        (p.longPause ? '<span class="plan-tag">longue pause</span>' : '') +
      '</li>'
    )).join('');
  } catch (err) {
    $('#planList').innerHTML = '<li class="plan-item"><span class="plan-time">Projection indisponible : ' + esc(err.message) + '</span></li>';
  }
}
$('#refreshPlanBtn').addEventListener('click', loadPlan);

/* ─── réglages ────────────────────────────────────────────── */
const PROFILE_PRESETS = { calme: true, naturel: true, soutenu: true };
let settingsDirty = false;

function fmtMin(v) { return String(Math.round(v * 100) / 100).replace('.', ',') + ' min'; }

function bindRange(id, outId, fmt) {
  const input = $('#' + id), out = $('#' + outId);
  const render = () => { out.textContent = fmt(Number(input.value)); };
  input.addEventListener('input', () => { render(); markCustom(); });
  render();
}
bindRange('minMinutes', 'minMinutesValue', v => fmtMin(v));
bindRange('maxMinutes', 'maxMinutesValue', v => fmtMin(v));
bindRange('dailyCap', 'dailyCapValue', v => String(Math.round(v)));
bindRange('hesitation', 'hesitationValue', v => Math.round(v * 100) + ' %');
bindRange('pauseEvery', 'pauseEveryValue', v => v === 0 ? 'jamais' : String(Math.round(v)));

function markCustom() {
  settingsDirty = true;
  $$('#profileGrid .profile-card').forEach(c => c.classList.remove('active'));
}

$('#profileGrid').addEventListener('click', async (e) => {
  const card = e.target.closest('.profile-card'); if (!card) return;
  $$('#profileGrid .profile-card').forEach(c => c.classList.toggle('active', c === card));
  settingsDirty = false;
  try {
    const out = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ profile: card.dataset.profile }) });
    applySettingsToForm(out.settings);
    toast('Profil « ' + card.dataset.profile + ' » appliqué.', 'success');
    loadPlan();
  } catch (err) {
    toast(err.message, 'error');
  }
});

function applySettingsToForm(s) {
  $('#minMinutes').value = s.minMinutes; $('#minMinutesValue').textContent = fmtMin(s.minMinutes);
  $('#maxMinutes').value = s.maxMinutes; $('#maxMinutesValue').textContent = fmtMin(s.maxMinutes);
  $('#dailyCap').value = s.dailyCap; $('#dailyCapValue').textContent = Math.round(s.dailyCap);
  $('#hesitation').value = s.hesitation; $('#hesitationValue').textContent = Math.round(s.hesitation * 100) + ' %';
  $('#pauseEvery').value = s.pauseEvery; $('#pauseEveryValue').textContent = s.pauseEvery === 0 ? 'jamais' : s.pauseEvery;
  $('#longPauseMin').value = s.longPauseMin; $('#longPauseMax').value = s.longPauseMax;
  $('#dayStart').value = s.dayStart; $('#dayEnd').value = s.dayEnd;
  if (PROFILE_PRESETS[s.profile]) {
    $$('#profileGrid .profile-card').forEach(c => c.classList.toggle('active', c.dataset.profile === s.profile));
  }
}

async function loadSettings() {
  try {
    const data = await api('/api/settings');
    applySettingsToForm(data.settings);
  } catch (err) {
    toast('Réglages illisibles : ' + err.message, 'error');
  }
}

$('#saveSettingsBtn').addEventListener('click', async () => {
  const body = {
    profile: 'personnalisé',
    minMinutes: Number($('#minMinutes').value),
    maxMinutes: Number($('#maxMinutes').value),
    dailyCap: Number($('#dailyCap').value),
    hesitation: Number($('#hesitation').value),
    pauseEvery: Number($('#pauseEvery').value),
    longPauseMin: Number($('#longPauseMin').value),
    longPauseMax: Number($('#longPauseMax').value),
    dayStart: $('#dayStart').value || '09:00',
    dayEnd: $('#dayEnd').value || '22:30',
  };
  try {
    const out = await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    applySettingsToForm(out.settings);
    toast('Cadence enregistrée.', 'success');
    loadPlan();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#resetDemoBtn').addEventListener('click', async () => {
  if (!confirm('Réinitialiser les données de démonstration ? Les compteurs et la liste reviennent à zéro.')) return;
  try {
    await api('/api/reset', { method: 'POST' });
    state.selected.clear();
    toast('Données de démo réinitialisées.', 'success');
    await Promise.all([loadFollowers(), refreshStatus(), loadPlan(), loadSettings()]);
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ─── journal (SSE + historique) ──────────────────────────── */
const journalList = $('#journalList');
const KIND_LABEL = { info: 'info', success: 'ok', warn: 'pause', error: 'erreur' };

function appendJournal(entry, scroll) {
  if (journalList.querySelector('.journal-empty')) journalList.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'journal-item ' + (entry.kind || 'info');
  const t = new Date(entry.ts);
  li.innerHTML = '<time>' + esc(t.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' + t.toLocaleTimeString('fr-FR')) + ' · ' + esc(KIND_LABEL[entry.kind] || entry.kind || 'info') + '</time>' + esc(entry.message);
  journalList.appendChild(li);
  while (journalList.children.length > 120) journalList.removeChild(journalList.firstChild);
  if (scroll !== false) journalList.scrollTop = journalList.scrollHeight;
}

async function loadJournal() {
  try {
    const data = await api('/api/journal');
    journalList.innerHTML = '';
    if (!data.journal.length) {
      journalList.innerHTML = '<li class="journal-empty">Rien pour l’instant — les gestes apparaîtront ici en direct.</li>';
      return;
    }
    data.journal.forEach(e => appendJournal(e, false));
    journalList.scrollTop = journalList.scrollHeight;
  } catch { /* silencieux */ }
}

$('#clearJournalBtn').addEventListener('click', async () => {
  try { await api('/api/journal/clear', { method: 'POST' }); journalList.innerHTML = '<li class="journal-empty">Journal effacé.</li>'; }
  catch (err) { toast(err.message, 'error'); }
});

$('#disconnectBtn').addEventListener('click', async () => {
  try {
    await api('/api/disconnect', { method: 'POST' });
    toast('Compte délié — jeton effacé de la mémoire.', 'success');
    refreshStatus();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#connectionPill').addEventListener('click', (e) => {
  if (e.target.closest('#disconnectBtn')) return;
  const conn = state.status && state.status.connection;
  if (conn && conn.connected) return;
  if (conn && conn.configured) window.location.href = '/auth/tiktok';
  else toast('OAuth non configuré : renseignez TIKTOK_CLIENT_KEY / SECRET dans .env (voir README).', 'error');
});

/* ─── flux SSE ────────────────────────────────────────────── */
const sse = new EventSource('/api/events');
sse.addEventListener('journal', (ev) => { try { appendJournal(JSON.parse(ev.data)); } catch { /* ignore */ } });
sse.addEventListener('status', () => refreshStatus());

/* ─── tic d'une seconde : compte à rebours & refroidissement ─ */
setInterval(() => {
  const s = state.status;
  if (s && s.engine) {
    const eng = s.engine;
    if (eng.state === 'running' && eng.nextAt) {
      $('#nextActionTimer').textContent = fmtCountdown(eng.nextAt - Date.now());
      $('#nextActionKind').textContent = eng.nextLabel ? '· ' + eng.nextLabel : '';
    } else if (eng.state === 'paused') {
      $('#nextActionTimer').textContent = '––:––';
      $('#nextActionKind').textContent = 'en pause — reprenez quand vous voulez';
    } else {
      $('#nextActionTimer').textContent = '––:––';
      $('#nextActionKind').textContent = 'en attente de démarrage';
    }
    // décompte du refroidissement, rafraîchi localement entre deux polls
    if (!s.canAct.ok && s.canAct.code === 'cooldown' && s.canAct.retryAfterMs != null) {
      s.canAct.retryAfterMs = Math.max(0, s.canAct.retryAfterMs - 1000);
      $('#cooldownLine').textContent = 'Prochain geste manuel : encore ' + Math.ceil(s.canAct.retryAfterMs / 1000) + ' s';
    }
  }
}, 1000);

// re-poll complet toutes les 5 s (corrige toute dérive locale)
setInterval(refreshStatus, 5000);

/* ─── démarrage ───────────────────────────────────────────── */
(async function boot() {
  if (new URLSearchParams(location.search).get('connected') === '1') {
    toast('Compte TikTok lié avec succès.', 'success');
    history.replaceState(null, '', '/');
  }
  await Promise.all([refreshStatus(), loadFollowers(), loadJournal(), loadPlan(), loadSettings()]);
})();
