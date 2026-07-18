// @ts-check
/**
 * Applique l'identité visuelle de l'association via des variables CSS.
 * La personnalisation des couleurs = deux variables, appliquées partout
 * (vue publique, QR, exports). 100 % gratuit — le différenciateur du projet.
 * @param {import('../engine/index.js').Branding} [branding]
 */
export function applyTheme(branding = {}) {
  const root = document.documentElement;
  if (branding.primaryColor) root.style.setProperty('--brand', branding.primaryColor);
  else root.style.removeProperty('--brand');
  if (branding.secondaryColor) root.style.setProperty('--brand-2', branding.secondaryColor);
  else root.style.removeProperty('--brand-2');
}

/** Bascule clair/sombre, mémorisée. */
export function toggleDark() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch { /* ignore */ }
}

export function initDark() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch { /* ignore */ }
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}
