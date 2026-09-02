// @ts-check
import { useEffect, useState } from 'preact/hooks';
import { exportJson } from '../../store/persistence.js';
import { session, remote, rememberToken } from '../../store/store.js';
import { qrDataUrl, publicUrl, manageUrl, tvUrl } from '../../export/qrcode.js';
import { navigate } from '../router.js';

export function SharePanel({ tournament }) {
  const s = session.value;
  const isServer = s.mode === 'server';
  const [qr, setQr] = useState('');
  const [courts, setCourts] = useState('1');
  const [label, setLabel] = useState('');
  const [tableLinks, setTableLinks] = useState([]);
  const [msg, setMsg] = useState('');
  const pub = publicUrl(tournament.id);
  const adminLink = manageUrl(tournament.id, isServer ? s.token : null);

  useEffect(() => { qrDataUrl(pub).then(setQr).catch(() => {}); }, [pub]);

  const copy = async (txt, what) => {
    try { await navigator.clipboard.writeText(txt); setMsg(`${what} copié ✓`); } catch { setMsg(txt); }
    setTimeout(() => setMsg(''), 2500);
  };
  const nbCourts = tournament.schedule?.courts || 1;

  /** Crée un lien table de marque (mode serveur : jeton signé par le serveur). */
  async function makeTableLink() {
    const list = courts.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) return;
    if (isServer) {
      try {
        const { token } = await remote.createTableToken(tournament.id, list, label || `Terrain ${list.join(',')}`, s.token);
        setTableLinks([...tableLinks, { label: label || `Terrain ${list.join(',')}`, url: manageUrl(tournament.id, token) }]);
      } catch (e) { setMsg(e.message); }
    } else {
      setTableLinks([...tableLinks, { label: `Terrain ${list.join(',')} (mono-appareil)`, url: manageUrl(tournament.id, null, `table:${list.join(',')}`) }]);
    }
    setLabel('');
  }

  /** Lien organisateur qui a fuité → on le régénère, l'ancien ne marche plus. */
  async function rotateAdmin() {
    if (!confirm('Régénérer le lien organisateur ? L\'ancien lien cessera de fonctionner immédiatement.')) return;
    try {
      const { adminToken } = await remote.rotateAdmin(tournament.id, s.token);
      rememberToken(tournament.id, adminToken);
      session.value = { ...session.value, token: adminToken };
      navigate('manage', tournament.id, { k: adminToken });
      setMsg('Nouveau lien organisateur actif ✓');
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div>
      {msg ? <div class="warn-box" style="border-color:var(--ok);color:var(--ok);background:rgba(31,157,85,.1)">{msg}</div> : null}

      <div class="card center">
        <h2>Page publique (spectateurs)</h2>
        <p class="muted">Affichez ce QR code à la buvette : chacun scanne et voit les scores {isServer ? 'en direct' : ''}, sans rien installer.</p>
        {qr ? <img src={qr} alt="QR code" style="width:220px;height:220px" /> : null}
        <div class="btn-row" style="justify-content:center">
          <button onClick={() => copy(pub, 'Lien public')}>Copier le lien public</button>
          <button class="btn-ghost" onClick={() => window.print()}>Imprimer le QR (A4)</button>
          <button class="btn-ghost" onClick={() => navigate('public', tournament.id)}>Voir la page publique</button>
        </div>
        {!isServer ? <p class="warn-box" style="margin-top:12px">Mode mono-appareil : la page publique ne fonctionne que sur cet appareil. Le direct multi-écrans nécessite le serveur.</p> : null}
      </div>

      <div class="card">
        <h2>Lien organisateur (accès complet)</h2>
        <p class="muted">Gardez-le précieusement : c'est votre clé. Ouvrez-le sur votre téléphone pour continuer depuis n'importe où.</p>
        <div class="btn-row">
          <button class="btn-primary" onClick={() => copy(adminLink, 'Lien organisateur')}>Copier le lien organisateur</button>
          {isServer ? <button class="btn-ghost" onClick={rotateAdmin}>Régénérer (si le lien a fuité)</button> : null}
        </div>
      </div>

      <div class="card">
        <h2>Table de marque / arbitres</h2>
        <p class="muted">Un lien par terrain : l'arbitre ne voit que ses matchs et ne peut saisir que ses scores. Rien d'autre.</p>
        <div class="grid2">
          <div><label>Terrains autorisés (ex : 1 ou 1,2)</label><input value={courts} onInput={(e) => setCourts(e.currentTarget.value)} placeholder={`1..${nbCourts}`} /></div>
          <div><label>Nom (optionnel)</label><input value={label} onInput={(e) => setLabel(e.currentTarget.value)} placeholder="Arbitre terrain 1" /></div>
        </div>
        <div class="btn-row" style="margin-top:8px">
          <button onClick={makeTableLink}>Créer le lien</button>
        </div>
        {tableLinks.map((l) => (
          <div class="match">
            <div class="teams"><strong>{l.label}</strong><div class="muted" style="font-size:12px;word-break:break-all">{l.url}</div></div>
            <button onClick={() => copy(l.url, l.label)}>Copier</button>
          </div>
        ))}
      </div>

      <div class="card">
        <h2>Sauvegarde & écran TV</h2>
        <p class="muted">
          {isServer
            ? 'Le serveur sauvegarde automatiquement toutes les 10 minutes. Vous pouvez aussi télécharger une copie complète à tout moment.'
            : 'Exportez une copie complète du tournoi (restaurable à tout moment, même sans réseau).'}
        </p>
        <div class="btn-row">
          <button class="btn-primary" onClick={() => exportJson(tournament)}>Télécharger une copie (JSON)</button>
          <button class="btn-ghost" onClick={() => copy(tvUrl(tournament.id), 'Lien écran TV')}>Copier le lien écran TV</button>
          <button class="btn-ghost" onClick={() => navigate('tv', tournament.id)}>Lancer l'écran TV ici</button>
        </div>
      </div>
    </div>
  );
}
