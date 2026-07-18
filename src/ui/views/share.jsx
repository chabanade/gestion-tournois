// @ts-check
import { useEffect, useState } from 'preact/hooks';
import { exportJson } from '../../store/persistence.js';
import { qrDataUrl, publicUrl, adminUrl, tableUrl } from '../../export/qrcode.js';
import { navigate } from '../router.js';

export function SharePanel({ tournament }) {
  const [qr, setQr] = useState('');
  const [courts, setCourts] = useState('1');
  const pub = publicUrl(tournament.id);

  useEffect(() => { qrDataUrl(pub).then(setQr).catch(() => {}); }, [pub]);

  const copy = (txt) => navigator.clipboard?.writeText(txt);
  const nbCourts = tournament.schedule?.courts || 1;

  return (
    <div>
      <div class="card center">
        <h2>Page publique (spectateurs)</h2>
        <p class="muted">Affichez ce QR code à la buvette : chacun scanne et voit les scores en direct, sans rien installer.</p>
        {qr ? <img src={qr} alt="QR code" style="width:220px;height:220px" /> : null}
        <div class="btn-row" style="justify-content:center">
          <button onClick={() => copy(pub)}>Copier le lien public</button>
          <button class="btn-ghost" onClick={() => window.print()}>Imprimer le QR (A4)</button>
          <button class="btn-ghost" onClick={() => navigate('public', tournament.id)}>Voir la page publique</button>
        </div>
      </div>

      <div class="card">
        <h2>Liens à rôles (sans compte)</h2>
        <p class="muted">Chaque lien donne un accès différent — pas de mot de passe, tout est dans l'adresse.</p>
        <div class="btn-row">
          <button onClick={() => copy(adminUrl(tournament.id))}>Copier le lien organisateur (accès complet)</button>
        </div>
        <label>Table de marque — terrains autorisés (ex : 1,2)</label>
        <input value={courts} onInput={(e) => setCourts(e.currentTarget.value)} placeholder={`1..${nbCourts}`} />
        <div class="btn-row" style="margin-top:8px">
          <button onClick={() => copy(tableUrl(tournament.id, courts.split(',').map((s) => s.trim()).filter(Boolean)))}>Copier le lien table de marque</button>
        </div>
      </div>

      <div class="card">
        <h2>Sauvegarde</h2>
        <p class="muted">Exportez une copie complète du tournoi (restaurable à tout moment, même sans réseau).</p>
        <div class="btn-row">
          <button class="btn-primary" onClick={() => exportJson(tournament)}>Exporter le tournoi (JSON)</button>
          <button class="btn-ghost" onClick={() => navigate('tv', tournament.id)}>Lancer le mode écran TV</button>
        </div>
      </div>
    </div>
  );
}
