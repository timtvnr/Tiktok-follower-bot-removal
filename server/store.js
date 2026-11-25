/*
 * store.js — persistance JSON locale (data/state.json, hors Git).
 * Ne contient AUCUN secret : les jetons OAuth vivent en mémoire uniquement.
 * Normalise le compteur quotidien (remise à zéro chaque jour civil local).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { seedFollowers } = require('./demo-data');
const { dailyKey } = require('./humanize');

const STATE_PATH = path.join(__dirname, '..', 'data', 'state.json');
const MAX_JOURNAL = 200;

const DEFAULT_SETTINGS = {
  profile: 'naturel',          // calme | naturel | soutenu | personnalisé
  minMinutes: 1.5,             // plage de la loi en cloche
  maxMinutes: 9,
  dailyCap: 50,                // plafonné côté serveur à HARD_DAILY_CAP (200)
  dayStart: '09:00',
  dayEnd: '22:30',
  pauseEvery: 6,               // longue pause après chaque 6 gestes (0 = désactivé)
  longPauseMin: 7,
  longPauseMax: 14,
  hesitation: 0.18,            // probabilité de reporter une cible (« hésitation »)
};

let state = null;

function load() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    state = JSON.parse(raw);
  } catch {
    state = {
      followers: seedFollowers(),
      settings: { ...DEFAULT_SETTINGS },
      journal: [],
      daily: { date: dailyKey(), count: 0 },
      lastActionAt: 0,
      createdAt: new Date().toISOString(),
    };
  }
  normalize();
  return state;
}

function normalize() {
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  state.followers = Array.isArray(state.followers) ? state.followers : [];
  state.journal = Array.isArray(state.journal) ? state.journal : [];
  if (!state.daily || state.daily.date !== dailyKey()) {
    state.daily = { date: dailyKey(), count: 0 };
  }
  state.lastActionAt = Number(state.lastActionAt) || 0;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const tmp = STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STATE_PATH);
  } catch (err) {
    console.error('[store] échec de sauvegarde :', err.message);
  }
}

function getState() { return state; }
function getSettings() { return { ...state.settings }; }
function setSettings(patch) { state.settings = { ...state.settings, ...patch }; save(); return getSettings(); }

function listFollowers() { return state.followers; }
function getFollower(id) { return state.followers.find(f => f.id === id) || null; }

function addFollowers(list) {
  state.followers.push(...list);
  save();
}

function setFollowerStatus(id, status) {
  const f = getFollower(id);
  if (!f) return null;
  f.status = status;
  f.removedAt = status === 'removed' ? new Date().toISOString() : null;
  save();
  return f;
}

// Enregistre un geste de retrait : statut + compteur du jour + horodatage global.
function applyRemoval(id) {
  const f = getFollower(id);
  if (!f) return null;
  f.status = 'removed';
  f.removedAt = new Date().toISOString();
  state.daily = { date: dailyKey(), count: (state.daily && state.daily.date === dailyKey() ? state.daily.count : 0) + 1 };
  state.lastActionAt = Date.now();
  save();
  return f;
}

function getDaily() {
  if (!state.daily || state.daily.date !== dailyKey()) {
    state.daily = { date: dailyKey(), count: 0 };
  }
  return { date: state.daily.date, count: state.daily.count };
}

function getLastActionAt() { return state.lastActionAt || 0; }

function journal(kind, message) {
  const entry = { ts: new Date().toISOString(), kind, message };
  state.journal.push(entry);
  if (state.journal.length > MAX_JOURNAL) state.journal = state.journal.slice(-MAX_JOURNAL);
  save();
  return entry;
}

function getJournal() { return state.journal.slice(-100); }
function clearJournal() { state.journal = []; save(); }

function resetDemo() {
  state.followers = seedFollowers();
  state.settings = { ...DEFAULT_SETTINGS };
  state.journal = [];
  state.daily = { date: dailyKey(), count: 0 };
  state.lastActionAt = 0;
  save();
}

module.exports = {
  load, getState, getSettings, setSettings,
  listFollowers, getFollower, addFollowers, setFollowerStatus, applyRemoval,
  getDaily, getLastActionAt, journal, getJournal, clearJournal, resetDemo,
  DEFAULT_SETTINGS,
};
