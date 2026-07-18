// @ts-check
import { signal } from '@preact/signals';

/**
 * Routeur minimal par hash. Format : #/<view>/<tournamentId>?role=<token>
 * Le token de rôle (capability) est porté par l'URL — pas de compte à créer.
 * Rôles : 'admin' (tout), 'table:<courts>' (saisie limitée à des terrains),
 * 'public' (lecture seule, défaut).
 */

/** @type {import('@preact/signals').Signal<{view:string, id:string|null, role:string, params:URLSearchParams}>} */
export const route = signal(parse());

function parse() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const view = parts[0] || 'home';
  const id = parts[1] || null;
  const params = new URLSearchParams(query);
  const role = params.get('role') || 'public';
  return { view, id, role, params };
}

export function navigate(view, id, extra = {}) {
  let url = `#/${view}`;
  if (id) url += `/${id}`;
  const params = new URLSearchParams(extra);
  const q = params.toString();
  if (q) url += `?${q}`;
  location.hash = url;
}

window.addEventListener('hashchange', () => { route.value = parse(); });

/** Droits dérivés du rôle courant. */
export function can(role, action, court) {
  if (role === 'admin') return true;
  if (role.startsWith('table:')) {
    if (action === 'score') {
      const courts = role.slice(6).split(',').map(Number);
      return court == null || courts.includes(court);
    }
    return false;
  }
  return false; // public : lecture seule
}
