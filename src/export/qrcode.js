// @ts-check
import QRCode from 'qrcode';

/**
 * Génère un QR code (data URL) pointant vers l'URL publique du tournoi.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function qrDataUrl(url) {
  return QRCode.toDataURL(url, { margin: 2, width: 512, errorCorrectionLevel: 'M' });
}

const origin = () => `${location.origin}${location.pathname}`;

/** URL publique d'un tournoi (lecture seule, aucun jeton). */
export function publicUrl(id) {
  return `${origin()}#/public/${id}`;
}

/**
 * URL de gestion avec jeton (organisateur ou table de marque).
 * Mode serveur : `k=<jeton>` vérifié par le serveur.
 * Mode local : `role=admin` / `role=table:1,2` (mono-appareil).
 */
export function manageUrl(id, token, localRole = 'admin') {
  return token ? `${origin()}#/manage/${id}?k=${encodeURIComponent(token)}` : `${origin()}#/manage/${id}?role=${localRole}`;
}

/** URL du mode écran TV (lecture seule). */
export function tvUrl(id) {
  return `${origin()}#/tv/${id}`;
}
