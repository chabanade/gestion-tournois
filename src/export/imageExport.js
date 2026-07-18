// @ts-check
import { toPng } from 'html-to-image';

/**
 * Exporte un élément DOM (ex : un tableau de classement) en image PNG
 * partageable sur les réseaux sociaux.
 * @param {HTMLElement} node
 * @param {string} filename
 */
export async function exportPng(node, filename = 'classement.png') {
  const dataUrl = await toPng(node, { backgroundColor: getBg(), pixelRatio: 2 });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function getBg() {
  return getComputedStyle(document.body).backgroundColor || '#ffffff';
}
