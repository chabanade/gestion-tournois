// @ts-check
import { useEffect } from 'preact/hooks';
import { route, navigate } from './router.js';
import { tournament, session, open, syncNow } from '../store/store.js';
import { applyTheme, toggleDark } from './theme.js';
import { HomeView } from './views/home.jsx';
import { CreateView } from './views/create.jsx';
import { ManageView } from './views/manage.jsx';
import { PublicView } from './views/public.jsx';
import { TvView } from './views/tv.jsx';

export function App() {
  const r = route.value;
  const t = tournament.value;
  const s = session.value;

  // Charge le tournoi de l'URL s'il n'est pas déjà en mémoire (ou si le jeton change).
  useEffect(() => {
    if (r.id && (!t || t.id !== r.id || (r.token && r.token !== s.token))) {
      open(r.id, r.token || (r.roleHint === 'public' ? 'public' : null));
    }
  }, [r.id, r.token]);

  // Applique le thème de l'association.
  useEffect(() => { applyTheme(t?.branding); }, [t?.branding?.primaryColor, t?.branding?.secondaryColor]);

  const needsTournament = ['manage', 'public', 'tv'].includes(r.view);
  const ready = !needsTournament || (t && t.id === r.id);

  if (r.view === 'tv' && ready) return <TvView tournament={t} />;

  return (
    <div>
      <div class="topbar">
        {t?.branding?.logoRef ? <img class="logo" src={t.branding.logoRef} alt="" /> : null}
        <span class="title" onClick={() => navigate('home')} style="cursor:pointer">
          {t && needsTournament ? t.name : 'Gestion de tournois'}
        </span>
        <span class="spacer" />
        <StatusBadge />
        <button class="btn-ghost" onClick={toggleDark} aria-label="thème">◐</button>
      </div>
      <div class="brand-strip" style="height:4px;margin:-16px -16px 16px;background:linear-gradient(90deg,var(--brand),var(--brand-2))" />
      {s.lastError ? <div class="warn-box" style="margin-bottom:12px">{s.lastError}</div> : null}
      <div class="app-body">
        {r.view === 'home' && <HomeView />}
        {r.view === 'create' && <CreateView />}
        {r.view === 'manage' && (ready ? <ManageView tournament={t} /> : <Loading />)}
        {r.view === 'public' && (ready ? <PublicView tournament={t} /> : <Loading />)}
        {!['home', 'create', 'manage', 'public', 'tv'].includes(r.view) && <HomeView />}
      </div>
    </div>
  );
}

/** Pastille d'état : mode, connexion temps réel, scores en attente d'envoi. */
function StatusBadge() {
  const s = session.value;
  if (s.mode === 'detecting') return null;
  if (s.mode === 'local') return <span class="pill" title="Mode mono-appareil : les données restent sur cet appareil">local</span>;
  if (!s.online) return <span class="pill" style="background:rgba(214,69,69,.15);color:var(--danger)" title="Hors ligne : vos saisies sont gardées et partiront au retour du réseau">hors ligne{s.pending ? ` · ${s.pending} en attente` : ''}</span>;
  if (s.pending) return <span class="pill" style="background:rgba(217,130,43,.15);color:var(--warn);cursor:pointer" onClick={syncNow} title="Cliquer pour renvoyer">{s.pending} à envoyer</span>;
  return <span class="pill" style={s.connected ? 'background:rgba(31,157,85,.15);color:var(--ok)' : ''} title={s.connected ? 'Temps réel actif' : 'Reconnexion…'}>{s.connected ? '● direct' : '○ direct'}</span>;
}

function Loading() {
  const s = session.value;
  return <div class="empty">{s.lastError ? s.lastError : 'Chargement…'}</div>;
}
