// @ts-check
import { computeStandings, matchWinner } from '../engine/index.js';
import { teamName, sideLabel, hhmm, scoreText } from './format.js';

/** Tableau de classement d'une poule (live). */
export function StandingsTable({ tournament, division }) {
  const standings = computeStandings(division, tournament.matches, tournament.ruleset, tournament.rngSeed);
  const q = division.qualifyCount || 0;
  return (
    <table class="standings">
      <thead>
        <tr>
          <th>#</th><th class="name">Équipe</th>
          <th>J</th><th>G</th><th>N</th><th>P</th>
          <th>bp</th><th>bc</th><th>diff</th><th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((s) => (
          <tr class={q && s.rank <= q ? 'qualified' : ''} title={s.resolvedBy ? `Départagé par : ${s.resolvedBy}` : ''}>
            <td class="rank">{s.rank}{q && s.rank <= q ? <span class="pill q">Q</span> : null}</td>
            <td class="name">{teamName(tournament, s.teamId)}{s.tiedWith?.length ? <span class="pill" title="Ex aequo">=</span> : null}</td>
            <td>{s.played}</td><td>{s.won}</td><td>{s.drawn}</td><td>{s.lost}</td>
            <td>{s.goalsFor}</td><td>{s.goalsAgainst}</td><td>{s.goalDiff > 0 ? '+' : ''}{s.goalDiff}</td>
            <td><strong>{s.points}</strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Ligne de match (planning / public). */
export function MatchRow({ tournament, match, onClick }) {
  const w = matchWinner(match);
  return (
    <div class="match" onClick={onClick} style={onClick ? 'cursor:pointer' : ''}>
      {match.slot ? <span class="court">T{match.slot.court}</span> : null}
      <div class="teams">
        <span class={w === 'home' ? 'win' : ''}>{sideLabel(tournament, match, 'home')}</span>
        {' '}<strong>{scoreText(match)}</strong>{' '}
        <span class={w === 'away' ? 'win' : ''}>{sideLabel(tournament, match, 'away')}</span>
        {match.label ? <span class="pill" style="margin-left:8px">{match.label}</span> : null}
      </div>
      {match.slot ? <span class="when">{hhmm(match.slot.startMin)}</span> : null}
    </div>
  );
}

/** Contrôle tactile +/- pour un score. */
export function ScoreStepper({ label, value, onChange }) {
  return (
    <div>
      <div class="muted center">{label}</div>
      <div class="score-stepper">
        <button class="minus" onClick={() => onChange(Math.max(0, value - 1))} aria-label="moins">−</button>
        <span class="val">{value}</span>
        <button onClick={() => onChange(value + 1)} aria-label="plus">+</button>
      </div>
    </div>
  );
}

/** Arbre des phases finales. */
export function BracketView({ tournament }) {
  const knockout = tournament.matches.filter((m) => m.phase === 'knockout' && m.label !== '3e place');
  if (knockout.length === 0) return <p class="muted">Pas de phase finale.</p>;
  const rounds = [...new Set(knockout.map((m) => m.round))].sort((a, b) => a - b);
  const third = tournament.matches.find((m) => m.label === '3e place');
  return (
    <div>
      <div class="bracket">
        {rounds.map((r) => (
          <div class="round">
            {knockout.filter((m) => m.round === r).map((m) => <BracketMatch tournament={tournament} match={m} />)}
          </div>
        ))}
      </div>
      {third ? <div style="margin-top:16px"><h3>Match pour la 3e place</h3><BracketMatch tournament={tournament} match={third} /></div> : null}
    </div>
  );
}

function BracketMatch({ tournament, match }) {
  const w = matchWinner(match);
  const r = match.result;
  return (
    <div class="bmatch">
      {match.label ? <div class="muted" style="padding:4px 10px 0;font-size:12px">{match.label}</div> : null}
      <div class={`side ${w === 'home' ? 'win' : ''}`}>
        <span>{sideLabel(tournament, match, 'home')}</span>
        <span>{r?.finished ? r.homeGoals : ''}</span>
      </div>
      <div class={`side ${w === 'away' ? 'win' : ''}`}>
        <span>{sideLabel(tournament, match, 'away')}</span>
        <span>{r?.finished ? r.awayGoals : ''}</span>
      </div>
    </div>
  );
}

/** Bandeau sponsors cliquable (gratuit — argument buvette du club). */
export function SponsorBanner({ tournament }) {
  const sponsors = tournament.branding?.sponsors || [];
  if (!sponsors.length) return null;
  return (
    <div class="card sponsors">
      {sponsors.map((s) => {
        const img = s.logoRef ? <img src={s.logoRef} alt={s.name} /> : <span class="pill">{s.name}</span>;
        return s.url ? <a href={s.url} target="_blank" rel="noopener">{img}</a> : img;
      })}
    </div>
  );
}
