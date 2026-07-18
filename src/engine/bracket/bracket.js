// @ts-check
import { resolveSide } from '../scoring/score.js';

/**
 * Propage les vainqueurs dans l'arbre : pour chaque match dont les côtés
 * dépendent d'un match source (`homeSource`/`awaySource`), remplit `homeId`/
 * `awayId` dès que le match source est terminé. Itère jusqu'à stabilisation
 * (un vainqueur peut débloquer le tour suivant). Ne modifie pas l'entrée.
 *
 * @param {import('../types.js').Match[]} matches
 * @returns {import('../types.js').Match[]}
 */
export function advanceBracket(matches) {
  const out = matches.map((m) => ({ ...m }));
  const byId = new Map(out.map((m) => [m.id, m]));

  let changed = true;
  let guard = 0;
  while (changed && guard++ < out.length + 2) {
    changed = false;
    for (const m of out) {
      if (m.phase !== 'knockout') continue;
      if (m.homeSource && m.homeId === null) {
        const id = resolveSide(m.homeSource, byId);
        if (id !== null) {
          m.homeId = id;
          changed = true;
        }
      }
      if (m.awaySource && m.awayId === null) {
        const id = resolveSide(m.awaySource, byId);
        if (id !== null) {
          m.awayId = id;
          changed = true;
        }
      }
    }
  }
  return out;
}

/**
 * Renvoie le vainqueur final de l'arbre (id d'équipe) ou null.
 * @param {import('../types.js').Match[]} matches
 * @returns {(string|null)}
 */
export function bracketWinner(matches) {
  const knockout = matches.filter((m) => m.phase === 'knockout' && m.label !== '3e place');
  if (knockout.length === 0) return null;
  const maxRound = Math.max(...knockout.map((m) => m.round));
  const final = knockout.find((m) => m.round === maxRound);
  if (!final || !final.result || !final.result.finished) return null;
  const r = final.result;
  if (r.forfeit === 'home') return final.awayId;
  if (r.forfeit === 'away') return final.homeId;
  if (r.homeGoals > r.awayGoals) return final.homeId;
  if (r.awayGoals > r.homeGoals) return final.awayId;
  if (r.penalties) return r.penalties.home > r.penalties.away ? final.homeId : final.awayId;
  return null;
}
