// @ts-check
import { useState } from 'preact/hooks';
import { StandingsTable, BracketView, MatchRow, SponsorBanner } from '../components.jsx';
import { teamName } from '../format.js';

export function PublicView({ tournament }) {
  const [tab, setTab] = useState('planning');
  const [query, setQuery] = useState('');

  return (
    <div>
      <SponsorBanner tournament={tournament} />
      {/* Recherche par équipe DÈS l'accueil — la faille n°1 des concurrents. */}
      <div class="search">
        <input placeholder="🔎 Rechercher une équipe..." value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </div>

      {query.trim() ? (
        <TeamResults tournament={tournament} query={query} />
      ) : (
        <div>
          <div class="tabs">
            {[['planning', 'Planning'], ['classements', 'Classements'], ['arbre', 'Phases finales']].map(([k, l]) => (
              <button class={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'planning' && <PublicPlanning tournament={tournament} />}
          {tab === 'classements' && tournament.divisions.map((d) => (
            <div class="card"><h2>{d.name}</h2><StandingsTable tournament={tournament} division={d} /></div>
          ))}
          {tab === 'arbre' && <div class="card"><BracketView tournament={tournament} /></div>}
        </div>
      )}
    </div>
  );
}

function PublicPlanning({ tournament }) {
  const scheduled = tournament.matches.filter((m) => m.slot).sort((a, b) => a.slot.startMin - b.slot.startMin);
  const next = scheduled.filter((m) => !m.result?.finished).slice(0, 6);
  return (
    <div>
      <div class="card">
        <h2>Prochains matchs</h2>
        {next.length === 0 ? <p class="muted">Aucun match à venir.</p> : next.map((m) => <MatchRow tournament={tournament} match={m} />)}
      </div>
      <div class="card">
        <h2>Tous les matchs</h2>
        {scheduled.map((m) => <MatchRow tournament={tournament} match={m} />)}
      </div>
    </div>
  );
}

function TeamResults({ tournament, query }) {
  const q = query.trim().toLowerCase();
  const teams = tournament.teams.filter((t) => t.name.toLowerCase().includes(q));
  if (teams.length === 0) return <div class="empty">Aucune équipe trouvée pour « {query} ».</div>;
  return (
    <div>
      {teams.map((team) => {
        const matches = tournament.matches.filter((m) => m.homeId === team.id || m.awayId === team.id).sort((a, b) => (a.slot?.startMin || 0) - (b.slot?.startMin || 0));
        const div = tournament.divisions.find((d) => d.id === team.divisionId);
        return (
          <div class="card">
            <h2>{team.name}</h2>
            {div ? <p class="muted">{div.name}</p> : null}
            {matches.length === 0 ? <p class="muted">Aucun match programmé.</p> : matches.map((m) => <MatchRow tournament={tournament} match={m} />)}
            {div ? <div style="margin-top:12px"><StandingsTable tournament={tournament} division={div} /></div> : null}
          </div>
        );
      })}
    </div>
  );
}
