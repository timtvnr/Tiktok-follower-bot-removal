'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sampleDelayMs, nextDelayMs, isWithinActiveHours, msUntilActiveHours,
  parseHHMM, projectSchedule, dailyKey, HARD_DAILY_CAP, HARD_MIN_INTERVAL_MS,
} = require('../server/humanize');

test('sampleDelayMs reste dans la plage (1000 tirages)', () => {
  for (let i = 0; i < 1000; i++) {
    const v = sampleDelayMs(90_000, 540_000);
    assert.ok(v >= 90_000 && v <= 540_000, 'hors plage : ' + v);
  }
});

test('sampleDelayMs inverse min/max sans lever d’erreur', () => {
  const v = sampleDelayMs(500_000, 100_000);
  assert.ok(v >= 100_000 && v <= 500_000);
});

test('parseHHMM valide / invalide', () => {
  assert.equal(parseHHMM('09:00', -1), 540);
  assert.equal(parseHHMM('22:30', -1), 1350);
  assert.equal(parseHHMM('25:00', 42), 42);
  assert.equal(parseHHMM('nope', 42), 42);
  assert.equal(parseHHMM('', 42), 42);
});

test('fenêtre d’activité simple et traversant minuit', () => {
  const at = (h, m) => new Date(2026, 10, 25, h, m, 0);
  assert.equal(isWithinActiveHours(at(10, 0), '09:00', '22:30'), true);
  assert.equal(isWithinActiveHours(at(23, 0), '09:00', '22:30'), false);
  assert.equal(isWithinActiveHours(at(8, 0), '09:00', '22:30'), false);
  // fenêtre de nuit : 20:00 → 07:00
  assert.equal(isWithinActiveHours(at(23, 30), '20:00', '07:00'), true);
  assert.equal(isWithinActiveHours(at(3, 0), '20:00', '07:00'), true);
  assert.equal(isWithinActiveHours(at(12, 0), '20:00', '07:00'), false);
});

test('msUntilActiveHours = 0 dans la plage, > 0 hors plage et borne l’attente', () => {
  const at = (h, m) => new Date(2026, 10, 25, h, m, 0);
  assert.equal(msUntilActiveHours(at(10, 0), '09:00', '22:30'), 0);
  const wait = msUntilActiveHours(at(23, 0), '09:00', '22:30');
  assert.ok(wait > 9 * 3600 * 1000 && wait <= 10 * 3600 * 1000, 'attente attendue ≈ 10 h, reçu ' + wait);
});

test('nextDelayMs insère une longue pause après N gestes', () => {
  const settings = { minMinutes: 1, maxMinutes: 2, pauseEvery: 3, longPauseMin: 8, longPauseMax: 10 };
  const noPause = nextDelayMs(settings, 2);          // 2 gestes faits → pas de pause
  assert.equal(noPause.longPause, false);
  const withPause = nextDelayMs(settings, 3);        // 3 gestes faits → longue pause
  assert.equal(withPause.longPause, true);
  assert.ok(withPause.extraMs >= 8 * 60000 && withPause.extraMs <= 10 * 60000);
  assert.ok(withPause.delayMs > noPause.baseDelayMs, 'la pause allonge le délai');
});

test('projectSchedule produit des horaires croissants et respecte la plage', () => {
  const settings = { minMinutes: 1, maxMinutes: 2, pauseEvery: 3, longPauseMin: 5, longPauseMax: 6, dayStart: '00:00', dayEnd: '23:59', hesitation: 0 };
  const plan = projectSchedule(settings, 8, new Date(2026, 10, 25, 9, 0, 0));
  assert.equal(plan.length, 8);
  let prev = 0;
  for (const p of plan) {
    const t = new Date(p.at).getTime();
    assert.ok(t > prev, 'horaires non croissants');
    prev = t;
  }
});

test('plafonds durs documentés', () => {
  assert.equal(HARD_MIN_INTERVAL_MS, 45_000);
  assert.equal(HARD_DAILY_CAP, 200);
});

test('dailyKey au format local YYYY-MM-DD', () => {
  assert.match(dailyKey(new Date(2026, 10, 25)), /^2026-11-25$/);
});
