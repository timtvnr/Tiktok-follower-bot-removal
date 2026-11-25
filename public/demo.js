/* Sillage — version STATIQUE (GitHub Pages)
   Simulation 100 % locale : aucun serveur, aucun appel réseau, données en localStorage.
   Même cadence humaine que l'app complète (délais en cloche, longues pauses, hésitations,
   plage horaire, plafonds 45 s / 200 par jour) — mais garde-fous côté navigateur seulement. */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');

/* ─── toasts ─── */
function toast(message, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4200);
}

/* ─── helpers temps ─── */
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
const todayKey = (d) => { const t = d || new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };

/* ─── cadence humaine (port de server/humanize.js) ─── */
const HARD_MIN_INTERVAL_MS = 45 * 1000;
const HARD_DAILY_CAP = 200;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function randNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function sampleDelayMs(minMs, maxMs) {
  if (maxMs < minMs) { const t = minMs; minMs = maxMs; maxMs = t; }
  const mean = (minMs + maxMs) / 2, sd = (maxMs - minMs) / 6;
  return clamp(Math.round(mean + randNormal() * sd), Math.round(minMs), Math.round(maxMs));
}
function parseHHMM(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return fallback;
  const h = +m[1], mi = +m[2];
  return (h > 23 || mi > 59) ? fallback : h * 60 + mi;
}
const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
function isWithinActiveHours(date, dayStart, dayEnd) {
  const s = parseHHMM(dayStart, 540), e = parseHHMM(dayEnd, 1350), now = minutesOfDay(date);
  if (s === e) return true;
  if (s < e) return now >= s && now < e;
  return now >= s || now < e;
}
function msUntilActiveHours(date, dayStart, dayEnd) {
  if (isWithinActiveHours(date, dayStart, dayEnd)) return 0;
  const start = parseHHMM(dayStart, 540), nowMin = minutesOfDay(date);
  const diff = start > nowMin ? start - nowMin : (1440 - nowMin) + start;
  return Math.max(1000, Math.round(diff * 60000));
}
function nextDelayMs(settings, done) {
  const base = sampleDelayMs(settings.minMinutes * 60000, settings.maxMinutes * 60000);
  const every = +settings.pauseEvery || 0;
  if (every > 0 && done > 0 && done % every === 0) {
    const extra = sampleDelayMs(settings.longPauseMin * 60000, settings.longPauseMax * 60000);
    return { delayMs: base + extra, longPause: true, extraMs: extra };
  }
  return { delayMs: base, longPause: false, extraMs: 0 };
}

/* ─── données de démo (port de server/demo-data.js) ─── */
const NAMES = [['Léa','Martin'],['Hugo','Bernard'],['Chloé','Dubois'],['Nathan','Petit'],['Emma','Moreau'],['Louis','Garcia'],['Jade','Roux'],['Gabriel','Fontaine'],['Manon','Chevalier'],['Raphaël','Fournier'],['Camille','Girard'],['Jules','Bonnet'],['Sarah','Lambert'],['Arthur','Collet'],['Inès','Renard'],['Adam','Barbier'],['Louise','Perrot'],['Maël','Marchand'],['Anna','Leclerc'],['Tom','Nguyen'],['Nina','Colin'],['Evan','Perrin'],['Clara','Renault'],['Yanis','Faure'],['Lina','Olivier'],['Mila','Picard'],['Noah','Carpentier'],['Rose','Millet'],['Timéo','Laporte'],['Alicia','Deschamps'],['Sohan','Vasseur'],['Éloïse','Henry']];
const BIOS = ['', '', 'Créatrice · Paris', 'Photographe amateur', 'POV : mon chat', 'On parle ciné 🎬', 'Cuisine simple', '', 'Voyage & rando', 'Fitness, mollo', '1998 · Lyon', '', 'Musique tous les jours'];
const HANDLES = ['lea.martin_','hugobern','chloe_dbs','nathan.ptt','emma.moreau7','louisgarcia','jade.roux.__','gabefontaine','manonchevalier','raph_fournier','camille.grrd','jules_bonnet','sarahlmbert','aec','inesrenard','adam.barbier','louise_perrot','maelmrchd','anna.leclerc_','tom.nguyen88','nina.colin','evan.perrin_','clara.renault','yanisfaure','lina.olivier','mila_picard','noah.carpentier','rosemillet','timeo.laporte','alicia.dcp','sohan.vsr','eloise.henry'];
const SUSPECTS = new Set([4, 11, 17, 23, 29]);
function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seedFollowers() {
  const now = Date.now();
  return NAMES.map(([first, last], i) => {
    const h = HANDLES[i], hd = hash(h);
    const followedAt = new Date(now - (20 + (hd % 540)) * 86400000).toISOString();
    let followersCount = hd % 9 === 0 ? (hd % 40) : 200 + (hd % 48000);
    let followingCount = hd % 7 === 0 ? 4000 + (hd % 3000) : 80 + (hd % 900);
    let bio = BIOS[i % BIOS.length], botHint;
    if (SUSPECTS.has(i)) { bio = ''; followersCount = 2 + (hd % 38); followingCount = 1200 + (hd % 3500); botHint = 'élevé'; }
    else { const r = followersCount ? followingCount / followersCount : 99; botHint = r > 4 ? 'moyen' : 'faible'; if (botHint === 'faible' && bio === '' && hd % 3 === 0) botHint = 'moyen'; }
    return { id: 'demo-' + String(i + 1).padStart(2, '0'), handle: '@' + h, name: first + ' ' + last, initials: (first[0] + last[0]).toUpperCase(), hue: hd % 360, bio, followersCount, followingCount, followedAt, mutual: SUSPECTS.has(i) ? false : hd % 10 < 3, botHint, source: 'démo', status: 'active' };
  });
}
const DEFAULT_SETTINGS = { profile: 'naturel', minMinutes: 1.5, maxMinutes: 9, dailyCap: 50, dayStart: '09:00', dayEnd: '22:30', pauseEvery: 6, longPauseMin: 7, longPauseMax: 14, hesitation: 0.18 };
const PROFILES = { calme: { minMinutes: 2, maxMinutes: 12 }, naturel: { minMinutes: 1.5, maxMinutes: 9 }, soutenu: { minMinutes: 1, maxMinutes: 6 } };

/* ─── persistance locale ─── */
const KEY = 'sillage-state-v1';
let state;
function load() {
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
  if (!state || !Array.isArray(state.followers)) {
    state = { followers: seedFollowers(), settings: { ...DEFAULT_SETTINGS }, journal: [], daily: { date: todayKey(), count: 0 }, lastActionAt: 0 };
  }
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  if (!state.daily || state.daily.date !== todayKey()) state.daily = { date: todayKey(), count: 0 };
  state.journal = Array.isArray(state.journal) ? state.journal : [];
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ } }
function journal(kind, message) {
  const e = { ts: new Date().toISOString(), kind, message };
  state.journal.push(e);
  if (state.journal.length > 120) state.journal = state.journal.slice(-120);
  save(); appendJournal(e);
}

/* ─── moteur de session (local) ─── */
const engine = { state: 'idle', queue: [], targetsTotal: 0, actionsInSession: 0, hesitationsInRow: 0, nextAt: null, nextLabel: null, timer: null, done: 0 };
function clearTimer() { if (engine.timer) { clearTimeout(engine.timer); engine.timer = null; } }
function canActNow() {
  const cap = Math.min(state.settings.dailyCap, HARD_DAILY_CAP);
  if (state.daily.count >= cap) return { ok: false, reason: 'Plafond du jour atteint', code: 'daily_cap', retryAfterMs: null };
  const since = Date.now() - (state.lastActionAt || 0);
  if (state.lastActionAt && since < HARD_MIN_INTERVAL_MS) return { ok: false, reason: 'Trop rapide', code: 'cooldown', retryAfterMs: HARD_MIN_INTERVAL_MS - since };
  if (!isWithinActiveHours(new Date(), state.settings.dayStart, state.settings.dayEnd)) return { ok: false, reason: 'Hors plage', code: 'outside_hours', retryAfterMs: msUntilActiveHours(new Date(), state.settings.dayStart, state.settings.dayEnd) };
  return { ok: true, reason: null, code: null, retryAfterMs: 0 };
}
function performGesture(follower, { manual }) {
  // geste simulé : délai réseau factice court
  follower.status = 'removed';
  follower.removedAt = new Date().toISOString();
  state.daily.count += 1;
  state.lastActionAt = Date.now();
  journal('success', (manual ? '[manuel] ' : '') + follower.handle + ' retiré (simulation locale) — ' + state.daily.count + '/' + Math.min(state.settings.dailyCap, HARD_DAILY_CAP) + ' aujourd’hui');
  save();
}
function scheduleNext(delayMs, label) {
  clearTimer();
  engine.nextAt = Date.now() + delayMs;
  engine.nextLabel = label || 'geste';
  engine.timer = setTimeout(tick, delayMs);
  renderStatus();
}
function tick() {
  engine.timer = null;
  if (engine.state !== 'running') return;
  const s = state.settings;
  const cap = Math.min(s.dailyCap, HARD_DAILY_CAP);
  if (state.daily.count >= cap) return finishSession('Plafond quotidien atteint — session clôturée');
  if (!isWithinActiveHours(new Date(), s.dayStart, s.dayEnd)) {
    const wait = msUntilActiveHours(new Date(), s.dayStart, s.dayEnd);
    journal('warn', 'Hors plage — pause automatique jusqu’à ' + s.dayStart);
    return scheduleNext(wait, 'pause auto');
  }
  while (engine.queue.length) {
    const id = engine.queue[0];
    const f = state.followers.find(x => x.id === id);
    if (!f || f.status !== 'active') { engine.queue.shift(); engine.done += 1; continue; }
    if (Math.random() < s.hesitation && engine.hesitationsInRow < 2 && engine.queue.length > 1) {
      engine.hesitationsInRow += 1;
      engine.queue.push(engine.queue.shift());
      journal('info', 'Hésitation… ' + f.handle + ' reportée');
      return scheduleNext(sampleDelayMs(20000, 75000), 'hésitation');
    }
    engine.hesitationsInRow = 0;
    performGesture(f, { manual: false });
    engine.queue.shift();
    engine.done += 1;
    engine.actionsInSession += 1;
    if (!engine.queue.length) return finishSession('Session terminée — ' + engine.actionsInSession + ' geste(s)');
    const { delayMs, longPause, extraMs } = nextDelayMs(s, engine.actionsInSession);
    if (longPause) journal('info', 'Longue pause (+' + Math.round(extraMs / 60000) + ' min)');
    return scheduleNext(delayMs, longPause ? 'longue pause' : 'geste');
  }
  finishSession('Session terminée');
}
function finishSession(message) {
  clearTimer();
  engine.state = 'idle'; engine.queue = []; engine.nextAt = null; engine.nextLabel = null;
  journal('success', message);
  renderAll();
}
function startSession(ids) {
  if (engine.state === 'running') return toast('Une session est déjà en cours.', 'error');
  const wanted = new Set(ids);
  const targets = state.followers.filter(f => wanted.has(f.id) && f.status === 'active').map(f => f.id);
  if (!targets.length) return toast('Cochez d’abord des comptes.', 'error');
  for (let i = targets.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = targets[i]; targets[i] = targets[j]; targets[j] = t; }
  engine.state = 'running'; engine.queue = targets; engine.targetsTotal = targets.length;
  engine.done = 0; engine.actionsInSession = 0; engine.hesitationsInRow = 0;
  journal('info', 'Session démarrée — ' + targets.length + ' cible(s), rythme « ' + state.settings.profile + ' »');
  scheduleNext(sampleDelayMs(1500, 4000), 'préparation');
  renderAll();
}
function pauseSession() { if (engine.state !== 'running') return; engine.state = 'paused'; clearTimer(); engine.nextAt = null; journal('warn', 'Session suspendue'); renderAll(); }
function resumeSession() { if (engine.state !== 'paused') return; engine.state = 'running'; journal('info', 'Session reprise'); scheduleNext(sampleDelayMs(3000, 8000), 'reprise'); renderAll(); }
function stopSession() { const had = engine.state !== 'idle'; clearTimer(); engine.state = 'idle'; engine.queue = []; engine.nextAt = null; if (had) journal('warn', 'Session interrompue'); renderAll(); }
function manualRemove(id) {
  const f = state.followers.find(x => x.id === id); if (!f || f.status !== 'active') return;
  const gate = canActNow();
  if (!gate.ok) return toast(gate.reason + (gate.retryAfterMs ? ' — ' + Math.ceil(gate.retryAfterMs / 1000) + ' s' : ''), 'error');
  performGesture(f, { manual: true });
  selected.delete(id);
  renderAll();
}
function restoreOne(id) { const f = state.followers.find(x => x.id === id); if (f) { f.status = 'active'; save(); journal('info', f.handle + ' restauré'); renderAll(); } }

/* ─── rendu ─── */
const selected = new Set();
const ui = { filter: 'suspect', sort: 'recent', q: '' };
const isActive = f => f.status === 'active';
const isSuspect = f => f.botHint === 'élevé';
const visible = () => {
  let list = state.followers.slice();
  if (ui.filter === 'suspect') list = list.filter(f => isActive(f) && isSuspect(f));
  else if (ui.filter === 'mutual') list = list.filter(f => isActive(f) && f.mutual);
  else if (ui.filter === 'removed') list = list.filter(f => f.status === 'removed');
  if (ui.q) { const q = ui.q.toLowerCase(); list = list.filter(f => (f.handle + ' ' + f.name + ' ' + (f.bio || '')).toLowerCase().includes(q)); }
  const rank = { 'élevé': 0, 'moyen': 1, 'faible': 2 };
  if (ui.sort === 'suspicion') list.sort((a, b) => rank[a.botHint] - rank[b.botHint]);
  else if (ui.sort === 'alpha') list.sort((a, b) => a.handle.localeCompare(b.handle));
  else list.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
  return list;
};

function renderAll() { renderCounts(); renderList(); renderStatus(); }
function renderCounts() {
  $('#nSuspect').textContent = state.followers.filter(f => isActive(f) && isSuspect(f)).length;
  $('#nMutual').textContent = state.followers.filter(f => isActive(f) && f.mutual).length;
  $('#nAll').textContent = state.followers.length;
  $('#nRemoved').textContent = state.followers.filter(f => f.status === 'removed').length;
}
function renderList() {
  const list = visible();
  $('#emptyState').classList.toggle('hidden', list.length > 0);
  $('#followersList').innerHTML = list.map(f => {
    const removed = f.status === 'removed';
    const checked = selected.has(f.id);
    const reason = isSuspect(f)
      ? '<b>⚠ suspect</b> · suit ' + fmtNum(f.followingCount) + ' / suivi par ' + fmtNum(f.followersCount)
      : (f.mutual ? 'mutuel · suivi depuis le ' + fmtDate(f.followedAt) : 'suivi depuis le ' + fmtDate(f.followedAt));
    return (
      '<div class="row' + (removed ? ' removed' : '') + (checked ? ' checked' : '') + '" data-id="' + esc(f.id) + '">' +
        (removed ? '<span></span>' : '<input type="checkbox" class="row-check" data-id="' + esc(f.id) + '"' + (checked ? ' checked' : '') + '>') +
        '<div class="avatar" style="--hue:' + f.hue + '">' + esc(f.initials) + '</div>' +
        '<div class="row-meta"><div class="row-top"><span class="row-handle">' + esc(f.handle) + '</span><span class="row-name">' + esc(f.name) + '</span></div>' +
        '<div class="row-reason">' + reason + '</div></div>' +
        (removed ? '<button class="row-action restore" data-restore="' + esc(f.id) + '">↩ Restaurer</button>' : '<button class="row-action" data-remove="' + esc(f.id) + '">Retirer</button>') +
      '</div>'
    );
  }).join('');
  $$('.row', $('#followersList')).forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const cb = $('.row-check', row); if (!cb) return;
    cb.checked = !cb.checked; toggleSelect(cb.dataset.id, cb.checked, row);
  }));
  $$('.row-check', $('#followersList')).forEach(cb => cb.addEventListener('change', () => toggleSelect(cb.dataset.id, cb.checked, cb.closest('.row'))));
  $$('[data-remove]', $('#followersList')).forEach(b => b.addEventListener('click', () => manualRemove(b.dataset.remove)));
  $$('[data-restore]', $('#followersList')).forEach(b => b.addEventListener('click', () => restoreOne(b.dataset.restore)));
  updateSelectionUI();
}
function toggleSelect(id, on, row) {
  if (on) selected.add(id); else selected.delete(id);
  if (row) row.classList.toggle('checked', on);
  updateSelectionUI();
}
function updateSelectionUI() {
  const n = selected.size;
  $('#selectionInfo').textContent = n + (n > 1 ? ' comptes cochés' : ' compte coché');
  const vis = visible().filter(isActive).map(f => f.id);
  const nVis = vis.filter(id => selected.has(id)).length;
  const all = $('#selectAllBox');
  all.checked = vis.length > 0 && nVis === vis.length;
  all.indeterminate = nVis > 0 && nVis < vis.length;
  renderPrimary();
}

function renderStatus() {
  $('#todayPill').textContent = 'Aujourd’hui : ' + state.daily.count + '/' + Math.min(state.settings.dailyCap, HARD_DAILY_CAP);
  const cd = $('#cooldownText');
  const gate = canActNow();
  if (!gate.ok) {
    cd.classList.add('waiting');
    cd.textContent = gate.code === 'cooldown' ? 'Prochain geste dans ' + Math.ceil(gate.retryAfterMs / 1000) + ' s'
      : gate.code === 'daily_cap' ? 'Plafond du jour atteint — à demain' : 'Hors plage — reprise à l’ouverture';
  } else { cd.classList.remove('waiting'); cd.textContent = 'Geste possible maintenant'; }
  $$('[data-remove]').forEach(b => { b.disabled = !gate.ok; });
  $('#demoBanner').classList.remove('hidden');
  const pill = $('#connectionPill');
  pill.classList.remove('connected');
  $('#disconnectBtn').classList.add('hidden');
  $('#connectionText').textContent = 'Démo locale — 100 % navigateur';
  renderPrimary();
  renderRing();
}
function renderPrimary() {
  const btn = $('#primaryBtn'), stop = $('#stopBtn');
  const label = $('#primaryBtnLabel'), sub = $('#primaryBtnSub');
  const kicker = $('#heroKicker'), title = $('#heroTitle'), heroSub = $('#heroSub');
  const n = selected.size;
  stop.classList.toggle('hidden', engine.state === 'idle');
  if (engine.state === 'running') {
    kicker.textContent = 'Étape 2 — retrait en cours'; title.textContent = 'On y va, doucement';
    heroSub.textContent = engine.queue.length + ' cible(s) restante(s) — tout reste local, sur votre machine.';
    label.textContent = 'Suspendre'; sub.textContent = 'touchez pour souffler'; btn.disabled = false; btn.dataset.mode = 'pause';
  } else if (engine.state === 'paused') {
    kicker.textContent = 'Session en pause'; title.textContent = 'On attend votre feu vert';
    heroSub.textContent = 'Suspendue par vous — rien ne bouge.';
    label.textContent = 'Reprendre'; sub.textContent = 'dernière cible dans la file, on repart'; btn.disabled = false; btn.dataset.mode = 'resume';
  } else {
    kicker.textContent = 'Étape 1 — choisissez les comptes';
    title.textContent = n ? 'On retire ' + n + ' compte' + (n > 1 ? 's' : '') + ' ?' : 'Qui retire-t-on ?';
    heroSub.textContent = n ? 'Délais en cloche, pauses et hésitations : la démo simule une vraie main.' : 'Cochez ci-dessous — ou « Cocher les suspects » pour pré-sélectionner les comptes douteux.';
    label.textContent = 'Retirer la sélection';
    sub.textContent = n ? n + ' compte' + (n > 1 ? 's' : '') + ' coché' + (n > 1 ? 's' : '') : 'cochez d’abord des comptes';
    btn.disabled = n === 0; btn.dataset.mode = 'start';
  }
}
const RING_C = 2 * Math.PI * 52;
function renderRing() {
  const timer = $('#ringTimer'), label = $('#ringLabel'), fg = $('#ringFg');
  fg.style.strokeDasharray = RING_C.toFixed(1);
  if (engine.state === 'running' || engine.state === 'paused') {
    fg.style.strokeDashoffset = (RING_C * (1 - (engine.targetsTotal ? engine.done / engine.targetsTotal : 0))).toFixed(1);
    if (engine.state === 'running' && engine.nextAt) { timer.textContent = fmtCountdown(engine.nextAt - Date.now()); label.textContent = engine.nextLabel || 'geste'; }
    else { timer.textContent = '––:––'; label.textContent = 'en pause'; }
  } else { fg.style.strokeDashoffset = RING_C.toFixed(1); timer.textContent = '––:––'; label.textContent = 'en attente'; }
}

/* ─── journal ─── */
const journalList = $('#journalList');
function appendJournal(entry) {
  const empty = journalList.querySelector('.journal-empty'); if (empty) empty.remove();
  const li = document.createElement('li');
  li.className = 'journal-item ' + (entry.kind || 'info');
  li.innerHTML = '<time>' + esc(fmtTime(new Date(entry.ts))) + '</time>' + esc(entry.message);
  journalList.appendChild(li);
  while (journalList.children.length > 80) journalList.removeChild(journalList.firstChild);
  journalList.scrollTop = journalList.scrollHeight;
}
function loadJournal() { journalList.innerHTML = ''; if (!state.journal.length) { journalList.innerHTML = '<li class="journal-empty hint">Rien pour l’instant — vos gestes s’afficheront ici.</li>'; return; } state.journal.forEach(appendJournal); }
$('#clearJournalBtn').addEventListener('click', () => { state.journal = []; save(); journalList.innerHTML = '<li class="journal-empty hint">Journal effacé.</li>'; });

/* ─── interactions ─── */
$('#filterChips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; ui.filter = b.dataset.filter; $$('#filterChips .chip').forEach(c => c.classList.toggle('active', c === b)); renderList(); });
let searchT = null;
$('#searchInput').addEventListener('input', (e) => { clearTimeout(searchT); searchT = setTimeout(() => { ui.q = e.target.value.trim(); renderList(); }, 150); });
$('#sortSelect').addEventListener('change', (e) => { ui.sort = e.target.value; renderList(); });
$('#selectAllBox').addEventListener('change', (e) => { const on = e.target.checked; $$('.row-check', $('#followersList')).forEach(cb => { cb.checked = on; const row = cb.closest('.row'); if (on) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id); row.classList.toggle('checked', on); }); updateSelectionUI(); });
$('#selectSuspectsBtn').addEventListener('click', () => { state.followers.filter(f => isActive(f) && isSuspect(f)).forEach(f => selected.add(f.id)); renderAll(); toast('Suspects cochés — puis le gros bouton.', 'success'); });

$('#primaryBtn').addEventListener('click', () => {
  const mode = $('#primaryBtn').dataset.mode || 'start';
  if (mode === 'pause') return pauseSession();
  if (mode === 'resume') return resumeSession();
  startSession([...selected]); selected.clear();
});
$('#stopBtn').addEventListener('click', stopSession);

$('#importBtn').addEventListener('click', () => {
  const text = $('#importText').value;
  const lines = [...new Set(text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean))];
  const existing = new Set(state.followers.map(f => f.handle.toLowerCase()));
  let added = 0;
  for (const raw of lines.slice(0, 500)) {
    let h = (raw.startsWith('@') ? raw : '@' + raw).replace(/\s+/g, '').toLowerCase();
    if (!/^@[a-z0-9._]{2,24}$/.test(h) || existing.has(h)) continue;
    existing.add(h);
    const hd = hash(h);
    state.followers.push({ id: 'import-' + hd.toString(36) + '-' + added, handle: h, name: h[1].toUpperCase() + h.slice(2), initials: h.slice(1, 3).toUpperCase(), hue: hd % 360, bio: '', followersCount: 100 + (hd % 20000), followingCount: 100 + (hd % 1500), followedAt: new Date().toISOString(), mutual: false, botHint: 'faible', source: 'import', status: 'active' });
    added++;
  }
  if (added) journal('info', added + ' compte(s) importé(s)');
  $('#importResult').textContent = added + ' importé(s), ' + (lines.length - added) + ' ignoré(s).';
  $('#importText').value = '';
  save(); renderAll();
});

/* cadence : 3 boutons + avancés */
$('#profileGrid').addEventListener('click', (e) => {
  const card = e.target.closest('.pace'); if (!card) return;
  Object.assign(state.settings, PROFILES[card.dataset.profile], { profile: card.dataset.profile });
  save(); $$('#profileGrid .pace').forEach(p => p.classList.toggle('active', p === card));
  toast('Cadence « ' + card.dataset.profile + ' ».', 'success');
});
const bindRange = (id, outId, fmt) => { const i = $('#' + id), o = $('#' + outId); i.addEventListener('input', () => { o.textContent = fmt(+i.value); $$('#profileGrid .pace').forEach(p => p.classList.remove('active')); }); };
bindRange('dailyCap', 'dailyCapValue', v => v);
bindRange('hesitation', 'hesitationValue', v => Math.round(v * 100) + ' %');
bindRange('pauseEvery', 'pauseEveryValue', v => v === 0 ? 'jamais' : v);
$('#saveSettingsBtn').addEventListener('click', () => {
  Object.assign(state.settings, {
    profile: 'personnalisé',
    dailyCap: clamp(Math.round(+$('#dailyCap').value) || 50, 1, HARD_DAILY_CAP),
    hesitation: clamp(+$('#hesitation').value || 0, 0, 0.6),
    pauseEvery: clamp(Math.round(+$('#pauseEvery').value) || 0, 0, 50),
    dayStart: $('#dayStart').value || '09:00',
    dayEnd: $('#dayEnd').value || '22:30',
  });
  save(); toast('Réglages enregistrés (ce navigateur).', 'success'); renderStatus();
});
$('#resetDemoBtn').addEventListener('click', () => {
  if (!confirm('Réinitialiser la démo ?')) return;
  clearTimer(); stopSession();
  localStorage.removeItem(KEY); load(); selected.clear(); loadJournal(); renderAll();
  toast('Démo réinitialisée.', 'success');
});
$('#connectionPill').addEventListener('click', () => toast('Version Pages = simulation locale. L’app complète (OAuth TikTok + serveur) : README → « Déployer ».', 'success'));

/* minuteries */
setInterval(() => {
  renderRing();
  const gate = canActNow();
  if (!gate.ok && gate.code === 'cooldown') {
    $('#cooldownText').textContent = 'Prochain geste dans ' + Math.ceil(gate.retryAfterMs / 1000) + ' s';
    if (gate.retryAfterMs <= 1000) renderStatus();
  }
}, 1000);

/* démarrage */
load();
loadJournal();
$('#dailyCap').value = state.settings.dailyCap; $('#dailyCapValue').textContent = state.settings.dailyCap;
$('#hesitation').value = state.settings.hesitation; $('#hesitationValue').textContent = Math.round(state.settings.hesitation * 100) + ' %';
$('#pauseEvery').value = state.settings.pauseEvery; $('#pauseEveryValue').textContent = state.settings.pauseEvery === 0 ? 'jamais' : state.settings.pauseEvery;
$('#dayStart').value = state.settings.dayStart; $('#dayEnd').value = state.settings.dayEnd;
$$('#profileGrid .pace').forEach(p => p.classList.toggle('active', p.dataset.profile === state.settings.profile));
renderAll();
