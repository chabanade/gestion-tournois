# syntax=docker/dockerfile:1
# =============================================================================
#  Image Docker de « Gestion de tournois » (front Vite/Preact + serveur Node)
#
#  Construction en deux étapes :
#   1. « build »   : installe les dépendances, compile le front (dist/) et
#                    installe les dépendances de production du serveur.
#   2. « runtime » : image légère, utilisateur non-root, ne contient que ce
#                    qu'il faut pour tourner (dist/, server/, src/engine/).
#
#  Le serveur (server/src/index.js) importe ../../src/engine : l'arborescence
#  src/engine/ ET le package.json racine (qui porte "type": "module") doivent
#  donc être présents dans l'image finale.
#
#  Variables d'environnement lues par le serveur :
#    PORT        port d'écoute (défaut 8787)
#    DATA_DIR    dossier des données SQLite + sauvegardes (défaut /data)
#    STATIC_DIR  dossier du front compilé (défaut /app/dist)
# =============================================================================

ARG NODE_IMAGE=node:22-bookworm-slim

# -----------------------------------------------------------------------------
# Étape 1 : build
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /build

# Moins de bruit et pas d'appels réseau inutiles pendant npm.
ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

# --- Front : dépendances d'abord (cache Docker), puis sources, puis build ---
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- Serveur : dépendances de production uniquement ---
# better-sqlite3 télécharge normalement un binaire précompilé (linux glibc,
# Node 22). Si ce téléchargement échoue (réseau, version sans prebuild…), on
# installe les outils de compilation DANS CETTE ÉTAPE SEULEMENT et on recommence.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && ( \
      npm ci --omit=dev \
      || ( echo ">> Binaire précompilé indisponible : compilation locale de better-sqlite3" \
           && apt-get update \
           && apt-get install -y --no-install-recommends python3 make g++ \
           && rm -rf /var/lib/apt/lists/* \
           && npm ci --omit=dev ) \
    )

COPY server/src ./server/src

# -----------------------------------------------------------------------------
# Étape 2 : runtime
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# UID/GID fixes de l'utilisateur applicatif (l'installateur s'en sert pour
# donner les bons droits au dossier de données sur l'hôte).
# 10001 et non 1000 : l'image node possède déjà un utilisateur « node » en 1000.
ARG APP_UID=10001

LABEL fr.tournois.app="gestion-tournois" \
      org.opencontainers.image.title="gestion-tournois" \
      org.opencontainers.image.source="https://github.com/chabanade/gestion-tournois"

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist

# Utilisateur non-root « app », sans shell ni répertoire personnel.
RUN groupadd --gid "${APP_UID}" app \
 && useradd --uid "${APP_UID}" --gid app --home-dir /app --no-create-home \
            --shell /usr/sbin/nologin app \
 && mkdir -p /app /data \
 && chown app:app /data

WORKDIR /app

# Le code reste la propriété de root (lecture seule pour « app ») :
# seul /data est inscriptible par l'application.
COPY --from=build /build/package.json        ./package.json
COPY --from=build /build/dist                ./dist
COPY --from=build /build/src/engine          ./src/engine
COPY --from=build /build/server/package.json ./server/package.json
COPY --from=build /build/server/node_modules ./server/node_modules
COPY --from=build /build/server/src          ./server/src

USER app

EXPOSE 8787
VOLUME ["/data"]

# Contrôle de santé sans curl/wget : fetch() natif de Node.
# --start-period laisse le temps à SQLite de s'ouvrir avant de compter les échecs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server/src/index.js"]
