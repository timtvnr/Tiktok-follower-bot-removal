/*
 * index.js — serveur HTTP : UI statique + API JSON + flux SSE du journal.
 * Aucun header X-Frame-Options : l'aperçu Arena est servi dans une iframe.
 */
'use strict';

const path = require('path');
const express = require('express');
const { loadEnv } = require('./config');
loadEnv();

const store = require('./store');
const humanize = require('./humanize');
const tiktok = require('./tiktok');
const engine = require('./engine');

store.load();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// En-têtes sobres (pas de X-Frame-Options : iframe d'aperçu)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ─── Statut global ─────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json(engine.publicStatus()));

// ─── Followers ─────────────────────────────────────────────────
app.get('/api/followers', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const filter = String(req.query.filter || 'all');
  const sort = String(req.query.sort || 'recent');
  let list = store.listFollowers().slice();

  if (q) list = list.filter(f => (f.handle + ' ' + f.name + ' ' + (f.bio || '')).toLowerCase().includes(q));
  if (filter === 'active') list = list.filter(f => f.status === 'active');
  else if (filter === 'removed') list = list.filter(f => f.status === 'removed');
  else if (filter === 'mutual') list = list.filter(f => f.mutual && f.status === 'active');
  else if (filter === 'suspect') list = list.filter(f => f.botHint === 'élevé' && f.status === 'active');

  switch (sort) {
    case 'oldest': list.sort((a, b) => new Date(a.followedAt) - new Date(b.followedAt)); break;
    case 'alpha': list.sort((a, b) => a.handle.localeCompare(b.handle)); break;
    case 'reach': list.sort((a, b) => b.followersCount - a.followersCount); break;
    case 'suspicion': { const rank = { 'élevé': 0, 'moyen': 1, 'faible': 2 }; list.sort((a, b) => (rank[a.botHint] ?? 3) - (rank[b.botHint] ?? 3)); break; }
    default: list.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
  }
  res.json({ followers: list, total: list.length });
});

app.post('/api/followers/:id/remove', async (req, res) => {
  const out = await engine.manualGesture(req.params.id);
  if (out.error) return res.status(out.code || 500).json(out);
  res.json(out);
});

app.post('/api/followers/:id/restore', (req, res) => {
  const f = store.setFollowerStatus(req.params.id, 'active');
  if (!f) return res.status(404).json({ error: 'Cible introuvable' });
  store.journal('info', f.handle + ' restauré(e)');
  res.json({ ok: true });
});

// Import manuel : une ligne = un handle (TikTok n'expose pas la liste d'abonnés)
app.post('/api/import', (req, res) => {
  const text = String((req.body && req.body.text) || '');
  const lines = [...new Set(text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean))];
  if (!lines.length) return res.status(400).json({ error: 'Rien à importer' });
  const existing = new Set(store.listFollowers().map(f => f.handle.toLowerCase()));
  const created = [];
  for (const raw of lines.slice(0, 500)) {
    let handle = raw.startsWith('@') ? raw : '@' + raw;
    handle = handle.replace(/\s+/g, '').toLowerCase();
    if (!/^@[a-z0-9._]{2,24}$/.test(handle)) continue;
    if (existing.has(handle)) continue;
    existing.add(handle);
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < handle.length; i++) { hash ^= handle.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    const hd = hash >>> 0;
    const core = handle.slice(1);
    created.push({
      id: 'import-' + hd.toString(36) + '-' + created.length,
      handle,
      name: core.charAt(0).toUpperCase() + core.slice(1),
      initials: core.slice(0, 2).toUpperCase(),
      hue: hd % 360,
      bio: '',
      followersCount: 100 + (hd % 20000),
      followingCount: 100 + (hd % 1500),
      followedAt: new Date().toISOString(),
      mutual: false,
      botHint: 'faible',
      source: 'import',
      status: 'active',
      addedAt: new Date().toISOString(),
    });
  }
  if (created.length) {
    store.addFollowers(created);
    store.journal('info', created.length + ' compte(s) importé(s) manuellement');
  }
  res.json({ imported: created.length, skipped: lines.length - created.length });
});

// ─── Réglages ──────────────────────────────────────────────────
const PROFILES = {
  calme:   { minMinutes: 2,   maxMinutes: 12, profile: 'calme' },
  naturel: { minMinutes: 1.5, maxMinutes: 9,  profile: 'naturel' },
  soutenu: { minMinutes: 1,   maxMinutes: 6,  profile: 'soutenu' },
};

function clampSettings(s) {
  const out = {};
  out.minMinutes = humanize.clamp(Number(s.minMinutes) || 1.5, 0.75, 240);
  out.maxMinutes = humanize.clamp(Number(s.maxMinutes) || 9, out.minMinutes, 240);
  out.dailyCap = Math.floor(humanize.clamp(Number(s.dailyCap) || 50, 1, humanize.HARD_DAILY_CAP));
  out.hesitation = humanize.clamp(Number(s.hesitation), 0, 0.6);
  if (!Number.isFinite(Number(s.hesitation))) out.hesitation = 0.18;
  out.pauseEvery = Math.floor(humanize.clamp(Number(s.pauseEvery) || 0, 0, 50));
  out.longPauseMin = humanize.clamp(Number(s.longPauseMin) || 7, 1, 120);
  out.longPauseMax = humanize.clamp(Number(s.longPauseMax) || 14, out.longPauseMin, 180);
  out.dayStart = String(s.dayStart || '09:00');
  out.dayEnd = String(s.dayEnd || '22:30');
  // valider les heures, sinon repli
  if (humanize.parseHHMM(out.dayStart, -1) === -1) out.dayStart = '09:00';
  if (humanize.parseHHMM(out.dayEnd, -1) === -1) out.dayEnd = '22:30';
  out.profile = ['calme', 'naturel', 'soutenu', 'personnalisé'].includes(s.profile) ? s.profile : 'personnalisé';
  return out;
}

app.get('/api/settings', (req, res) => res.json({ settings: store.getSettings(), hard: { minIntervalMs: humanize.HARD_MIN_INTERVAL_MS, dailyCap: humanize.HARD_DAILY_CAP } }));

app.put('/api/settings', (req, res) => {
  const body = req.body || {};
  let patch;
  if (body.profile && PROFILES[body.profile]) patch = { ...PROFILES[body.profile] };
  else patch = clampSettings({ ...store.getSettings(), ...body });
  const saved = store.setSettings(patch);
  res.json({ settings: saved });
});

// ─── Planification (simulation locale, aucun réseau) ───────────
app.get('/api/plan', (req, res) => {
  const n = humanize.clamp(Math.floor(Number(req.query.n) || 12), 1, 30);
  res.json({ plan: humanize.projectSchedule(store.getSettings(), n, new Date()) });
});

// ─── Sessions ──────────────────────────────────────────────────
app.post('/api/session/start', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const out = engine.startSession(ids);
  if (out.error) return res.status(out.code || 400).json(out);
  res.json(out);
});
app.post('/api/session/pause', (req, res) => res.json(engine.pauseSession()));
app.post('/api/session/resume', (req, res) => res.json(engine.resumeSession()));
app.post('/api/session/stop', (req, res) => res.json(engine.stopSession()));

// ─── Journal + flux temps réel (SSE) ───────────────────────────
app.get('/api/journal', (req, res) => res.json({ journal: store.getJournal() }));
app.post('/api/journal/clear', (req, res) => { store.clearJournal(); res.json({ ok: true }); });

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const onJournal = (entry) => res.write('event: journal\ndata: ' + JSON.stringify(entry) + '\n\n');
  const onStatus = () => res.write('event: status\ndata: {}\n\n');
  engine.bus.on('journal', onJournal);
  engine.bus.on('status', onStatus);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    engine.bus.off('journal', onJournal);
    engine.bus.off('status', onStatus);
  });
});

// ─── Connexion TikTok (OAuth Login Kit + PKCE) ─────────────────
app.get('/api/connection', (req, res) => res.json(tiktok.connectionSummary()));
app.post('/api/disconnect', (req, res) => { tiktok.disconnect(); store.journal('info', 'Compte TikTok délié (jeton effacé de la mémoire)'); res.json({ ok: true }); });

app.get('/auth/tiktok', (req, res) => {
  if (!tiktok.isOAuthConfigured()) {
    return res.status(503).send(
      '<p style="font-family:system-ui;padding:2rem">OAuth non configuré. Renseignez TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET dans .env (voir README), puis redémarrez.</p>'
    );
  }
  res.redirect(tiktok.buildAuthRedirect());
});

app.get('/auth/tiktok/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send('<p style="font-family:system-ui;padding:2rem">Liaison refusée : ' + String(error_description || error) + '</p>');
  try {
    const summary = await tiktok.handleCallback({ code: String(code || ''), state: String(state || '') });
    store.journal('success', 'Compte TikTok lié : ' + (summary.displayName || summary.openId || ''));
    res.redirect('/?connected=1');
  } catch (err) {
    res.status(400).send('<p style="font-family:system-ui;padding:2rem">Échec de la liaison : ' + String(err.message).replace(/</g, '&lt;') + '</p>');
  }
});

// ─── Réinitialisation des données de démo ──────────────────────
app.post('/api/reset', (req, res) => {
  if (tiktok.actionChannelConfigured()) {
    return res.status(403).json({ error: 'Réinitialisation désactivée : un canal d’action réel est configuré. Modifiez data/state.json à la main.' });
  }
  engine.stopSession();
  store.resetDemo();
  store.journal('info', 'Données de démonstration réinitialisées');
  res.json({ ok: true });
});

// ─── UI statique ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html',
  etag: true,
  setHeaders(res, filePath) { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Sillage — http://localhost:' + PORT);
  console.log('Mode : ' + (tiktok.actionChannelConfigured() ? 'canal d’action réel (ACTION_GATEWAY_URL)' : 'démonstration (gestes simulés)'));
  console.log('OAuth TikTok : ' + (tiktok.isOAuthConfigured() ? 'configuré' : 'non configuré (lecture profil désactivée)'));
});
