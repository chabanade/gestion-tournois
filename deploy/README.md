# Mettre « Gestion de tournois » en ligne sur le VPS

Guide pour Mehdi. Aucune connaissance technique nécessaire : une seule commande à coller.

## 1. La commande unique

Se connecter au serveur, puis coller la ligne :

```bash
ssh vps
curl -fsSL https://raw.githubusercontent.com/chabanade/gestion-tournois/main/deploy/install.sh | bash
```

Durée : 2 à 5 minutes la première fois (construction de l'image), moins d'une minute ensuite.
La même commande sert à **installer** et à **mettre à jour** : on peut la relancer sans risque.

> Pour déployer une autre branche que `main` (par exemple pour tester) :
> `curl -fsSL …/install.sh | TOURNOIS_BRANCH=nom-de-la-branche bash`

## 2. Ce que fait le script (dans l'ordre)

Il suit la méthode **ARTS** : il **A**udite avant de toucher, chaque action est **R**éversible,
il **T**este à chaque étape, et il **S**auvegarde avant de modifier.

| Étape | Ce qui se passe | Si ça échoue |
|-------|-----------------|--------------|
| 1. Audit | Vérifie Docker, le réseau, que Caddy tourne, l'espace disque, le port libre. **Ne touche à rien.** | S'arrête avec un message clair. Rien n'a changé. |
| 2. Code | Récupère l'application depuis GitHub dans `/opt/tournois/repo`. | Idem. |
| 3. Démarrage | Construit l'image et lance le conteneur `tournois`. Attend qu'il réponde (60 s). | Affiche les logs et s'arrête. **Caddy n'est pas touché.** |
| 4. Caddy | Sauvegarde le fichier Caddy, ajoute le site `tournois.srv987452.hstgr.cloud`, **valide**, relance Caddy, vérifie que le site répond en HTTPS (90 s). | Restaure la sauvegarde, relance Caddy comme avant, s'arrête. |
| 5. Auto-mise à jour | Toutes les 5 minutes, le serveur regarde si GitHub a changé ; si oui il déploie et teste. Si le test échoue, il **revient tout seul** à la version précédente. | Journal dans `/var/log/tournois-update.log`. |
| 6. Copie hors serveur | Prépare (mais n'active pas) une copie nocturne des sauvegardes vers un autre serveur. | Inactif tant que non configuré. |
| 7. Résumé | Affiche l'adresse du site, où sont les données, les commandes utiles. | — |

Le site AGEA et les autres services du VPS ne sont **jamais modifiés** : la seule chose ajoutée
chez Caddy est un bloc entre deux repères `# --- gestion-tournois (début/fin) ---`.
Relancer Caddy coupe tous les sites pendant 1 à 2 secondes, c'est normal.

## 3. Vérifier que tout marche

- Ouvrir **https://tournois.srv987452.hstgr.cloud** dans un navigateur.
- Sur le serveur : `curl -s https://tournois.srv987452.hstgr.cloud/api/health` doit répondre `{"ok":true,…}`.
- Voir ce que fait l'application en direct : `docker logs -f tournois` (Ctrl+C pour sortir).
- Voir les mises à jour automatiques : `tail -n 30 /var/log/tournois-update.log`.

## 4. Revenir en arrière

- **L'application** : la mise à jour automatique revient seule à la version d'avant si la nouvelle
  ne répond pas. Pour forcer une version précise : pousser un commit sur `main` (ou relancer
  l'installation avec `TOURNOIS_BRANCH=…`), le serveur suit GitHub.
- **Caddy** : les 10 dernières versions du fichier sont dans `/opt/tournois/backups/Caddyfile.<date>`.
  Le script les restaure tout seul en cas de problème pendant l'installation.
- **Tout enlever** : `/opt/tournois/uninstall.sh` — arrête l'application, retire le bloc Caddy,
  retire les tâches automatiques. Il **demande confirmation** (taper `SUPPRIMER`) avant d'effacer
  les données ; par défaut elles sont conservées.

## 5. Où sont les sauvegardes

| Quoi | Où | Rythme |
|------|----|--------|
| Base des tournois | `/opt/tournois/data/tournois.sqlite` | en continu |
| Copies de la base | `/opt/tournois/data/backups/` | toutes les 10 min (8 h d'historique) |
| Copies quotidiennes | `/opt/tournois/data/backups/daily/` | 1 par jour, 30 jours |
| Export lisible par tournoi | `/opt/tournois/data/backups/json/` | à chaque copie (réimportable via « Importer » dans l'appli) |
| Fichier Caddy | `/opt/tournois/backups/Caddyfile.<date>` | à chaque modification, 10 gardées |

**Copie hors serveur (optionnelle)** : créer le fichier `/opt/tournois/offsite.env` avec la ligne
`OFFSITE_DEST="utilisateur@adresse-du-serveur:/srv/backups/tournois"` (accès SSH par clé déjà
en place), tester une fois avec `/opt/tournois/offsite-backup.sh`, puis la copie part chaque
nuit à 3h30. Journal : `/var/log/tournois-offsite.log`.

## 6. Rappel sécurité

**Aucun secret n'a été échangé** : pas de mot de passe, pas de clé, pas de jeton dans ce dépôt
ni dans le script. L'application n'est joignable que par Caddy (HTTPS) ; le port interne 8787
n'est visible que depuis le serveur lui-même (`127.0.0.1`). Les liens organisateur / table de
marque restent des liens privés : ne les partager qu'aux bonnes personnes.
