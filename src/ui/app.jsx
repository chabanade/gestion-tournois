// @ts-check
import { useEffect } from 'preact/hooks';
import { route, navigate } from './router.js';
import { tournament, open } from '../store/store.js';
import { applyTheme, toggleDark } from './theme.js';
import { HomeView } from './views/home.jsx';
import { CreateView } from './views/create.jsx';
import { ManageView } from './views/manage.jsx';
import { PublicView } from './views/public.jsx';
import { TvView } from './views/tv.jsx';

export function App() {
  const r = route.value;
  const t = tournament.value;

  // Charge le tournoi de l'URL s'il n'est pas déjà en mémoire.
  useEffect(() => {
    if (r.id && (!t || t.id !== r.id)) open(r.id);
  }, [r.id]);

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
        <button class="btn-ghost" onClick={toggleDark} aria-label="thème">◐</button>
      </div>
      <div class="brand-strip" style="height:4px;margin:-16px -16px 16px;background:linear-gradient(90deg,var(--brand),var(--brand-2))" />
      <div class="app-body">
        {r.view === 'home' && <HomeView />}
        {r.view === 'create' && <CreateView />}
        {r.view === 'manage' && (ready ? <ManageView tournament={t} role={r.role} /> : <Loading />)}
        {r.view === 'public' && (ready ? <PublicView tournament={t} /> : <Loading />)}
        {!['home', 'create', 'manage', 'public', 'tv'].includes(r.view) && <HomeView />}
      </div>
    </div>
  );
}

function Loading() {
  return <div class="empty">Chargement…</div>;
}
