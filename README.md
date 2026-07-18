# Gestion de tournois

Application web **gratuite** de gestion de tournois sportifs amateurs (foot, futsal,
pétanque, padel…), pensée pour les associations sans budget. Un bénévole crée, gère et
diffuse un tournoi complet (poules + phases finales) en moins de 15 minutes, avec
l'identité visuelle de son association, **sans compte, sans store, hors ligne**, pour **0 €**.

## Ce que ça fait (V1 / MVP)

- **Formats** : poules seules, élimination directe, poules + phases finales, championnat
  (aller simple / aller-retour).
- **Planning automatique** sur 1 à 4 terrains, sans matchs consécutifs pour une équipe,
  durée et pause paramétrables — éditable manuellement (échange de créneaux).
- **Saisie des scores tactile** (grosses cibles +/-), forfait, tirs au but, fair-play.
- **Classements live** avec critères de départage **configurables et ordonnables**
  (points, confrontation directe, différence, buts, discipline, tirage au sort déterministe).
- **Vue publique** (QR code) : planning, classements, arbre, page équipe, **recherche par
  équipe dès l'accueil**, mode **écran TV** (diaporama pour la buvette).
- **Personnalisation gratuite** : logo, couleurs, bandeau **sponsors** cliquable.
- **Rôles par lien** (organisateur / table de marque / public) sans mot de passe.
- **Robuste** : PWA installable et **hors ligne**, sauvegarde locale automatique,
  **export/import JSON** restaurable, impression PDF, export image des classements.

## Architecture

- **Moteur** (`src/engine/`) : JS pur, **zéro dépendance**, sans UI, entièrement testé
  (`node --test`). C'est le cœur — génération, classements, départages récursifs,
  planning, arbre. 100 % des cas de départage FFF/FSGT visés passent.
- **Interface** (`src/ui/`) : Preact + Vite, thème par variables CSS.
- **Données** (`src/store/`) : IndexedDB en local. L'UI ne mute jamais l'état, elle
  *dispatche des commandes* traitées par un réducteur pur — cette frontière permet de
  greffer plus tard le **temps réel** (serveur WebSocket/SSE sur VPS) sans réécriture.

## Développement

```bash
npm install
npm test        # tests du moteur (node:test)
npm run dev     # serveur de dev
npm run build   # build statique dans dist/
npm run preview # sert le build
```

## Déploiement (VPS + Caddy, 0 € marginal)

`npm run build` produit un dossier `dist/` 100 % statique. Voir `Caddyfile.example`.

## Licence

MIT — projet libre et transmissible à l'association (aucun point de défaillance unique).
