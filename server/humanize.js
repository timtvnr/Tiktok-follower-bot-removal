/*
 * humanize.js — génère des temporisations crédibles « main humaine ».
 * Fonctions pures, testées unitairement (test/humanize.test.js).
 *
 * Principes :
 *  - délais tirés dans une loi en cloche (Box-Muller), jamais réguliers ;
 *  - longue pause après chaque N gestes (« aller se faire un café ») ;
 *  - plage horaire d’activité : en dehors, l’app se met en pause toute seule ;
 *  - planchers non contournables côté serveur (HARD_MIN_INTERVAL_MS, HARD_DAILY_CAP).
 */
'use strict';

const HARD_MIN_INTERVAL_MS = 45 * 1000; // jamais moins de 45 s entre deux gestes
const HARD_DAILY_CAP = 200;             // jamais plus de 200 retraits par jour, même forgés

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Normale centrée réduite (Box-Muller)
function randNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Délai dans [minMs, maxMs], en cloche autour de la moyenne.
function sampleDelayMs(minMs, maxMs) {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) throw new TypeError('minMs/maxMs must be finite numbers');
  if (maxMs < minMs) { const t = minMs; minMs = maxMs; maxMs = t; }
  if (minMs === maxMs) return Math.round(minMs);
  const mean = (minMs + maxMs) / 2;
  const sd = (maxMs - minMs) / 6; // ~99,7 % des tirages restent dans la plage
  return clamp(Math.round(mean + randNormal() * sd), Math.round(minMs), Math.round(maxMs));
}

// « HH:MM » → minutes depuis minuit. Repli (fallback) si invalide.
function parseHHMM(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return fallback;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return h * 60 + min;
}

function fmtHHMM(totalMinutes) {
  const t = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60); const m = Math.floor(t % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}

// Fenêtre d’activité, y compris fenêtre qui traverse minuit (ex. 20:00 → 07:00).
function isWithinActiveHours(date, dayStart, dayEnd) {
  const start = parseHHMM(dayStart, 9 * 60);
  const end = parseHHMM(dayEnd, 22 * 60 + 30);
  const now = minutesOfDay(date);
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

// Millisecondes avant la prochaine ouverture de la fenêtre (0 si ouverte).
function msUntilActiveHours(date, dayStart, dayEnd) {
  if (isWithinActiveHours(date, dayStart, dayEnd)) return 0;
  const start = parseHHMM(dayStart, 9 * 60);
  const nowMin = minutesOfDay(date);
  let diffMin = start > nowMin ? start - nowMin : (24 * 60 - nowMin) + start;
  return Math.max(1000, Math.round(diffMin * 60000));
}

// Délai avant la PROCHAINE action d’une session, avec longue pause périodique.
// actionsDoneInSession = gestes réellement exécutés dans la session courante.
function nextDelayMs(settings, actionsDoneInSession) {
  const base = sampleDelayMs(settings.minMinutes * 60000, settings.maxMinutes * 60000);
  const every = Number(settings.pauseEvery) || 0;
  if (every > 0 && actionsDoneInSession > 0 && actionsDoneInSession % every === 0) {
    const extra = sampleDelayMs((settings.longPauseMin || 7) * 60000, (settings.longPauseMax || 14) * 60000);
    return { delayMs: base + extra, baseDelayMs: base, longPause: true, extraMs: extra };
  }
  return { delayMs: base, baseDelayMs: base, longPause: false, extraMs: 0 };
}

// Projette les n prochains gestes (aucune écriture, aucun appel réseau).
function projectSchedule(settings, n, fromDate) {
  const out = [];
  let cursor = new Date((fromDate || new Date()).getTime());
  let done = 0;
  let guard = 0;
  while (out.length < n && guard < n * 60) {
    guard += 1;
    if (!isWithinActiveHours(cursor, settings.dayStart, settings.dayEnd)) {
      cursor = new Date(cursor.getTime() + msUntilActiveHours(cursor, settings.dayStart, settings.dayEnd));
      continue;
    }
    const { delayMs, longPause } = nextDelayMs(settings, done);
    cursor = new Date(cursor.getTime() + delayMs);
    // Si le geste tombe hors plage, on avance jusqu’à l’ouverture.
    if (!isWithinActiveHours(cursor, settings.dayStart, settings.dayEnd)) {
      cursor = new Date(cursor.getTime() + msUntilActiveHours(cursor, settings.dayStart, settings.dayEnd));
    }
    out.push({ index: out.length + 1, at: cursor.toISOString(), longPause });
    done += 1;
  }
  return out;
}

function dailyKey(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

module.exports = {
  HARD_MIN_INTERVAL_MS,
  HARD_DAILY_CAP,
  clamp,
  randNormal,
  sampleDelayMs,
  parseHHMM,
  fmtHHMM,
  minutesOfDay,
  isWithinActiveHours,
  msUntilActiveHours,
  nextDelayMs,
  projectSchedule,
  dailyKey,
};
