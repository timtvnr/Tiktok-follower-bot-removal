/* Sillage — interface simple : choisir, cliquer, laisser faire. */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');

async function api(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  let data = null;
  try { data = await res.json(); } catch { /* non JSON */ }
  if (!res.ok) { const e = new Error((data && data.error) || 'Erreur ' + res.status); e.status = res.status; e.payload = data; throw e; }
  return data;
}

function toast(message, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.ceil((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? h + ' h ' + String(m).padStart(2, '0') : String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
};
const fmtAgo = (ts) => {
  if (!ts) return null;
  const d = Date.now() - ts;
  if (d < 45000) return 'à l’instant';
  const m = Math.floor(d / 60000);
  return m < 60 ? 'il y a ' + m + ' min' : 'il y a ' + Math.floor(m / 60) + ' h';
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* ─── état ─── */
const state = {
  all: [],          // toutes les cibles (y compris retirées)
  filter: 'suspect',
  sort: 'recent',
  q: '',
  selected: new Set(),
  status: null,
};

const isActive = f => f.status === 'active';
const isSuspect = f => f.botHint === 'élevé';
const visible = () => {
  let list = state.all.slice();
  if (state.filter === 'suspect') list = list.filter(f => isActive(f) && isSuspect(f));
  else if (state.filter === 'mutual') list = list.filter(f => isActive(f) && f.mutual);
  else if (state.filter === 'removed') list = list.filter(f => f.status === 'removed');
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter(f => (f.handle + ' ' + (f.name || '') + ' ' + (f.bio || '')).toLowerCase().includes(q));
  }
  const rank = { 'élevé': 0, 'moyen': 1, 'faible': 2 };
  if (state.sort === 'suspicion') list.sort((a, b) => (rank[a.botHint] ?? 3) - (rank[b.botHint] ?? 3));
  else if (state.sort === 'alpha') list.sort((a, b) => a.handle.localeCompare(b.handle));
  else list.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
  return list;
};
const counts = () => ({
  suspect: state.all.filter(f => isActive(f) && isSuspect(f)).length,
  mutual: state.all.filter(f => isActive(f) && f.mutual).length,
  all: state.all.length,
  removed: state.all.filter(f => f.status === 'removed').length,
});

/* ─── chargement & rendu de la liste ─── */
async function loadFollowers() {
  try {
    const data = await api('/api/followers?filter=all&sort=recent&q=');
    state.all = data.followers || [];
    // purge la sélection des comptes devenus inactifs/retirés
    const activeIds = new Set(state.all.filter(isActive).map(f => f.id));
    for (const id of [...state.selected]) if (!activeIds.has(id)) state.selected.delete(id);
    renderAll();
  } catch (err) {
    toast('Liste illisible : ' + err.message, 'error');
  }
}

function renderAll() {
  const c = counts();
  $('#nSuspect').textContent = c.suspect;
  $('#nMutual').textContent = c.mutual;
  $('#nAll').textContent = c.all;
  $('#nRemoved').textContent = c.removed;

  const list = visible();
  $('#emptyState').classList.toggle('hidden', list.length > 0);

  $('#followersList').innerHTML = list.map(f => {
    const removed = f.status === 'removed';
    const checked = state.selected.has(f.id);
    const reason = isSuspect(f)
      ? '<b>⚠ suspect</b> · suit ' + fmtNum(f.followingCount) + ' / suivi par ' + fmtNum(f.followersCount)
      : (f.mutual ? 'mutuel · suivi depuis le ' + fmtDate(f.followedAt) : 'suivi depuis le ' + fmtDate(f.followedAt));
    return (
      '<div class="row' + (removed ? ' removed' : '') + (checked ? ' checked' : '') + '" data-id="' + esc(f.id) + '">' +
        (removed
          ? '<span></span>'
          : '<input type="checkbox" class="row-check" data-id="' + esc(f.id) + '" aria-label="Cocher ' + esc(f.handle) + '"' + (checked ? ' checked' : '') + '>') +
        '<div class="avatar" style="--hue:' + Number(f.hue || 0) + '">' + esc(f.initials || '?') + '</div>' +
        '<div class="row-meta">' +
          '<div class="row-top"><span class="row-handle">' + esc(f.handle) + '</span><span class="row-name">' + esc(f.name || '') + '</span></div>' +
          '<div class="row-reason">' + reason + '</div>' +
        '</div>' +
        (removed
          ? '<button class="row-action restore" data-restore="' + esc(f.id) + '">↩ Restaurer</button>'
          : '<button class="row-action" data-remove="' + esc(f.id) + '">Retirer</button>') +
      '</div>'
    );
  }).join('');

  // Interactions : la rangée entière bascule la case (sauf bouton)
  $$('.row', $('#followersList')).forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const cb = $('.row-check', row); if (!cb) return;
    cb.checked = !cb.checked;
    toggleSelect(cb.dataset.id, cb.checked, row);
  }));
  $$('.row-check', $('#followersList')).forEach(cb => cb.addEventListener('change', () => toggleSelect(cb.dataset.id, cb.checked, cb.closest('.row'))));
  $$('[data-remove]', $('#followersList')).forEach(b => b.addEventListener('click', () => removeOne(b.dataset.remove, b)));
  $$('[data-restore]', $('#followersList')).forEach(b => b.addEventListener('click', () => restoreOne(b.dataset.restore)));

  updateSelectionUI();
  renderStatus();
}

function toggleSelect(id, on, row) {
  if (on) state.selected.add(id); else state.selected.delete(id);
  if (row) row.classList.toggle('checked', on);
  updateSelectionUI();
}

function updateSelectionUI() {
  const n = state.selected.size;
  $('#selectionInfo').textContent = n + (n > 1 ? ' comptes cochés' : ' compte coché');
  const visibleIds = visible().filter(isActive).map(f => f.id);
  const checkedVisible = visibleIds.filter(id => state.selected.has(id)).length;
  const all = $('#selectAllBox');
  all.checked = visibleIds.length > 0 && checkedVisible === visibleIds.length;
  all.indeterminate = checkedVisible > 0 && checkedVisible < visibleIds.length;
  renderPrimary();
}

$('#selectAllBox').addEventListener('change', (e) => {
  const on = e.target.checked;
  $$('.row-check', $('#followersList')).forEach(cb => {
    cb.checked = on;
    const row = cb.closest('.row');
    if (on) state.selected.add(cb.dataset.id); else state.selected.delete(cb.dataset.id);
    if (row) row.classList.toggle('checked', on);
  });
  updateSelectionUI();
});
$('#selectSuspectsBtn').addEventListener('click', () => {
  state.all.filter(f => isActive(f) && isSuspect(f)).forEach(f => state.selected.add(f.id));
  renderAll();
  toast('Suspects cochés — vérifiez, puis cliquez sur le gros bouton.', 'success');
});
$('#filterChips').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip'); if (!btn) return;
  state.filter = btn.dataset.filter;
  $$('#filterChips .chip').forEach(c => c.classList.toggle('active', c === btn));
  renderAll();
});
let searchT = null;
$('#searchInput').addEventListener('input', (e) => { clearTimeout(searchT); searchT = setTimeout(() => { state.q = e.target.value.trim(); renderAll(); }, 150); });
$('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; renderAll(); });

async function removeOne(id, btn) {
  if (btn) btn.disabled = true;
  try {
    await api('/api/followers/' + encodeURIComponent(id) + '/remove', { method: 'POST' });
    state.selected.delete(id);
    toast('Geste enregistré.', 'success');
    await Promise.all([loadFollowers(), refreshStatus()]);
  } catch (err) {
    toast(err.message, 'error');
    if (btn) btn.disabled = false;
    refreshStatus();
  }
}
async function restoreOne(id) {
  try { await api('/api/followers/' + encodeURIComponent(id) + '/restore', { method: 'POST' }); await loadFollowers(); }
  catch (err) { toast(err.message, 'error'); }
}

$('#importBtn').addEventListener('click', async () => {
  try {
    const out = await api('/api/import', { method: 'POST', body: JSON.stringify({ text: $('#importText').value }) });
    $('#importResult').textContent = out.imported + ' importé(s), ' + out.skipped + ' ignoré(s).';
    $('#importText').value = '';
    await loadFollowers();
  } catch (err) { $('#importResult').textContent = err.message; }
});

/* ─── statut temps réel ─── */
async function refreshStatus() {
  try { state.status = await api('/api/status'); } catch { return; }
  renderStatus();
}

function renderStatus() {
  const s = state.status; if (!s) return;
  const conn = s.connection || {};

  const pill = $('#connectionPill');
  pill.classList.toggle('connected', !!conn.connected);
  $('#disconnectBtn').classList.toggle('hidden', !conn.connected);
  $('#connectionText').textContent = conn.connected
    ? (conn.displayName || 'Compte lié') + (conn.followerCount != null ? ' · ' + fmtNum(conn.followerCount) + ' abonnés' : '')
    : (conn.configured ? 'Lier mon compte TikTok' : 'Mode démo (OAuth non configuré)');

  $('#demoBanner').classList.toggle('hidden', s.mode === 'gateway');
  $('#todayPill').textContent = 'Aujourd’hui : ' + s.daily.count + '/' + s.daily.cap;

  // Refroidissement / plafond / plage
  const cd = $('#cooldownText');
  if (!s.canAct.ok) {
    cd.classList.add('waiting');
    if (s.canAct.code === 'cooldown') cd.textContent = 'Prochain geste possible dans ' + Math.ceil((s.canAct.retryAfterMs || 0) / 1000) + ' s';
    else if (s.canAct.code === 'daily_cap') cd.textContent = 'Plafond du jour atteint — à demain';
    else cd.textContent = 'Hors plage d’activité — reprise à l’ouverture';
  } else {
    cd.classList.remove('waiting');
    cd.textContent = 'Geste possible maintenant';
  }

  // Boutons « Retirer » des lignes
  $$('[data-remove]').forEach(b => { b.disabled = !s.canAct.ok; });

  renderPrimary();
}

function renderPrimary() {
  const s = state.status;
  const btn = $('#primaryBtn'), stop = $('#stopBtn');
  const label = $('#primaryBtnLabel'), sub = $('#primaryBtnSub');
  const kicker = $('#heroKicker'), title = $('#heroTitle'), heroSub = $('#heroSub');
  const n = state.selected.size;
  const eng = s && s.engine;

  stop.classList.toggle('hidden', !eng || eng.state === 'idle');

  if (eng && eng.state === 'running') {
    kicker.textContent = 'Étape 2 — retrait en cours';
    title.textContent = 'On y va, doucement';
    heroSub.textContent = eng.queueLength + ' cible(s) restante(s) — pause automatique hors plage, plafond du jour respecté.';
    label.textContent = 'Suspendre';
    sub.textContent = 'la session tourne — touchez pour souffler';
    btn.disabled = false;
    btn.dataset.mode = 'pause';
  } else if (eng && eng.state === 'paused') {
    kicker.textContent = 'Session en pause';
    title.textContent = 'On attend votre feu vert';
    heroSub.textContent = 'Suspendue par vous — rien ne bouge tant que vous ne reprenez pas.';
    label.textContent = 'Reprendre';
    sub.textContent = 'dernière cible dans la file, on repart';
    btn.disabled = false;
    btn.dataset.mode = 'resume';
  } else {
    kicker.textContent = 'Étape 1 — choisissez les comptes';
    title.textContent = n ? 'On retire ' + n + ' compte' + (n > 1 ? 's' : '') + ' ?' : 'Qui retire-t-on ?';
    heroSub.textContent = n
      ? 'Le gros bouton lance une session à cadence humaine : délais en cloche, pauses, hésitations — vous gardez la main à chaque instant.'
      : 'Cochez ci-dessous — ou « Cocher les suspects » pour pré-sélectionner les comptes douteux.';
    label.textContent = 'Retirer la sélection';
    sub.textContent = n ? n + ' compte' + (n > 1 ? 's' : '') + ' coché' + (n > 1 ? 's' : '') : 'cochez d’abord des comptes';
    btn.disabled = n === 0;
    btn.dataset.mode = 'start';
  }
}

$('#primaryBtn').addEventListener('click', async () => {
  const mode = $('#primaryBtn').dataset.mode || 'start';
  try {
    if (mode === 'pause') { await api('/api/session/pause', { method: 'POST' }); }
    else if (mode === 'resume') { await api('/api/session/resume', { method: 'POST' }); }
    else {
      const ids = [...state.selected];
      if (!ids.length) return;
      await api('/api/session/start', { method: 'POST', body: JSON.stringify({ ids }) });
      state.selected.clear();
      toast('Session démarrée — à rythme humain.', 'success');
      await loadFollowers();
    }
    await refreshStatus();
  } catch (err) { toast(err.message, 'error'); refreshStatus(); }
});
$('#stopBtn').addEventListener('click', async () => {
  try { await api('/api/session/stop', { method: 'POST' }); toast('Session arrêtée.', 'success'); await refreshStatus(); }
  catch (err) { toast(err.message, 'error'); }
});

/* ─── anneau de progression ─── */
const RING_C = 2 * Math.PI * 52; // r = 52
$('#ringFg').style.strokeDasharray = RING_C.toFixed(1);

function renderRing() {
  const s = state.status; if (!s) return;
  const eng = s.engine;
  const timer = $('#ringTimer'), label = $('#ringLabel'), fg = $('#ringFg');
  if (eng.state === 'running' || eng.state === 'paused') {
    if (eng.targetsTotal > 0) {
      const frac = eng.done / eng.targetsTotal;
      fg.style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(1);
    }
    if (eng.state === 'running' && eng.nextAt) {
      timer.textContent = fmtCountdown(eng.nextAt - Date.now());
      label.textContent = eng.nextLabel || 'geste';
    } else {
      timer.textContent = '––:––';
      label.textContent = 'en pause';
    }
  } else {
    fg.style.strokeDashoffset = RING_C.toFixed(1);
    timer.textContent = '––:––';
    label.textContent = 'en attente';
  }
}

/* ─── cadence : 3 boutons ─── */
$('#profileGrid').addEventListener('click', async (e) => {
  const card = e.target.closest('.pace'); if (!card) return;
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ profile: card.dataset.profile }) });
    $$('#profileGrid .pace').forEach(p => p.classList.toggle('active', p === card));
    toast('Cadence « ' + card.dataset.profile + ' ».', 'success');
    refreshStatus();
  } catch (err) { toast(err.message, 'error'); }
});

$('#dailyCap').addEventListener('input', e => { $('#dailyCapValue').textContent = e.target.value; });
$('#hesitation').addEventListener('input', e => { $('#hesitationValue').textContent = Math.round(e.target.value * 100) + ' %'; });
$('#pauseEvery').addEventListener('input', e => { $('#pauseEveryValue').textContent = e.target.value === '0' ? 'jamais' : e.target.value; });

$('#saveSettingsBtn').addEventListener('click', async () => {
  try {
    const current = (await api('/api/settings')).settings; // préserve min/max & pauses non affichées
    const body = {
      ...current,
      profile: 'personnalisé',
      dailyCap: Number($('#dailyCap').value),
      hesitation: Number($('#hesitation').value),
      pauseEvery: Number($('#pauseEvery').value),
      dayStart: $('#dayStart').value || '09:00',
      dayEnd: $('#dayEnd').value || '22:30',
    };
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    toast('Réglages enregistrés.', 'success');
    refreshStatus();
  } catch (err) { toast(err.message, 'error'); }
});
$('#resetDemoBtn').addEventListener('click', async () => {
  if (!confirm('Réinitialiser la démo ? Les compteurs et la liste reviennent à zéro.')) return;
  try { await api('/api/reset', { method: 'POST' }); state.selected.clear(); await Promise.all([loadFollowers(), refreshStatus()]); toast('Démo réinitialisée.', 'success'); }
  catch (err) { toast(err.message, 'error'); }
});

/* ─── journal ─── */
const journalList = $('#journalList');
function appendJournal(entry) {
  if (journalList.querySelector('.journal-empty')) journalList.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'journal-item ' + (entry.kind || 'info');
  const d = new Date(entry.ts);
  li.innerHTML = '<time>' + esc(fmtTime(d)) + '</time>' + esc(entry.message);
  journalList.appendChild(li);
  while (journalList.children.length > 80) journalList.removeChild(journalList.firstChild);
  journalList.scrollTop = journalList.scrollHeight;
}
async function loadJournal() {
  try {
    const data = await api('/api/journal');
    journalList.innerHTML = '';
    if (!data.journal.length) { journalList.innerHTML = '<li class="journal-empty hint">Rien pour l’instant — vos gestes s’afficheront ici.</li>'; return; }
    data.journal.forEach(appendJournal);
  } catch { /* silencieux */ }
}
$('#clearJournalBtn').addEventListener('click', async () => {
  try { await api('/api/journal/clear', { method: 'POST' }); journalList.innerHTML = '<li class="journal-empty hint">Journal effacé.</li>'; }
  catch (err) { toast(err.message, 'error'); }
});

/* ─── connexion TikTok ─── */
$('#connectionPill').addEventListener('click', (e) => {
  if (e.target.closest('#disconnectBtn')) {
    e.stopPropagation();
    api('/api/disconnect', { method: 'POST' }).then(refreshStatus).catch(err => toast(err.message, 'error'));
    return;
  }
  const conn = state.status && state.status.connection;
  if (conn && conn.connected) return;
  if (conn && conn.configured) window.location.href = '/auth/tiktok';
  else toast('OAuth non configuré : renseignez TIKTOK_CLIENT_KEY / SECRET dans .env (README).', 'error');
});

/* ─── SSE + minuteries ─── */
const sse = new EventSource('/api/events');
sse.addEventListener('journal', (ev) => { try { appendJournal(JSON.parse(ev.data)); } catch { /* ignore */ } });
sse.addEventListener('status', () => refreshStatus());

setInterval(() => {
  const s = state.status;
  if (s && !s.canAct.ok && s.canAct.code === 'cooldown') {
    s.canAct.retryAfterMs = Math.max(0, (s.canAct.retryAfterMs || 0) - 1000);
    const cd = $('#cooldownText');
    cd.textContent = 'Prochain geste possible dans ' + Math.ceil(s.canAct.retryAfterMs / 1000) + ' s';
    if (s.canAct.retryAfterMs === 0) refreshStatus();
  }
  renderRing();
}, 1000);
setInterval(refreshStatus, 5000);

/* ─── démarrage ─── */
(async function boot() {
  if (new URLSearchParams(location.search).get('connected') === '1') {
    toast('Compte TikTok lié.', 'success');
    history.replaceState(null, '', '/');
  }
  await Promise.all([refreshStatus(), loadFollowers(), loadJournal()]);
  // refléter les réglages serveur dans les contrôles avancés
  try {
    const data = await api('/api/settings');
    const s = data.settings;
    $('#dailyCap').value = s.dailyCap; $('#dailyCapValue').textContent = s.dailyCap;
    $('#hesitation').value = s.hesitation; $('#hesitationValue').textContent = Math.round(s.hesitation * 100) + ' %';
    $('#pauseEvery').value = s.pauseEvery; $('#pauseEveryValue').textContent = s.pauseEvery === 0 ? 'jamais' : s.pauseEvery;
    $('#dayStart').value = s.dayStart; $('#dayEnd').value = s.dayEnd;
    $$('#profileGrid .pace').forEach(p => p.classList.toggle('active', p.dataset.profile === s.profile));
  } catch { /* réglages optionnels à l'écran */ }
  renderRing();
})();
