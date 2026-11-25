# Tiktok-follower-bot-removal

**Sillage** — une app web pour retirer des followers de votre propre compte TikTok **un geste à la fois**, avec une cadence crédible : délais en cloche, hésitations, longues pauses, plage horaire d'activité, plafonds appliqués côté serveur.

> ⚠️ Honnêteté d'abord : TikTok n'expose **aucun endpoint public « retirer un abonné »** dans son API. Sillage est donc un *planificateur + exécutant*, pas un outil de piratage :
>
> - **OAuth Login Kit officiel** (`user.info.basic` + `user.info.stats`, PKCE S256) pour lier votre compte et lire votre profil ;
> - **gestes de retrait** délégués à un canal d'action optionnel (`ACTION_GATEWAY_URL`) que *vous* êtes en droit d'utiliser ;
> - sans canal configuré, **mode démonstration** : gestes simulés côté serveur, étiquetés comme tels, rien n'est envoyé à TikTok.

## Démarrage rapide (démo, 30 secondes)

```bash
npm install
npm start
# → http://localhost:3000
```

32 followers fictifs sont chargés. Recherchez, triez, filtrez « suspects », cochez des cibles, lancez une **session assistée** : la cadence (distributions, pauses, hésitations, plage horaire, plafond du jour) est réelle et mesurable — seuls les gestes sont simulés.

## Brancher votre compte TikTok (lecture)

1. Sur [developers.tiktok.com](https://developers.tiktok.com/), créez une app → **Login Kit**, scopes `user.info.basic` et `user.info.stats`.
2. Redirect URI : `http://localhost:3000/auth/tiktok/callback`
3. `cp .env.example .env` et renseignez `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` (+ `TIKTOK_REDIRECT_URI` si vous changez le port ou l'hôte).
4. Redémarrez, puis cliquez la pilule de connexion en haut à droite.

Le jeton vit **en mémoire uniquement** (jamais écrit sur disque, jamais loggé). « Délier » l'efface.

## Le geste réel (canal d'action)

Définissez dans `.env` :

```
ACTION_GATEWAY_URL=https://votre-hote/chemin
ACTION_GATEWAY_SECRET=…
```

L'app POSTera alors `{ action: "remove_follower", target_handle, target_open_id, initiated_by, requested_at }` avec l'en-tête `x-gateway-secret`. Une réponse non-2xx suspend la session et journalise l'erreur — jamais de succès silencieux. Sans `ACTION_GATEWAY_URL`, chaque geste reste simulé.

## Cadence humaine (et pourquoi)

| Mécanisme | Détail |
|---|---|
| Délais en cloche | Box-Muller, jamais réguliers ; profils Calme (2–12 min), Naturel (1,5–9 min), Soutenu (1–6 min) |
| Longue pause | aléatoire toutes les N gestes (configurable, 0 = jamais) |
| Hésitation | probabilité configurable de reporter une cible (2 d'affilée max) |
| Plage horaire | hors plage → pause automatique, reprise à l'ouverture (fenêtres traversant minuit gérées) |
| Plafond quotidien | réglable, **plancher serveur infranchissable : 200/jour** |
| Intervalle min. | **45 s**, appliqués côté serveur même si l'interface est contournée |

## Pourquoi ne pas « juste appeler l'API »

- L'API publique TikTok (Display / Login Kit) couvre le profil et les stats — **pas** la liste des abonnés, **pas** leur retrait.
- Sillage n'utilise ni sessions privées volées, ni endpoints internes, ni identifiants en clair. La liste des abonnés s'importe à la main (onglet Abonnés → « Importer ») ou via les données de démo — parce que c'est la seule voie honnête.
- Automatiser des actions peut enfreindre les CGU TikTok : outil volontairement lent, borné, à usage sur **votre** compte, pour des comptes que vous avez vous-même qualifiés (indice bot, inactifs, hors cible).

## Tests

```bash
npm test   # node:test — distribution des délais, plages horaires, pauses, planchers
```

## Structure

```
server/   humanize.js (pacing pur, testé) · engine.js (session) · tiktok.js (OAuth + passerelle) · store.js (JSON local) · index.js (HTTP/SSE)
public/   UI sans build — index.html · styles.css · app.js
test/     humanize.test.js
data/     state.json (créé au 1er run, hors Git)
```

## Licence

MIT
