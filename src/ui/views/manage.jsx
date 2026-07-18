// @ts-check
import { useState, useRef } from 'preact/hooks';
import { commands, matchWinner } from '../../engine/index.js';
import { validateSchedule } from '../../engine/index.js';
import { dispatch } from '../../store/store.js';
import { navigate, can } from '../router.js';
import { StandingsTable, BracketView, MatchRow, ScoreStepper, SponsorBanner } from '../components.jsx';
import { SharePanel } from './share.jsx';
import { hhmm, sideLabel } from '../format.js';
import { exportPng } from '../../export/imageExport.js';

const TABS = [
  ['planning', 'Planning'],
  ['saisie', 'Saisie scores'],
  ['classements', 'Classements'],
  ['arbre', 'Phases finales'],
  ['perso', 'Personnalisation'],
  ['partage', 'Partage'],
];

export function ManageView({ tournament, role }) {
  const [tab, setTab] = useState('saisie');
  const isAdmin = role === 'admin';
  const visibleTabs = isAdmin ? TABS : TABS.filter(([k]) => ['saisie', 'planning', 'classements', 'arbre'].includes(k));

  return (
    <div>
      <div class="tabs">
        {visibleTabs.map(([k, label]) => (
          <button class={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'planning' && <Planning tournament={tournament} isAdmin={isAdmin} />}
      {tab === 'saisie' && <Saisie tournament={tournament} role={role} />}
      {tab === 'classements' && <Classements tournament={tournament} />}
      {tab === 'arbre' && <div class="card"><BracketView tournament={tournament} /></div>}
      {tab === 'perso' && isAdmin && <Perso tournament={tournament} />}
      {tab === 'partage' && isAdmin && <SharePanel tournament={tournament} />}
    </div>
  );
}

/* ---------- Planning ---------- */
function Planning({ tournament, isAdmin }) {
  const [selected, setSelected] = useState(null);
  const scheduled = tournament.matches.filter((m) => m.slot).sort((a, b) => a.slot.startMin - b.slot.startMin || a.slot.court - b.slot.court);
  const check = validateSchedule(tournament.matches);

  function onMatchClick(m) {
    if (!isAdmin) return;
    if (!selected) { setSelected(m.id); return; }
    if (selected === m.id) { setSelected(null); return; }
    dispatch(commands.swapMatches(selected, m.id)); // échange les créneaux
    setSelected(null);
  }

  return (
    <div class="card">
      <div class="btn-row" style="justify-content:space-between;align-items:center">
        <h2 style="margin:0">Planning</h2>
        {isAdmin ? <div class="btn-row">
          <button onClick={() => dispatch(commands.generateScheduleCmd())}>Régénérer</button>
          <button class="btn-ghost" onClick={() => window.print()}>Imprimer</button>
        </div> : null}
      </div>
      {isAdmin ? <p class="muted">Astuce : touchez deux matchs pour échanger leurs créneaux.</p> : null}
      {!check.ok ? <div class="warn-box">⚠ {check.violations.length} conflit(s) de planning détecté(s).</div> : null}
      {scheduled.length === 0 ? <p class="muted">Aucun créneau. Générez le planning.</p> : null}
      {scheduled.map((m) => (
        <div style={selected === m.id ? 'outline:2px solid var(--brand);border-radius:10px' : ''}>
          <MatchRow tournament={tournament} match={m} onClick={isAdmin ? () => onMatchClick(m) : undefined} />
        </div>
      ))}
    </div>
  );
}

/* ---------- Saisie des scores ---------- */
function Saisie({ tournament, role }) {
  const [editing, setEditing] = useState(null);
  const playable = tournament.matches.filter((m) => m.homeId && m.awayId);
  const todo = playable.filter((m) => !m.result?.finished);
  const done = playable.filter((m) => m.result?.finished);

  const editable = (m) => can(role, 'score', m.slot?.court);

  return (
    <div>
      {editing ? (
        <ScoreEditor tournament={tournament} match={editing} onClose={() => setEditing(null)} />
      ) : null}
      <div class="card">
        <h2>À jouer <span class="muted">({todo.length})</span></h2>
        {todo.length === 0 ? <p class="muted">Tous les matchs disponibles sont saisis.</p> : null}
        {todo.map((m) => (
          <MatchRow tournament={tournament} match={m} onClick={editable(m) ? () => setEditing(m) : undefined} />
        ))}
      </div>
      {done.length ? (
        <div class="card">
          <h2>Terminés <span class="muted">({done.length})</span></h2>
          {done.map((m) => (
            <MatchRow tournament={tournament} match={m} onClick={editable(m) ? () => setEditing(m) : undefined} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ScoreEditor({ tournament, match, onClose }) {
  const [hg, setHg] = useState(match.result?.homeGoals ?? 0);
  const [ag, setAg] = useState(match.result?.awayGoals ?? 0);
  const [forfeit, setForfeit] = useState(match.result?.forfeit ?? null);
  const [ph, setPh] = useState(match.result?.penalties?.home ?? 0);
  const [pa, setPa] = useState(match.result?.penalties?.away ?? 0);
  const [fpH, setFpH] = useState(match.result?.fairPlay?.home ?? 0);
  const [fpA, setFpA] = useState(match.result?.fairPlay?.away ?? 0);

  const isKnockout = match.phase === 'knockout';
  const isDraw = hg === ag && !forfeit;
  const needPk = isKnockout && isDraw;

  function save() {
    const result = { homeGoals: hg, awayGoals: ag, finished: true };
    if (forfeit) result.forfeit = forfeit;
    if (needPk || ph || pa) result.penalties = { home: ph, away: pa };
    if (fpH || fpA) result.fairPlay = { home: fpH, away: fpA };
    dispatch(commands.setResult(match.id, result));
    onClose();
  }

  return (
    <div class="card" style="border-color:var(--brand)">
      <h2>Saisie du score</h2>
      <div class="grid2">
        <div class="center"><h3>{sideLabel(tournament, match, 'home')}</h3><ScoreStepper label="buts" value={hg} onChange={setHg} /></div>
        <div class="center"><h3>{sideLabel(tournament, match, 'away')}</h3><ScoreStepper label="buts" value={ag} onChange={setAg} /></div>
      </div>

      {needPk ? (
        <div style="margin-top:16px">
          <div class="warn-box">Match nul en phase finale : renseignez les tirs au but.</div>
          <div class="grid2">
            <div class="center"><ScoreStepper label="tirs au but" value={ph} onChange={setPh} /></div>
            <div class="center"><ScoreStepper label="tirs au but" value={pa} onChange={setPa} /></div>
          </div>
        </div>
      ) : null}

      <details style="margin-top:16px">
        <summary>Cas particuliers (forfait, fair-play)</summary>
        <label>Forfait</label>
        <select value={forfeit || ''} onInput={(e) => setForfeit(e.currentTarget.value || null)}>
          <option value="">Aucun</option>
          <option value="home">{sideLabel(tournament, match, 'home')} forfait</option>
          <option value="away">{sideLabel(tournament, match, 'away')} forfait</option>
        </select>
        <div class="grid2">
          <div><label>Points fair-play (malus) — {sideLabel(tournament, match, 'home')}</label><input type="number" min="0" value={fpH} onInput={(e) => setFpH(+e.currentTarget.value)} /></div>
          <div><label>Points fair-play (malus) — {sideLabel(tournament, match, 'away')}</label><input type="number" min="0" value={fpA} onInput={(e) => setFpA(+e.currentTarget.value)} /></div>
        </div>
      </details>

      <div class="btn-row" style="margin-top:16px">
        <button class="btn-primary" onClick={save}>Valider</button>
        <button class="btn-ghost" onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}

/* ---------- Classements ---------- */
function Classements({ tournament }) {
  const ref = useRef(null);
  if (tournament.divisions.length === 0) return <div class="card"><p class="muted">Ce format n'a pas de poules.</p></div>;
  return (
    <div>
      <div class="btn-row"><button class="btn-ghost" onClick={() => ref.current && exportPng(ref.current, 'classements.png')}>Exporter en image</button></div>
      <div ref={ref}>
        {tournament.divisions.map((div) => (
          <div class="card">
            <h2>{div.name}</h2>
            <StandingsTable tournament={tournament} division={div} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Personnalisation ---------- */
function Perso({ tournament }) {
  const b = tournament.branding || {};
  function upload(e, cb) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => cb(reader.result);
    reader.readAsDataURL(file);
  }
  const [spName, setSpName] = useState('');
  const [spUrl, setSpUrl] = useState('');

  function addSponsor(logo) {
    if (!spName && !logo) return;
    const sponsors = [...(b.sponsors || []), { name: spName || 'Sponsor', url: spUrl || undefined, logoRef: logo || undefined }];
    dispatch(commands.setBranding({ sponsors }));
    setSpName(''); setSpUrl('');
  }

  return (
    <div>
      <div class="card">
        <h2>Identité de l'association</h2>
        <label>Logo</label>
        <input type="file" accept="image/*" onChange={(e) => upload(e, (url) => dispatch(commands.setBranding({ logoRef: url })))} />
        {b.logoRef ? <img src={b.logoRef} style="height:60px;margin-top:8px;border-radius:8px" /> : null}
        <div class="grid2">
          <div><label>Couleur principale</label><input type="color" value={b.primaryColor || '#1e6f5c'} onInput={(e) => dispatch(commands.setBranding({ primaryColor: e.currentTarget.value }))} /></div>
          <div><label>Couleur secondaire</label><input type="color" value={b.secondaryColor || '#f0a500'} onInput={(e) => dispatch(commands.setBranding({ secondaryColor: e.currentTarget.value }))} /></div>
        </div>
      </div>
      <div class="card">
        <h2>Sponsors <span class="muted">(gratuit)</span></h2>
        <SponsorBanner tournament={tournament} />
        <div class="grid2">
          <div><label>Nom</label><input value={spName} onInput={(e) => setSpName(e.currentTarget.value)} /></div>
          <div><label>Lien (optionnel)</label><input value={spUrl} onInput={(e) => setSpUrl(e.currentTarget.value)} placeholder="https://..." /></div>
        </div>
        <label>Logo du sponsor</label>
        <input type="file" accept="image/*" onChange={(e) => upload(e, (url) => addSponsor(url))} />
        <div class="btn-row" style="margin-top:10px"><button onClick={() => addSponsor(null)}>Ajouter (sans logo)</button></div>
      </div>
    </div>
  );
}
