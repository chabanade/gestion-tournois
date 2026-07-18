// @ts-check
import { useState, useEffect } from 'preact/hooks';
import { StandingsTable, MatchRow, BracketView } from '../components.jsx';
import { navigate } from '../router.js';

/**
 * Mode « écran TV » : diaporama automatique pour un écran à la buvette.
 * Gratuit ici — fonctionnalité premium chez les concurrents.
 */
export function TvView({ tournament }) {
  const slides = buildSlides(tournament);
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % slides.length), 8000);
    return () => clearInterval(id);
  }, [slides.length]);

  const slide = slides[i] || slides[0];
  return (
    <div class="tv">
      <div class="btn-row no-print" style="position:absolute;top:12px;right:12px">
        <button onClick={() => navigate('manage', tournament.id, { role: 'admin' })}>Quitter</button>
      </div>
      <h1>{tournament.name}</h1>
      <h2 class="muted">{slide.title}</h2>
      <div style="margin-top:20px;font-size:20px">{slide.render()}</div>
      <div style="position:absolute;bottom:20px;left:0;right:0;text-align:center;color:var(--muted)">
        {slides.map((_, k) => <span style={`display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px;background:${k === i ? 'var(--brand)' : 'var(--border)'}`} />)}
      </div>
    </div>
  );
}

function buildSlides(t) {
  const slides = [];
  const scheduled = t.matches.filter((m) => m.slot).sort((a, b) => a.slot.startMin - b.slot.startMin);
  const next = scheduled.filter((m) => !m.result?.finished).slice(0, 8);
  slides.push({ title: 'Prochains matchs', render: () => next.length ? next.map((m) => <MatchRow tournament={t} match={m} />) : <p>Terminé</p> });
  for (const div of t.divisions) {
    slides.push({ title: div.name, render: () => <StandingsTable tournament={t} division={div} /> });
  }
  if (t.matches.some((m) => m.phase === 'knockout')) {
    slides.push({ title: 'Phases finales', render: () => <BracketView tournament={t} /> });
  }
  return slides;
}
