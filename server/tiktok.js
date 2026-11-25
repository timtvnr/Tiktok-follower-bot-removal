/*
 * tiktok.js — intégration honnête avec TikTok.
 *
 * Ce que l’API publique permet (et ne permet pas) :
 *  ✅ OAuth « Login Kit » officiel (code + PKCE S256) — lier le compte.
 *  ✅ Lire le profil via l’endpoint officiel user/info (display_name, avatar, follower_count).
 *  ❌ Lister les abonnés : NON exposé en API publique.
 *  ❌ Retirer un abonné : NON exposé en API publique.
 *
 * Pour le geste de retrait, l’app utilise donc un « canal d’action »
 * optionnel (ACTION_GATEWAY_URL) que VOUS êtes en droit d’appeler — par ex.
 * un outil interne. Sans lui : mode démo, gestes simulés, rien n’est envoyé.
 *
 * Les jetons vivent en mémoire : jamais écrits sur disque, jamais loggés.
 */
'use strict';

const crypto = require('crypto');

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USERINFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const SCOPES = 'user.info.basic,user.info.stats';

const pendingStates = new Map(); // state → { verifier, createdAt }
let connection = null;           // { openId, displayName, avatarUrl, followerCount, accessToken, expiresAt, scope }

function isOAuthConfigured() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function redirectUri() {
  return process.env.TIKTOK_REDIRECT_URI || 'http://localhost:' + (process.env.PORT || 3000) + '/auth/tiktok/callback';
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildAuthRedirect() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));
  pendingStates.set(state, { verifier, createdAt: Date.now() });
  // purge states older than 10 min
  for (const [k, v] of pendingStates) if (Date.now() - v.createdAt > 600000) pendingStates.delete(k);

  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return AUTH_URL + '?' + params.toString();
}

async function handleCallback({ code, state }) {
  const pending = state && pendingStates.get(state);
  if (!pending) throw new Error('state OAuth invalide ou expiré — recommencez la liaison');
  pendingStates.delete(state);

  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  const tokRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const tok = await tokRes.json();
  if (!tokRes.ok || tok.error) {
    throw new Error('échange de jeton refusé : ' + (tok.error_description || tok.error || tokRes.status));
  }

  const fields = 'open_id,display_name,avatar_url,follower_count,following_count';
  const infoRes = await fetch(USERINFO_URL + '?fields=' + encodeURIComponent(fields), {
    headers: { Authorization: 'Bearer ' + tok.access_token },
    signal: AbortSignal.timeout(15000),
  });
  const info = await infoRes.json();
  const u = (info && info.data && info.data.user) || {};
  connection = {
    openId: u.open_id || tok.open_id || null,
    displayName: u.display_name || null,
    avatarUrl: u.avatar_url || null,
    followerCount: typeof u.follower_count === 'number' ? u.follower_count : null,
    accessToken: tok.access_token,
    scope: tok.scope || SCOPES,
    expiresAt: Date.now() + (Number(tok.expires_in) || 86400) * 1000,
  };
  return connectionSummary();
}

function connectionSummary() {
  if (!connection) return { connected: false, configured: isOAuthConfigured() };
  return {
    connected: true,
    configured: true,
    openId: connection.openId,
    displayName: connection.displayName,
    avatarUrl: connection.avatarUrl,
    followerCount: connection.followerCount,
    scope: connection.scope,
    expiresAt: new Date(connection.expiresAt).toISOString(),
  };
}

function disconnect() { connection = null; }
function getConnection() { return connection; }

function actionChannelConfigured() { return Boolean(process.env.ACTION_GATEWAY_URL); }

// Envoie le geste de retrait au canal configuré. Lance une erreur si refus.
async function sendRemovalGesture(follower) {
  const url = process.env.ACTION_GATEWAY_URL;
  if (!url) return { simulated: true };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gateway-secret': process.env.ACTION_GATEWAY_SECRET || '',
    },
    body: JSON.stringify({
      action: 'remove_follower',
      target_open_id: follower.openId || null,
      target_handle: follower.handle,
      initiated_by: connection ? connection.openId : 'unauthenticated',
      requested_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('passerelle d’action a répondu ' + res.status + (txt ? ' — ' + txt.slice(0, 200) : ''));
  }
  return { simulated: false };
}

module.exports = {
  isOAuthConfigured, buildAuthRedirect, handleCallback,
  connectionSummary, disconnect, getConnection,
  actionChannelConfigured, sendRemovalGesture,
  REDIRECT_URI: redirectUri,
};
