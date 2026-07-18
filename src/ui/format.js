// @ts-check
import { parseQualToken } from '../engine/index.js';

/** Nom d'une équipe par id. */
export function teamName(t, id) {
  if (!id) return '—';
  const team = t.teams.find((x) => x.id === id);
  return team ? team.name : id;
}

/** Libellé lisible d'un côté de match (équipe réelle, qualifié ou vainqueur). */
export function sideLabel(t, match, side) {
  const id = side === 'home' ? match.homeId : match.awayId;
  if (id) return teamName(t, id);
  const token = side === 'home' ? match.homeToken : match.awayToken;
  if (token) {
    const p = parseQualToken(token);
    if (p) {
      const div = t.divisions[p.divIndex];
      const pos = p.position === 1 ? '1er' : `${p.position}e`;
      return `${pos} ${div ? div.name : 'poule'}`;
    }
  }
  const src = side === 'home' ? match.homeSource : match.awaySource;
  if (src) return src.outcome === 'winner' ? 'Vainqueur' : 'Perdant';
  return 'À déterminer';
}

/** Heure "HH:MM" depuis des minutes. */
export function hhmm(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Nom lisible d'un format. */
export function formatName(f) {
  return {
    roundRobin: 'Championnat (toutes rondes)',
    championship: 'Championnat',
    knockout: 'Élimination directe',
    groupsKnockout: 'Poules + phases finales',
  }[f] || f;
}

/** Score affichable d'un match. */
export function scoreText(match) {
  const r = match.result;
  if (!r || !r.finished) return 'vs';
  let s = `${r.homeGoals} - ${r.awayGoals}`;
  if (r.penalties) s += ` (${r.penalties.home}-${r.penalties.away} t.a.b.)`;
  if (r.forfeit) s += ' (forfait)';
  return s;
}
