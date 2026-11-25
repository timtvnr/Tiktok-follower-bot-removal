/*
 * engine.js — moteur de « session assistée ».
 *
 * Déroule une file de cibles UNE PAR UNE, avec :
 *  - délais en cloche (humanize.sampleDelayMs), jamais réguliers ;
 *  - longue pause toutes les N actions exécutées ;
 *  - hésitations (cible reportée en fin de file, 2 maximum d’affilée) ;
 *  - plage d’activité : hors plage → pause automatique jusqu’à l’ouverture ;
 *  - plafond quotidien + intervalle plancher, appliqués AVANT chaque geste.
 *
 * Le geste lui-même est délégué à tiktok.sendRemovalGesture() :
 *  - ACTION_GATEWAY_URL configurée → vraie requête vers votre canal autorisé ;
 *  - sinon → geste simulé (mode démo explicite).
 */
'use strict';

const { EventEmitter } = require('events');
const store = require('./store');
const humanize = require('./humanize');
const tiktok = require('./tiktok');

const bus = new EventEmitter();
bus.setMaxListeners(50);

const engine = {
  state: 'idle',          // idle | running | paused
  queue: [],              // ids restants
  targetsTotal: 0,
  actionsInSession: 0,    // gestes réellement exécutés dans la session
  hesitationsInRow: 0,
  nextAt: null,           // epoch ms de la prochaine action (si connue)
  nextLabel: null,        // libellé affiché (« geste », « pause auto », « hésitation »…)
  holdUntil: null,        // si pause automatique hors plage : réveil prévu
  startedAt: null,
  lastOutcome: null,      // 'removed' | 'simulated' | 'error' | null
  timer: null,
};

function log(kind, message) {
  const entry = store.journal(kind, message);
  bus.emit('journal', entry);
}

function canActNow() {
  const settings = store.getSettings();
  const daily = store.getDaily();
  const cap = Math.min(Math.max(1, settings.dailyCap), humanize.HARD_DAILY_CAP);
  if (daily.count >= cap) {
    return { ok: false, reason: 'Plafond quotidien atteint (' + daily.count + '/' + cap + ')', retryAfterMs: null, code: 'daily_cap' };
  }
  const since = Date.now() - store.getLastActionAt();
  if (since < humanize.HARD_MIN_INTERVAL_MS) {
    return { ok: false, reason: 'Trop rapide — encore ' + Math.ceil((humanize.HARD_MIN_INTERVAL_MS - since) / 1000) + ' s', retryAfterMs: humanize.HARD_MIN_INTERVAL_MS - since, code: 'cooldown' };
  }
  if (!humanize.isWithinActiveHours(new Date(), settings.dayStart, settings.dayEnd)) {
    const wait = humanize.msUntilActiveHours(new Date(), settings.dayStart, settings.dayEnd);
    return { ok: false, reason: 'Hors plage d’activité (' + settings.dayStart + '–' + settings.dayEnd + ')', retryAfterMs: wait, code: 'outside_hours' };
  }
  return { ok: true, reason: null, retryAfterMs: 0, code: null };
}

// Exécute le geste (réel ou simulé) et met à jour le compteur du jour.
async function performGesture(follower, { manual }) {
  const res = await tiktok.sendRemovalGesture(follower);
  store.applyRemoval(follower.id);
  if (res.simulated) {
    log('success', (manual ? '[manuel] ' : '') + follower.handle + ' retiré (simulation) — compteur du jour : ' + store.getDaily().count);
  } else {
    log('success', (manual ? '[manuel] ' : '') + follower.handle + ' retiré via le canal d’action — compteur du jour : ' + store.getDaily().count);
  }
  engine.lastOutcome = res.simulated ? 'simulated' : 'removed';
  bus.emit('status');
  return res;
}

function clearTimer() {
  if (engine.timer) { clearTimeout(engine.timer); engine.timer = null; }
}

function scheduleNext(delayMs, label) {
  clearTimer();
  engine.nextAt = Date.now() + delayMs;
  engine.nextLabel = label || 'geste';
  engine.timer = setTimeout(tick, delayMs);
  bus.emit('status');
}

async function tick() {
  engine.timer = null;
  if (engine.state !== 'running') return;

  const settings = store.getSettings();

  // 1) Plafond quotidien atteint → session terminée proprement
  const daily = store.getDaily();
  const cap = Math.min(Math.max(1, settings.dailyCap), humanize.HARD_DAILY_CAP);
  if (daily.count >= cap) {
    finishSession('Plafond quotidien atteint (' + daily.count + '/' + cap + ') — session clôturée');
    return;
  }

  // 2) Hors plage → pause automatique jusqu’à l’ouverture
  if (!humanize.isWithinActiveHours(new Date(), settings.dayStart, settings.dayEnd)) {
    const wait = humanize.msUntilActiveHours(new Date(), settings.dayStart, settings.dayEnd);
    engine.holdUntil = Date.now() + wait;
    log('warn', 'Hors plage d’activité — pause automatique jusqu’à ' + settings.dayStart);
    scheduleNext(wait, 'pause auto');
    return;
  }
  engine.holdUntil = null;

  // 3) Prochaine cible exploitable
  while (engine.queue.length) {
    const id = engine.queue[0];
    const follower = store.getFollower(id);
    if (!follower || follower.status !== 'active') {
      engine.queue.shift();
      continue;
    }

    // 4) Hésitation : reporter la cible en fin de file (2 d’affilée maximum)
    if (Math.random() < settings.hesitation && engine.hesitationsInRow < 2 && engine.queue.length > 1) {
      engine.hesitationsInRow += 1;
      engine.queue.push(engine.queue.shift());
      const d = humanize.sampleDelayMs(20 * 1000, 75 * 1000);
      log('info', 'Hésitation… ' + follower.handle + ' reportée (on respire un instant)');
      scheduleNext(d, 'hésitation');
      return;
    }
    engine.hesitationsInRow = 0;

    // 5) Geste
    try {
      await performGesture(follower, { manual: false });
      engine.queue.shift();
      engine.actionsInSession += 1;
    } catch (err) {
      engine.lastOutcome = 'error';
      engine.state = 'paused';
      clearTimer();
      log('error', 'Échec du retrait de ' + follower.handle + ' : ' + err.message + ' — session suspendue');
      bus.emit('status');
      return;
    }

    // 6) File vidée ?
    if (engine.queue.length === 0) {
      finishSession('Session terminée — ' + engine.actionsInSession + ' geste(s) exécuté(s)');
      return;
    }

    // 7) Délai humanisé avant le geste suivant (avec longue pause périodique)
    const { delayMs, longPause, extraMs } = humanize.nextDelayMs(settings, engine.actionsInSession);
    if (longPause) {
      log('info', 'Longue pause (+' + Math.round(extraMs / 60000) + ' min) — on décroche, comme une vraie main');
      scheduleNext(delayMs, 'longue pause');
    } else {
      scheduleNext(delayMs, 'geste');
    }
    return;
  }

  finishSession('Session terminée');
}

function startSession(ids) {
  if (engine.state === 'running') return { error: 'Une session est déjà en cours', code: 409 };
  const wanted = new Set(ids || []);
  const targets = store.listFollowers().filter(f => wanted.has(f.id) && f.status === 'active');
  if (!targets.length) return { error: 'Aucune cible active sélectionnée', code: 400 };

  // Mélange façon « je parcours ma liste sans ordre » — Fisher-Yates
  const queue = targets.map(f => f.id);
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = queue[i]; queue[i] = queue[j]; queue[j] = t;
  }

  engine.state = 'running';
  engine.queue = queue;
  engine.targetsTotal = queue.length;
  engine.actionsInSession = 0;
  engine.hesitationsInRow = 0;
  engine.startedAt = new Date().toISOString();
  engine.lastOutcome = null;
  engine.holdUntil = null;
  log('info', 'Session démarrée — ' + queue.length + ' cible(s), rythme « ' + store.getSettings().profile + ' »');
  scheduleNext(humanize.sampleDelayMs(2500, 6000), 'préparation');
  return publicStatus();
}

function pauseSession() {
  if (engine.state !== 'running') return publicStatus();
  engine.state = 'paused';
  clearTimer();
  engine.nextAt = null; engine.nextLabel = null;
  log('warn', 'Session suspendue par l’utilisateur');
  return publicStatus();
}

function resumeSession() {
  if (engine.state !== 'paused') return publicStatus();
  engine.state = 'running';
  log('info', 'Session reprise');
  scheduleNext(humanize.sampleDelayMs(4000, 12000), 'reprise');
  return publicStatus();
}

function stopSession() {
  const had = engine.state !== 'idle';
  clearTimer();
  engine.state = 'idle';
  engine.queue = [];
  engine.nextAt = null; engine.nextLabel = null; engine.holdUntil = null;
  if (had) log('warn', 'Session interrompue — ' + engine.actionsInSession + ' geste(s) exécuté(s)');
  return publicStatus();
}

function finishSession(message) {
  clearTimer();
  engine.state = 'idle';
  engine.queue = [];
  engine.nextAt = null; engine.nextLabel = null; engine.holdUntil = null;
  log('success', message);
  bus.emit('status');
}

// Geste manuel « comme au doigt » : un clic = un retrait, garde-fous appliqués.
async function manualGesture(id) {
  const follower = store.getFollower(id);
  if (!follower) return { error: 'Cible introuvable', code: 404 };
  if (follower.status !== 'active') return { error: 'Cible déjà traitée', code: 409 };
  const gate = canActNow();
  if (!gate.ok) return { error: gate.reason, code: 429, retryAfterMs: gate.retryAfterMs };
  try {
    await performGesture(follower, { manual: true });
    return { ok: true, dailyCount: store.getDaily().count };
  } catch (err) {
    log('error', '[manuel] échec pour ' + follower.handle + ' : ' + err.message);
    return { error: err.message, code: 502 };
  }
}

function publicStatus() {
  const settings = store.getSettings();
  const daily = store.getDaily();
  const done = engine.targetsTotal - engine.queue.length;
  return {
    now: Date.now(),
    mode: tiktok.actionChannelConfigured() ? 'gateway' : 'demo',
    connection: tiktok.connectionSummary(),
    settings,
    daily: { count: daily.count, cap: Math.min(settings.dailyCap, humanize.HARD_DAILY_CAP), date: daily.date },
    lastActionAt: store.getLastActionAt(),
    canAct: canActNow(),
    engine: {
      state: engine.state,
      queueLength: engine.queue.length,
      targetsTotal: engine.targetsTotal,
      done,
      actionsInSession: engine.actionsInSession,
      nextAt: engine.nextAt,
      nextLabel: engine.nextLabel,
      holdUntil: engine.holdUntil,
      startedAt: engine.startedAt,
      lastOutcome: engine.lastOutcome,
    },
  };
}

module.exports = {
  bus, publicStatus, startSession, pauseSession, resumeSession, stopSession, manualGesture, canActNow,
};
