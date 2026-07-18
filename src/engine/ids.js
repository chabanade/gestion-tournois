// @ts-check
/**
 * Génération d'identifiants et générateur aléatoire DÉTERMINISTE (seedé).
 *
 * Le RNG seedé est le socle du tirage au sort reproductible : à seed égal, la
 * même séquence sort — ce qui permet de rejouer un classement à l'identique
 * après export/réimport JSON. On n'utilise JAMAIS Math.random() dans le moteur.
 */

/**
 * Hash d'une chaîne en 4 entiers 32 bits (cyrb128). Sert à transformer une
 * seed textuelle ("mon-tournoi") en état initial du générateur.
 * @param {string} str
 * @returns {[number, number, number, number]}
 */
export function cyrb128(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/**
 * Générateur mulberry32 : rapide, déterministe, suffisant pour un tirage au sort.
 * @param {number} a état 32 bits
 * @returns {() => number} fonction renvoyant un flottant [0, 1)
 */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Crée un RNG déterministe à partir d'une seed textuelle.
 * @param {string} seed
 * @returns {() => number}
 */
export function makeRng(seed) {
  const [a] = cyrb128(String(seed));
  return mulberry32(a);
}

/**
 * Mélange déterministe (Fisher-Yates) d'un tableau à l'aide d'un RNG fourni.
 * Ne modifie pas l'entrée.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
export function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

let __counter = 0;

/**
 * Identifiant court unique. Hors moteur pur (création d'entités côté app), on
 * accepte l'usage de la source d'entropie de la plateforme ; en test on peut
 * passer un rng pour rester déterministe.
 * @param {string} [prefix]
 * @param {() => number} [rng]
 * @returns {string}
 */
export function makeId(prefix = 'id', rng) {
  __counter = (__counter + 1) % 1e6;
  const r = rng ? rng() : (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
    : 0.5);
  const rand = Math.floor(r * 1e6).toString(36);
  return `${prefix}_${__counter.toString(36)}${rand}`;
}
