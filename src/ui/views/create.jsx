// @ts-check
import { useState } from 'preact/hooks';
import { makeId, commands } from '../../engine/index.js';
import { createNew, dispatch } from '../../store/store.js';
import { navigate } from '../router.js';
import { formatName } from '../format.js';

const EXAMPLE_TEAMS = [
  'AS Ronde', 'FC Victus', 'Olympique Azur', 'Étoile du Var', 'US Littoral', 'Racing Palmier',
  'AC Mistral', 'Sporting Baou', 'FC Estérel', 'AS Siagne', 'Vélo Club Loup', 'FC Cagnes',
  'US Antibes', 'AS Grasse', 'Nice Ouest', 'FC Paillon',
];

export function CreateView() {
  const [name, setName] = useState('Tournoi du club');
  const [format, setFormat] = useState('groupsKnockout');
  const [teamsText, setTeamsText] = useState('');
  const [groupCount, setGroupCount] = useState(4);
  const [qualifiers, setQualifiers] = useState(2);
  const [doubleLeg, setDoubleLeg] = useState(false);
  const [thirdPlace, setThirdPlace] = useState(true);
  const [courts, setCourts] = useState(2);
  const [duration, setDuration] = useState(15);
  const [pause, setPause] = useState(5);
  const [start, setStart] = useState('09:00');

  const teams = teamsText.split('\n').map((s) => s.trim()).filter(Boolean);

  function fillExample() {
    setName('Tournoi de printemps');
    setTeamsText(EXAMPLE_TEAMS.join('\n'));
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      const { tournament: t, adminToken } = await createNew({ name, format });
      const teamObjs = teams.map((n, i) => ({ id: makeId('team'), name: n, seed: i + 1 }));
      dispatch(commands.setTeams(teamObjs));
      dispatch(commands.generateStructure({
        groupCount, qualifiersPerGroup: qualifiers, doubleLeg, thirdPlace,
      }));
      const [h, m] = start.split(':').map(Number);
      dispatch(commands.setSchedule({ courts, matchDurationMin: duration, breakMin: pause, startMin: h * 60 + m }));
      dispatch(commands.generateScheduleCmd());
      // Mode serveur : le jeton organisateur voyage dans l'URL (lien à garder précieusement).
      navigate('manage', t.id, adminToken ? { k: adminToken } : { role: 'admin' });
    } catch (e) {
      setError(e?.message || 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  const needGroups = format === 'groupsKnockout';
  const minTeams = needGroups ? groupCount * 2 : 2;
  const canSubmit = teams.length >= minTeams;

  return (
    <div>
      <div class="card">
        <h2>1. Informations</h2>
        <label>Nom du tournoi</label>
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <label>Format</label>
        <select value={format} onInput={(e) => setFormat(e.currentTarget.value)}>
          <option value="groupsKnockout">{formatName('groupsKnockout')}</option>
          <option value="roundRobin">{formatName('roundRobin')}</option>
          <option value="knockout">{formatName('knockout')}</option>
        </select>
      </div>

      <div class="card">
        <h2>2. Équipes <span class="muted">({teams.length})</span></h2>
        <p class="muted">Une équipe par ligne — copiez-collez depuis votre liste, pas besoin d'Excel.</p>
        <textarea value={teamsText} onInput={(e) => setTeamsText(e.currentTarget.value)}
          placeholder={'Équipe 1\nÉquipe 2\nÉquipe 3\n...'} />
        <div class="btn-row" style="margin-top:10px">
          <button class="btn-ghost" onClick={fillExample}>Remplir un exemple (16 équipes)</button>
        </div>
      </div>

      <div class="card">
        <h2>3. Format</h2>
        {needGroups ? (
          <div class="grid2">
            <div>
              <label>Nombre de poules</label>
              <input type="number" min="1" max="8" value={groupCount} onInput={(e) => setGroupCount(+e.currentTarget.value)} />
            </div>
            <div>
              <label>Qualifiés par poule</label>
              <input type="number" min="1" max="4" value={qualifiers} onInput={(e) => setQualifiers(+e.currentTarget.value)} />
            </div>
          </div>
        ) : null}
        <label><input type="checkbox" style="width:auto;margin-right:8px" checked={doubleLeg} onChange={(e) => setDoubleLeg(e.currentTarget.checked)} />Aller-retour</label>
        {needGroups ? <label><input type="checkbox" style="width:auto;margin-right:8px" checked={thirdPlace} onChange={(e) => setThirdPlace(e.currentTarget.checked)} />Match pour la 3e place</label> : null}
      </div>

      <div class="card">
        <h2>4. Terrains & horaires</h2>
        <div class="grid2">
          <div><label>Terrains</label><input type="number" min="1" max="8" value={courts} onInput={(e) => setCourts(+e.currentTarget.value)} /></div>
          <div><label>Début</label><input type="time" value={start} onInput={(e) => setStart(e.currentTarget.value)} /></div>
          <div><label>Durée d'un match (min)</label><input type="number" min="5" value={duration} onInput={(e) => setDuration(+e.currentTarget.value)} /></div>
          <div><label>Pause entre matchs (min)</label><input type="number" min="0" value={pause} onInput={(e) => setPause(+e.currentTarget.value)} /></div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn-primary" disabled={!canSubmit || busy} onClick={submit}>{busy ? 'Création…' : 'Créer le tournoi'}</button>
        <button class="btn-ghost" onClick={() => navigate('home')}>Annuler</button>
      </div>
      {!canSubmit ? <p class="muted">Il faut au moins {minTeams} équipes pour ce format.</p> : null}
      {error ? <p class="warn-box">{error}</p> : null}
    </div>
  );
}
