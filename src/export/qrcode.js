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

/** URL publique d'un tournoi (lecture seule). */
export function publicUrl(id) {
  return `${location.origin}${location.pathname}#/public/${id}`;
}

/** URL admin (capability token dans l'URL). */
export function adminUrl(id) {
  return `${location.origin}${location.pathname}#/manage/${id}?role=admin`;
}

/** URL table de marque limitée à des terrains. */
export function tableUrl(id, courts) {
  return `${location.origin}${location.pathname}#/manage/${id}?role=table:${courts.join(',')}`;
}
