// @ts-check
import { signal } from '@preact/signals';

/**
 * Routeur minimal par hash. Format : #/<vue>/<idTournoi>?k=<jeton>
 *
 * Le JETON (capability) est porté par l'URL — pas de compte à créer :
 * - mode serveur : `k` est vérifié par le serveur qui renvoie le rôle
 *   (organisateur / table de marque limitée à des terrains / public) ;
 * - mode local (mono-appareil) : `role=admin` ou rien = organisateur,
 *   `role=public` = lecture seule (aperçu de la page publique).
 */

/** @type {import('@preact/signals').Signal<{view:string, id:string|null, token:string|null, roleHint:string, params:URLSearchParams}>} */
export const route = signal(parse());

function parse() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const view = parts[0] || 'home';
  const id = parts[1] || null;
  const params = new URLSearchParams(query);
  const token = params.get('k');
  const roleHint = params.get('role') || (view === 'public' ? 'public' : 'admin');
  return { view, id, token, roleHint, params };
}

export function navigate(view, id, extra = {}) {
  let url = `#/${view}`;
  if (id) url += `/${id}`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') params.set(k, String(v));
  const q = params.toString();
  if (q) url += `?${q}`;
  location.hash = url;
}

window.addEventListener('hashchange', () => { route.value = parse(); });
