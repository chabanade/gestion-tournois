// @ts-check
import { replaceState } from './store.js';

/**
 * Export JSON complet d'un tournoi (snapshot restaurable). C'est la porte de
 * sortie de secours : quoi qu'il arrive au stockage local ou au serveur, les
 * données restent récupérables.
 * @param {import('../engine/index.js').Tournament} t
 */
export function exportJson(t) {
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(t.name)}-${t.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Importe un tournoi depuis un fichier JSON et remplace l'état courant.
 * @param {File} file
 * @returns {Promise<import('../engine/index.js').Tournament>}
 */
export async function importJson(file) {
  const text = await file.text();
  const t = JSON.parse(text);
  if (!t || !t.id || !Array.isArray(t.matches)) {
    throw new Error('Fichier de tournoi invalide.');
  }
  replaceState(t);
  return t;
}

function slug(s) {
  return String(s || 'tournoi').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tournoi';
}
