// @ts-check
import { useEffect, useState } from 'preact/hooks';
import { listTournaments, session, prefs } from '../../store/store.js';
import { importJson } from '../../store/persistence.js';
import { navigate } from '../router.js';
import { formatName } from '../format.js';

export function HomeView() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const s = session.value;

  useEffect(() => { listTournaments().then(setItems); }, []);

  async function onImport(e) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    try {
      const t = await importJson(file);
      openTournament(t.id);
    } catch (err) {
      setError(err.message || 'Import impossible.');
    }
  }

  /** Ouvre avec le jeton organisateur mémorisé sur cet appareil (mode serveur). */
  function openTournament(id) {
    const tok = prefs.get().tokens?.[id];
    navigate('manage', id, tok ? { k: tok } : { role: 'admin' });
  }

  return (
    <div>
      <div class="card center">
        <h1>Gestion de tournois</h1>
        <p class="muted">Créez, gérez et diffusez un tournoi complet — gratuitement, même hors ligne.</p>
        {s.mode === 'server'
          ? <p class="muted">✅ Serveur connecté : scores en direct sur tous les écrans, sauvegardes automatiques.</p>
          : s.mode === 'local'
            ? <p class="muted">Mode mono-appareil : les données restent dans ce navigateur. Pensez à exporter.</p>
            : null}
        <div class="btn-row" style="justify-content:center">
          <button class="btn-primary" onClick={() => navigate('create')}>Nouveau tournoi</button>
          <label class="btn btn-ghost" style="margin:0">
            Importer un fichier
            <input type="file" accept="application/json" style="display:none" onChange={onImport} />
          </label>
        </div>
        {error ? <p class="warn-box" style="margin-top:12px">{error}</p> : null}
      </div>

      <div class="card">
        <h2>Mes tournois <span class="muted">(sur cet appareil)</span></h2>
        {items.length === 0 ? (
          <div class="empty">Aucun tournoi pour l'instant. Créez-en un !</div>
        ) : (
          items.map((t) => (
            <div class="match" onClick={() => openTournament(t.id)} style="cursor:pointer">
              <div class="teams">
                <strong>{t.name}</strong>
                <div class="muted">{formatName(t.format)} — {t.teams.length} équipes</div>
              </div>
              <span class="when">Ouvrir →</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
