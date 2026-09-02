// @ts-check
import { join } from 'node:path';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * Sauvegardes automatiques — réponse directe à « mon ordinateur plante en plein
 * tournoi » : la base centrale est copiée à chaud, régulièrement, sans
 * interrompre le service, avec rotation.
 *
 * Deux cadences (réglables par variables d'environnement) :
 * - FRÉQUENTE : toutes les BACKUP_EVERY_MIN minutes (défaut 10), on garde les
 *   BACKUP_KEEP_FREQUENT dernières (défaut 48 → 8 h d'historique fin).
 * - QUOTIDIENNE : 1 par jour, on garde BACKUP_KEEP_DAILY (défaut 30).
 * Plus un export JSON lisible de chaque tournoi à chaque sauvegarde fréquente
 * (restaurable depuis l'écran « Importer », même sans serveur).
 *
 * La copie hors serveur (2e VPS / stockage distant) est faite par un script
 * séparé (deploy/offsite-backup.sh) : ce module garantit qu'il y a toujours
 * un fichier propre et cohérent à copier.
 */

export function startBackups(db, dataDir, opts = {}) {
  const everyMin = Number(opts.everyMin ?? process.env.BACKUP_EVERY_MIN ?? 10);
  const keepFrequent = Number(opts.keepFrequent ?? process.env.BACKUP_KEEP_FREQUENT ?? 48);
  const keepDaily = Number(opts.keepDaily ?? process.env.BACKUP_KEEP_DAILY ?? 30);
  const dir = join(dataDir, 'backups');
  const dailyDir = join(dir, 'daily');
  const jsonDir = join(dir, 'json');
  mkdirSync(dailyDir, { recursive: true });
  mkdirSync(jsonDir, { recursive: true });

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      const stamp = ts();
      await db.backup(join(dir, `tournois-${stamp}.sqlite`));
      rotate(dir, /^tournois-.*\.sqlite$/, keepFrequent);

      // Quotidienne : une seule par jour calendaire.
      const day = stamp.slice(0, 8);
      const hasDaily = readdirSync(dailyDir).some((f) => f.startsWith(`tournois-${day}`));
      if (!hasDaily) {
        await db.backup(join(dailyDir, `tournois-${day}.sqlite`));
        rotate(dailyDir, /^tournois-.*\.sqlite$/, keepDaily);
      }

      // Export JSON lisible par tournoi (écrasé à chaque fois : dernier état).
      for (const t of db.listTournaments()) {
        const row = db.getTournament(t.id);
        if (row) writeFileSync(join(jsonDir, `${safe(t.id)}.json`), JSON.stringify(row.state));
      }
    } catch (e) {
      console.error('[backup] échec :', e?.message || e);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(run, Math.max(1, everyMin) * 60 * 1000);
  // Première sauvegarde peu après le démarrage (preuve que ça marche).
  const first = setTimeout(run, 15 * 1000);
  return () => { clearInterval(timer); clearTimeout(first); };
}

/** Exécute une sauvegarde immédiate (test ou demande manuelle). */
export async function backupNow(db, dataDir) {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `tournois-${ts()}-manuel.sqlite`);
  await db.backup(file);
  return file;
}

function rotate(dir, pattern, keep) {
  const files = readdirSync(dir).filter((f) => pattern.test(f))
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const { f } of files.slice(keep)) {
    try { unlinkSync(join(dir, f)); } catch { /* ignore */ }
  }
}

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function safe(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }
