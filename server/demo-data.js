/*
 * demo-data.js — jeu de données fictif (aucune donnée réelle de personne).
 * Les prénoms/noms sont inventés ; « botHint » illustre les signaux faibles
 * qu’un titulaire de compte pourrait lui-même repérer (compte vide, taux d’abonnements…).
 */
'use strict';

const NAMES = [
  ['Léa', 'Martin'], ['Hugo', 'Bernard'], ['Chloé', 'Dubois'], ['Nathan', 'Petit'],
  ['Emma', 'Moreau'], ['Louis', 'Garcia'], ['Jade', 'Roux'], ['Gabriel', 'Fontaine'],
  ['Manon', 'Chevalier'], ['Raphaël', 'Fournier'], ['Camille', 'Girard'], ['Jules', 'Bonnet'],
  ['Sarah', 'Lambert'], ['Arthur', 'Collet'], ['Inès', 'Renard'], ['Adam', 'Barbier'],
  ['Louise', 'Perrot'], ['Maël', 'Marchand'], ['Anna', 'Leclerc'], ['Tom', 'Nguyen'],
  ['Nina', 'Colin'], ['Evan', 'Perrin'], ['Clara', 'Renault'], ['Yanis', 'Faure'],
  ['Lina', 'Olivier'], ['Mila', 'Picard'], ['Noah', 'Carpentier'], ['Rose', 'Millet'],
  ['Timéo', 'Laporte'], ['Alicia', 'Deschamps'], ['Sohan', 'Vasseur'], ['Éloïse', 'Henry'],
];

const BIOS = [
  '', '', 'Créatrice · Paris', 'Photographe amateur', 'POV : mon chat',
  'On parle ciné 🎬', 'Cuisine simple, gens simples', '', 'Voyage & rando',
  'Fitness, mollo sur les squats', '1998 · Lyon', '', 'Musique tous les jours',
];

const HANDLES = [
  'lea.martin_', 'hugobern', 'chloe_dbs', 'nathan.ptt', 'emma.moreau7', 'louisgarcia',
  'jade.roux.__', 'gabefontaine', 'manonchevalier', 'raph_fournier', 'camille.grrd', 'jules_bonnet',
  'sarahlmbert', 'aec', 'inesrenard', 'adam.barbier', 'louise_perrot', 'maelmrchd',
  'anna.leclerc_', 'tom.nguyen88', 'nina.colin', 'evan.perrin_', 'clara.renault', 'yanisfaure',
  'lina.olivier', 'mila_picard', 'noah.carpentier', 'rosemillet', 'timeo.laporte', 'alicia.dcp',
  'sohan.vsr', 'eloise.henry',
];

// comptes manifestement factices (pour la démo) : bio vide, suit énormément, suivi par personne
const SUSPECT_INDEXES = new Set([4, 11, 17, 23, 29]);

// hachage déterministe pour que les stats soient stables entre redémarrages
function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function seedFollowers() {
  const now = Date.now();
  return NAMES.map(([first, last], i) => {
    const h = HANDLES[i];
    const hd = hash(h);
    const daysAgo = 20 + (hd % 540);               // abonné depuis 20 à 560 jours
    const followedAt = new Date(now - daysAgo * 86400000).toISOString();
    let followersCount = hd % 9 === 0 ? (hd % 40) : 200 + (hd % 48000);
    let followingCount = hd % 7 === 0 ? 4000 + (hd % 3000) : 80 + (hd % 900);
    let bio = BIOS[i % BIOS.length];
    // « indice bot » : compte vide qui suit énormément pour peu suivi en retour
    let botHint;
    if (SUSPECT_INDEXES.has(i)) {
      bio = '';
      followersCount = 2 + (hd % 38);
      followingCount = 1200 + (hd % 3500);
      botHint = 'élevé';
    } else {
      const ratio = followersCount > 0 ? followingCount / followersCount : 99;
      botHint = ratio > 4 ? 'moyen' : 'faible';
    }
    const emptyProfile = bio === '' && (hd % 3 === 0);
    if (botHint === 'faible' && emptyProfile) botHint = 'moyen';
    return {
      id: 'demo-' + String(i + 1).padStart(2, '0'),
      handle: '@' + h,
      name: first + ' ' + last,
      initials: (first[0] + last[0]).toUpperCase(),
      hue: hd % 360,
      bio,
      followersCount,
      followingCount,
      followedAt,
      mutual: SUSPECT_INDEXES.has(i) ? false : hd % 10 < 3,
      botHint,
      source: 'demo',
      status: 'active',
      addedAt: new Date().toISOString(),
    };
  });
}

module.exports = { seedFollowers };
