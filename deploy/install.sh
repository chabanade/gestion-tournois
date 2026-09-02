#!/usr/bin/env bash
# =============================================================================
#  install.sh — Installation / mise à jour de « Gestion de tournois » sur le VPS
#
#  Usage (en root, sur le VPS Ubuntu 24.04) :
#    curl -fsSL https://raw.githubusercontent.com/chabanade/gestion-tournois/main/deploy/install.sh | bash
#
#  Variables optionnelles (à placer AVANT « bash ») :
#    TOURNOIS_BRANCH=ma-branche   branche git à déployer (défaut : main)
#      ex. : curl -fsSL …/install.sh | TOURNOIS_BRANCH=dev bash
#    TOURNOIS_REPO_URL=…          dépôt git (défaut : github.com/chabanade/gestion-tournois)
#
#  Le script est IDEMPOTENT : on peut le relancer autant de fois qu'on veut,
#  il ne refait que ce qui manque. Méthode ARTS :
#    Audit      → on vérifie tout avant de toucher quoi que ce soit ;
#    Réversible → chaque modification a une sauvegarde et un chemin de retour ;
#    Test       → chaque étape est vérifiée avant de passer à la suivante ;
#    Sauvegarde → Caddyfile sauvegardé (10 dernières copies), données jamais effacées.
#
#  Ce que le script touche sur le VPS :
#    /opt/tournois/…                    (code, données, sauvegardes, scripts)
#    /opt/agea/docker/caddy/Caddyfile   (AJOUT d'un bloc entre marqueurs, rien d'autre)
#    /etc/cron.d/tournois-update, /etc/cron.d/tournois-offsite, /etc/logrotate.d/tournois
#    /var/log/tournois-update.log, /var/log/tournois-offsite.log
#  Il ne touche à RIEN d'autre dans /opt/agea (ni conteneurs, ni données AGEA).
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Paramètres
# -----------------------------------------------------------------------------
TOURNOIS_REPO_URL="${TOURNOIS_REPO_URL:-https://github.com/chabanade/gestion-tournois}"
TOURNOIS_BRANCH="${TOURNOIS_BRANCH:-main}"

readonly BASE_DIR=/opt/tournois
readonly REPO_DIR="$BASE_DIR/repo"
readonly DATA_DIR="$BASE_DIR/data"
readonly BACKUP_DIR="$BASE_DIR/backups"
readonly CONFIG_FILE="$BASE_DIR/config.env"
readonly COMPOSE_FILE="$REPO_DIR/deploy/docker-compose.yml"
readonly CADDY_BLOCK_FILE="$REPO_DIR/deploy/Caddyfile.tournois"
readonly IMAGE_NAME="gestion-tournois:local"
readonly CONTAINER_NAME="tournois"
readonly LOCAL_PORT=8787
readonly LOCAL_URL="http://127.0.0.1:${LOCAL_PORT}"
readonly APP_UID_DEFAULT=10001          # doit correspondre à ARG APP_UID du Dockerfile

readonly AGEA_COMPOSE_DIR=/opt/agea/docker
readonly AGEA_COMPOSE_FILE="$AGEA_COMPOSE_DIR/docker-compose.yml"
readonly AGEA_ENV_FILE=/opt/agea/.env
readonly CADDYFILE="$AGEA_COMPOSE_DIR/caddy/Caddyfile"
readonly CADDYFILE_IN_CONTAINER=/etc/caddy/Caddyfile
readonly CADDY_CONTAINER=docker-caddy-1
readonly DOCKER_NETWORK=docker_agea
readonly MARK_BEGIN="# --- gestion-tournois (début) ---"
readonly MARK_END="# --- gestion-tournois (fin) ---"

readonly CRON_UPDATE=/etc/cron.d/tournois-update
readonly CRON_OFFSITE=/etc/cron.d/tournois-offsite
readonly LOGROTATE_FILE=/etc/logrotate.d/tournois
readonly UPDATE_LOG=/var/log/tournois-update.log
readonly OFFSITE_LOG=/var/log/tournois-offsite.log

readonly MIN_FREE_KB=$((2 * 1024 * 1024))   # 2 Go

# Valeur de repli ; relue depuis Caddyfile.tournois une fois le dépôt cloné.
DOMAIN="tournois.srv987452.hstgr.cloud"

# État de la modification Caddy (pour restaurer en cas de sortie inattendue).
CADDY_BACKUP=""
CADDY_DIRTY=0

# -----------------------------------------------------------------------------
# Affichage
# -----------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_BLD=""; C_RST=""
fi
info()  { printf '%s   %s%s\n' "$C_BLU" "$*" "$C_RST"; }
ok()    { printf '%s ✔ %s%s\n' "$C_GRN" "$*" "$C_RST"; }
warn()  { printf '%s ⚠ %s%s\n' "$C_YEL" "$*" "$C_RST" >&2; }
step()  { printf '\n%s%s══ %s ══%s\n' "$C_BLD" "$C_BLU" "$*" "$C_RST"; }
die()   { printf '\n%s ✖ ERREUR : %s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Utilitaires
# -----------------------------------------------------------------------------
now_stamp() { date +%Y%m%d-%H%M%S; }

# Attend qu'une URL /api/health réponde {"ok":true}. wait_http URL SECONDES
wait_http() {
  local url="$1" secs="$2" i out
  for ((i = 1; i <= secs; i++)); do
    # Capture puis test (pas de « | grep -q ») : avec pipefail, grep qui ferme le
    # tube avant la fin de curl ferait échouer le test alors que tout va bien.
    if out="$(curl -fsS --max-time 5 "$url" 2>/dev/null)" && [[ "$out" == *'"ok":true'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false)" == "true" ]]
}

# Le port hôte est-il occupé ? (ss = iproute2, présent sur Ubuntu)
port_in_use() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -Hltn "sport = :${LOCAL_PORT}" 2>/dev/null | grep -q .
}

# Empreinte du Caddyfile côté hôte et côté conteneur (doivent être identiques).
caddyfile_sha_host()      { sha256sum "$CADDYFILE" | awk '{print $1}'; }
caddyfile_sha_container() { docker exec "$CADDY_CONTAINER" cat "$CADDYFILE_IN_CONTAINER" 2>/dev/null | sha256sum | awk '{print $1}'; }

caddy_validate() {
  docker exec "$CADDY_CONTAINER" caddy validate --config "$CADDYFILE_IN_CONTAINER" --adapter caddyfile
}

# Recréation du SEUL conteneur caddy de la pile AGEA (commande imposée : le
# .env est dans /opt/agea, le compose dans /opt/agea/docker ; --no-deps pour ne
# toucher à aucun autre service).
caddy_recreate() {
  ( cd "$AGEA_COMPOSE_DIR" && docker compose --env-file ../.env up -d --force-recreate --no-deps caddy )
}

caddy_wait_running() {
  local i
  for ((i = 1; i <= 30; i++)); do
    container_running "$CADDY_CONTAINER" && return 0
    sleep 1
  done
  return 1
}

# Remet la sauvegarde du Caddyfile EN PLACE (cat > : même inode, jamais mv/sed -i)
# puis recrée Caddy pour qu'il reparte sur la version restaurée.
caddy_restore() {
  [[ -n "$CADDY_BACKUP" && -f "$CADDY_BACKUP" ]] || return 0
  warn "Restauration du Caddyfile depuis $CADDY_BACKUP"
  cat "$CADDY_BACKUP" > "$CADDYFILE"
  if caddy_recreate && caddy_wait_running; then
    ok "Caddy restauré et relancé (les autres sites sont servis normalement)."
  else
    warn "Caddy n'a pas redémarré après restauration — vérifier immédiatement : docker logs $CADDY_CONTAINER"
  fi
  CADDY_DIRTY=0
}

on_exit() {
  local code=$?
  if (( CADDY_DIRTY == 1 )); then
    warn "Sortie inattendue pendant la modification de Caddy → retour arrière automatique."
    caddy_restore || true
  fi
  exit "$code"
}
trap on_exit EXIT

# Retire les sauvegardes Caddyfile au-delà des 10 plus récentes.
rotate_caddy_backups() {
  # « || true » : un dossier sans sauvegarde ne doit jamais interrompre le script (set -e + pipefail).
  ls -1t "$BACKUP_DIR"/Caddyfile.* 2>/dev/null | tail -n +11 | xargs -r rm -f -- || true
}

# =============================================================================
# A. AUDIT — on regarde, on ne touche à rien
# =============================================================================
audit() {
  step "1/7  AUDIT de l'environnement"

  [[ "$EUID" -eq 0 ]] || die "Ce script doit être lancé en root (sudo -i, puis relancer)."
  ok "Exécuté en root"

  local cmd
  for cmd in docker git curl flock awk sha256sum df; do
    command -v "$cmd" >/dev/null 2>&1 || die "Commande manquante : $cmd"
  done
  ok "Outils présents : docker, git, curl, flock"
  command -v rsync >/dev/null 2>&1 || warn "rsync absent : la sauvegarde hors serveur (optionnelle) ne fonctionnera pas tant qu'il n'est pas installé (apt install rsync)."
  command -v ss >/dev/null 2>&1 || warn "ss absent : impossible de vérifier que le port ${LOCAL_PORT} est libre."

  docker info >/dev/null 2>&1 || die "Le démon Docker ne répond pas (systemctl status docker)."
  local compose_version
  compose_version="$(docker compose version --short 2>/dev/null || true)"
  [[ -n "$compose_version" ]] || die "« docker compose » (v2) est introuvable. Installer le paquet docker-compose-plugin."
  [[ "${compose_version%%.*}" -ge 2 ]] || die "docker compose v2 requis (trouvé : $compose_version)."
  ok "Docker opérationnel, docker compose $compose_version"

  docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1 \
    || die "Le réseau Docker « $DOCKER_NETWORK » n'existe pas. C'est celui de la pile AGEA/Caddy : elle doit tourner avant d'installer tournois."
  ok "Réseau Docker « $DOCKER_NETWORK » présent"

  container_running "$CADDY_CONTAINER" \
    || die "Le conteneur « $CADDY_CONTAINER » (Caddy de production) n'est pas en cours d'exécution."
  ok "Conteneur « $CADDY_CONTAINER » en cours d'exécution"

  [[ -f "$CADDYFILE" ]]          || die "Caddyfile introuvable : $CADDYFILE"
  [[ -f "$AGEA_COMPOSE_FILE" ]]  || die "Compose AGEA introuvable : $AGEA_COMPOSE_FILE"
  [[ -f "$AGEA_ENV_FILE" ]]      || die "Fichier .env AGEA introuvable : $AGEA_ENV_FILE"
  ( cd "$AGEA_COMPOSE_DIR" && docker compose --env-file ../.env config --services 2>/dev/null | grep -qx caddy ) \
    || die "Le service « caddy » n'est pas défini dans $AGEA_COMPOSE_FILE (ou le .env ne se lit pas)."
  ok "Pile AGEA : Caddyfile, docker-compose.yml, .env et service « caddy » trouvés"

  docker exec "$CADDY_CONTAINER" test -f "$CADDYFILE_IN_CONTAINER" 2>/dev/null \
    || die "Le conteneur Caddy ne voit pas $CADDYFILE_IN_CONTAINER : montage inattendu, on s'arrête."
  if [[ "$(caddyfile_sha_host)" == "$(caddyfile_sha_container)" ]]; then
    ok "Le Caddyfile vu par le conteneur est identique à celui de l'hôte"
  else
    warn "Le conteneur Caddy voit une version DIFFÉRENTE du Caddyfile (fichier remplacé après un sed -i ?)."
    warn "Le « force-recreate » de l'étape Caddy resynchronisera le montage."
  fi

  local free_kb
  free_kb="$(df -Pk /opt | awk 'NR == 2 {print $4}')"
  [[ "${free_kb:-0}" -ge "$MIN_FREE_KB" ]] \
    || die "Espace disque insuffisant sur /opt : $((free_kb / 1024)) Mo libres, 2 Go requis."
  ok "Espace disque : $((free_kb / 1024 / 1024)) Go libres sur /opt"

  if port_in_use; then
    if container_running "$CONTAINER_NAME"; then
      ok "Port ${LOCAL_PORT} occupé par notre propre conteneur « $CONTAINER_NAME » (mise à jour)"
    else
      die "Le port ${LOCAL_PORT} est déjà utilisé sur l'hôte par un autre programme (ss -ltnp | grep ${LOCAL_PORT})."
    fi
  else
    ok "Port ${LOCAL_PORT} libre sur l'hôte"
  fi

  if getent hosts "$DOMAIN" >/dev/null 2>&1; then
    ok "DNS : $DOMAIN se résout"
  else
    warn "DNS : $DOMAIN ne se résout pas d'ici ; Let's Encrypt échouera tant que l'enregistrement n'existe pas."
  fi

  printf '\n'
  info "Résumé : dépôt $TOURNOIS_REPO_URL (branche $TOURNOIS_BRANCH)"
  info "         code → $REPO_DIR | données → $DATA_DIR | sauvegardes Caddyfile → $BACKUP_DIR"
  info "         site → https://$DOMAIN (via $CADDY_CONTAINER, réseau $DOCKER_NETWORK)"
}

# =============================================================================
# B. CODE — clonage ou mise à jour du dépôt
# =============================================================================
fetch_code() {
  step "2/7  CODE : récupération du dépôt"
  mkdir -p "$BASE_DIR" "$BACKUP_DIR" "$DATA_DIR"
  chmod 750 "$BASE_DIR"

  if [[ -d "$REPO_DIR/.git" ]]; then
    local remote
    remote="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
    [[ "$remote" == "$TOURNOIS_REPO_URL" || "$remote" == "$TOURNOIS_REPO_URL.git" ]] \
      || die "$REPO_DIR pointe vers « $remote », pas vers $TOURNOIS_REPO_URL. Déplacer ce dossier avant de relancer."
    local before
    before="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
    info "Dépôt déjà présent (commit $before) → mise à jour vers origin/$TOURNOIS_BRANCH"
    git -C "$REPO_DIR" fetch --prune --quiet origin "$TOURNOIS_BRANCH" \
      || die "git fetch a échoué (réseau ? branche « $TOURNOIS_BRANCH » inexistante ?)."
    # /opt/tournois/repo est une COPIE DE DÉPLOIEMENT : on écrase toute modification locale.
    git -C "$REPO_DIR" checkout --quiet -B "$TOURNOIS_BRANCH" "origin/$TOURNOIS_BRANCH"
    git -C "$REPO_DIR" reset --quiet --hard "origin/$TOURNOIS_BRANCH"
  elif [[ -e "$REPO_DIR" ]]; then
    die "$REPO_DIR existe mais n'est pas un dépôt git. Le déplacer (mv) avant de relancer — le script n'efface rien."
  else
    info "Clonage de $TOURNOIS_REPO_URL (branche $TOURNOIS_BRANCH)…"
    git clone --quiet --branch "$TOURNOIS_BRANCH" "$TOURNOIS_REPO_URL" "$REPO_DIR" \
      || die "git clone a échoué (réseau ? branche « $TOURNOIS_BRANCH » inexistante ?)."
  fi
  ok "Code en place : $(git -C "$REPO_DIR" log -1 --format='%h du %cd — %s' --date=format:'%d/%m/%Y %H:%M')"

  [[ -f "$REPO_DIR/Dockerfile" && -f "$COMPOSE_FILE" && -f "$CADDY_BLOCK_FILE" ]] \
    || die "La branche « $TOURNOIS_BRANCH » ne contient pas le paquet de déploiement (Dockerfile, deploy/docker-compose.yml, deploy/Caddyfile.tournois). Essayer : TOURNOIS_BRANCH=<branche> …| bash"

  # Le nom de domaine fait foi dans le bloc Caddy (une seule source de vérité).
  local d
  d="$(grep -vE '^[[:space:]]*(#|$)' "$CADDY_BLOCK_FILE" | head -n 1 | awk '{print $1}')"
  [[ -n "$d" ]] && DOMAIN="$d"

  # Mémorise les choix pour update.sh / uninstall.sh (relus à chaque cron).
  cat > "$CONFIG_FILE" <<EOF
# Généré par install.sh le $(date '+%d/%m/%Y %H:%M') — relancer install.sh pour changer.
TOURNOIS_REPO_URL="$TOURNOIS_REPO_URL"
TOURNOIS_BRANCH="$TOURNOIS_BRANCH"
TOURNOIS_DOMAIN="$DOMAIN"
EOF
  chmod 640 "$CONFIG_FILE"
}

# =============================================================================
# C. BUILD & RUN — image, droits sur /data, démarrage, test local
# =============================================================================
build_and_run() {
  step "3/7  BUILD de l'image et démarrage du conteneur"

  info "Construction de l'image (première fois : quelques minutes)…"
  docker compose -f "$COMPOSE_FILE" build || die "La construction de l'image a échoué (voir les messages ci-dessus)."
  ok "Image $IMAGE_NAME construite"

  # Droits sur le dossier de données : il doit appartenir à l'utilisateur « app »
  # de l'image (sinon SQLite ne peut pas créer sa base).
  local app_uid
  app_uid="$(docker run --rm --entrypoint id "$IMAGE_NAME" -u app 2>/dev/null || true)"
  [[ "$app_uid" =~ ^[0-9]+$ ]] || { warn "uid de « app » introuvable dans l'image, repli sur $APP_UID_DEFAULT"; app_uid="$APP_UID_DEFAULT"; }
  if [[ "$(stat -c %u "$DATA_DIR")" != "$app_uid" ]]; then
    chown -R "$app_uid:$app_uid" "$DATA_DIR"
  fi
  chmod 750 "$DATA_DIR"
  ok "Dossier de données $DATA_DIR (propriétaire uid $app_uid)"

  info "Démarrage du conteneur…"
  docker compose -f "$COMPOSE_FILE" up -d || die "docker compose up a échoué."

  info "Attente de la réponse de $LOCAL_URL/api/health (60 s max)…"
  if ! wait_http "$LOCAL_URL/api/health" 60; then
    printf '\n%s--- Derniers logs du conteneur %s ---%s\n' "$C_YEL" "$CONTAINER_NAME" "$C_RST"
    docker compose -f "$COMPOSE_FILE" logs --tail 100 || true
    die "Le service ne répond pas sur $LOCAL_URL/api/health. Caddy n'a PAS été modifié."
  fi
  ok "Le service répond en local ($LOCAL_URL/api/health)"
}

# =============================================================================
# D. CADDY — ajout réversible du bloc de site
# =============================================================================
configure_caddy() {
  step "4/7  CADDY : publication de https://$DOMAIN"

  local block_present=0
  grep -qF -- "$MARK_BEGIN" "$CADDYFILE" && block_present=1

  if (( block_present )) && [[ "$(caddyfile_sha_host)" == "$(caddyfile_sha_container)" ]]; then
    ok "Le bloc « gestion-tournois » est déjà dans le Caddyfile et vu par Caddy : rien à changer."
  else
    # --- Sauvegarde (et rotation : 10 dernières) ---
    CADDY_BACKUP="$BACKUP_DIR/Caddyfile.$(now_stamp)"
    cp -p "$CADDYFILE" "$CADDY_BACKUP"
    rotate_caddy_backups
    ok "Caddyfile sauvegardé : $CADDY_BACKUP"

    if (( block_present )); then
      warn "Bloc présent sur l'hôte mais pas vu par Caddy → validation puis recréation du conteneur."
    else
      # --- Fichier CANDIDAT (jamais de sed -i : un sed -i change l'inode et le
      #     conteneur continuerait à lire l'ancien fichier). ---
      local candidate="$BACKUP_DIR/Caddyfile.candidat"
      {
        cat "$CADDYFILE"
        # garantit un saut de ligne final avant le bloc
        [[ -z "$(tail -c1 "$CADDYFILE")" ]] || printf '\n'
        printf '\n'
        cat "$CADDY_BLOCK_FILE"
      } > "$candidate"
      # Copie EN PLACE (cat > … conserve l'inode → le conteneur voit le nouveau contenu).
      CADDY_DIRTY=1
      cat "$candidate" > "$CADDYFILE"
      rm -f -- "$candidate"
      ok "Bloc « gestion-tournois » ajouté au Caddyfile"
    fi
    CADDY_DIRTY=1

    # --- Validation par le Caddy du conteneur (même binaire, même version) ---
    info "Validation de la configuration Caddy…"
    if ! caddy_validate; then
      caddy_restore
      die "Le Caddyfile modifié est INVALIDE : sauvegarde restaurée, Caddy inchangé."
    fi
    ok "Configuration Caddy valide"

    # --- Application : recréation du seul conteneur caddy ---
    info "Recréation du conteneur Caddy (coupure de 1 à 2 s pour tous les sites)…"
    if ! caddy_recreate || ! caddy_wait_running; then
      caddy_restore
      die "Caddy n'a pas redémarré avec la nouvelle configuration : sauvegarde restaurée."
    fi
    ok "Caddy relancé"
    CADDY_DIRTY=0
  fi

  container_running "$CADDY_CONTAINER" || die "Caddy ne tourne plus ! Vérifier : docker logs $CADDY_CONTAINER"

  info "Attente de https://$DOMAIN/api/health (90 s max, le certificat peut prendre quelques secondes)…"
  if wait_http "https://$DOMAIN/api/health" 90; then
    ok "https://$DOMAIN répond"
  else
    printf '\n%s--- Derniers logs de %s ---%s\n' "$C_YEL" "$CADDY_CONTAINER" "$C_RST"
    docker logs --tail 50 "$CADDY_CONTAINER" 2>&1 | grep -iE "tournois|error|warn" || true
    warn "Caddy tourne (les autres sites sont OK) mais https://$DOMAIN ne répond pas encore."
    warn "Causes probables : DNS pas encore propagé, certificat en cours d'obtention, port 80/443 filtré."
    die "Vérifier dans quelques minutes : curl -s https://$DOMAIN/api/health ; puis relancer ce script."
  fi
}

# =============================================================================
# E. AUTO-UPDATE — update.sh + cron toutes les 5 minutes
# =============================================================================
install_auto_update() {
  step "5/7  MISE À JOUR AUTOMATIQUE (cron toutes les 5 minutes)"

  cat > "$BASE_DIR/update.sh" <<'EOF'
#!/usr/bin/env bash
# =============================================================================
#  update.sh — mise à jour automatique de « Gestion de tournois »
#  Lancé toutes les 5 minutes par /etc/cron.d/tournois-update (généré par install.sh).
#  - Si origin/<branche> a avancé : déploie, teste /api/health, sinon RETOUR ARRIÈRE.
#  - Un verrou (flock) empêche deux mises à jour simultanées.
#  - Journal : /var/log/tournois-update.log
# =============================================================================
set -euo pipefail

CONFIG=/opt/tournois/config.env
LOG=/var/log/tournois-update.log
LOCK=/opt/tournois/.update.lock
FAILED_MARK=/opt/tournois/.update-failed   # commit dont le déploiement a échoué (ne pas réessayer en boucle)
REPO_DIR=/opt/tournois/repo
COMPOSE_FILE="$REPO_DIR/deploy/docker-compose.yml"
HEALTH_URL="http://127.0.0.1:8787/api/health"

# shellcheck source=/dev/null
source "$CONFIG"
BRANCH="${TOURNOIS_BRANCH:-main}"

# Tout ce qui s'affiche va dans le journal (et à l'écran si lancé à la main).
if [[ -t 1 ]]; then exec > >(tee -a "$LOG") 2>&1; else exec >>"$LOG" 2>&1; fi
log() { printf '%s [update] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# Verrou : si une mise à jour est déjà en cours, on s'en va sans rien faire.
exec 9>"$LOCK"
flock -n 9 || exit 0

wait_health() {
  local i out
  for ((i = 1; i <= 60; i++)); do
    # Capture puis test (pas de « | grep -q ») : évite le faux échec dû à pipefail.
    if out="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)" && [[ "$out" == *'"ok":true'* ]]; then return 0; fi
    sleep 1
  done
  return 1
}
deploy() { docker compose -f "$COMPOSE_FILE" up -d --build; }

cd "$REPO_DIR"
git fetch --prune --quiet origin "$BRANCH" || { log "git fetch impossible (réseau ?) — on réessaiera."; exit 0; }
old="$(git rev-parse HEAD)"
new="$(git rev-parse "origin/$BRANCH")"
[[ "$old" == "$new" ]] && exit 0

if [[ -f "$FAILED_MARK" && "$(cat "$FAILED_MARK")" == "$new" ]]; then
  # Ce commit a déjà échoué : on attend un commit plus récent.
  exit 0
fi

log "Nouvelle version détectée : ${old:0:7} → ${new:0:7} (branche $BRANCH)"
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
git reset --quiet --hard "$new"

if deploy && wait_health; then
  log "OK : version ${new:0:7} déployée et /api/health répond."
  rm -f "$FAILED_MARK"
  # Ménage : anciennes images de CE projet uniquement (filtre par étiquette).
  docker image prune -f --filter "label=fr.tournois.app=gestion-tournois" >/dev/null 2>&1 || true
  exit 0
fi

log "ÉCHEC du déploiement de ${new:0:7} → RETOUR ARRIÈRE vers ${old:0:7}"
printf '%s\n' "$new" > "$FAILED_MARK"
docker compose -f "$COMPOSE_FILE" logs --tail 50 || true
git reset --quiet --hard "$old"
if deploy && wait_health; then
  log "Retour arrière réussi : ${old:0:7} en service. Corriger le commit ${new:0:7} puis pousser un nouveau commit."
else
  log "RETOUR ARRIÈRE ÉCHOUÉ — intervention manuelle requise : docker logs tournois"
fi
exit 1
EOF
  chmod 750 "$BASE_DIR/update.sh"
  ok "Script $BASE_DIR/update.sh écrit"

  cat > "$CRON_UPDATE" <<EOF
# Mise à jour automatique de gestion-tournois (généré par install.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root $BASE_DIR/update.sh
EOF
  chmod 644 "$CRON_UPDATE"
  touch "$UPDATE_LOG"
  ok "Cron $CRON_UPDATE installé (journal : $UPDATE_LOG)"

  if [[ -d /etc/logrotate.d ]]; then
    cat > "$LOGROTATE_FILE" <<EOF
# Rotation des journaux de gestion-tournois (généré par install.sh)
$UPDATE_LOG $OFFSITE_LOG {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
EOF
    chmod 644 "$LOGROTATE_FILE"
    ok "Rotation des journaux : $LOGROTATE_FILE"
  fi
}

# =============================================================================
# F. SAUVEGARDE HORS SERVEUR — désactivée tant que offsite.env n'existe pas
# =============================================================================
install_offsite_backup() {
  step "6/7  SAUVEGARDE HORS SERVEUR (optionnelle)"

  cat > "$BASE_DIR/offsite-backup.sh" <<'EOF'
#!/usr/bin/env bash
# =============================================================================
#  offsite-backup.sh — copie des sauvegardes vers un autre serveur (rsync/ssh)
#  Lancé chaque nuit à 3h30 par /etc/cron.d/tournois-offsite.
#  NE FAIT RIEN tant que /opt/tournois/offsite.env n'existe pas.
#
#  /opt/tournois/offsite.env (à créer à la main, droits 600) :
#    OFFSITE_DEST="user@76.13.62.51:/srv/backups/tournois"   # obligatoire
#    OFFSITE_SSH_KEY="/root/.ssh/id_ed25519_backup"           # optionnel
#    OFFSITE_RSYNC_OPTS=""                                     # optionnel (ex. "--delete")
#  Prérequis : clé SSH sans mot de passe et hôte déjà dans known_hosts
#  (tester une fois à la main : /opt/tournois/offsite-backup.sh).
# =============================================================================
set -euo pipefail

ENV_FILE=/opt/tournois/offsite.env
LOG=/var/log/tournois-offsite.log
SRC=/opt/tournois/data/backups

[[ -f "$ENV_FILE" ]] || exit 0
# shellcheck source=/dev/null
source "$ENV_FILE"
[[ -n "${OFFSITE_DEST:-}" ]] || exit 0

if [[ -t 1 ]]; then exec > >(tee -a "$LOG") 2>&1; else exec >>"$LOG" 2>&1; fi
log() { printf '%s [offsite] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

command -v rsync >/dev/null 2>&1 || { log "rsync absent (apt install rsync)"; exit 1; }
[[ -d "$SRC" ]] || { log "aucune sauvegarde à copier ($SRC absent)"; exit 0; }

ssh_cmd="ssh -o BatchMode=yes -o ConnectTimeout=20"
[[ -n "${OFFSITE_SSH_KEY:-}" ]] && ssh_cmd="$ssh_cmd -i $OFFSITE_SSH_KEY"

# Par défaut, sans --delete : la destination devient une archive qui ne fait que
# grossir (jamais d'effacement distant suite à une erreur locale).
# shellcheck disable=SC2086
if rsync -az --partial --timeout=600 -e "$ssh_cmd" ${OFFSITE_RSYNC_OPTS:-} "$SRC/" "$OFFSITE_DEST/"; then
  log "OK → $OFFSITE_DEST"
else
  log "ÉCHEC rsync vers $OFFSITE_DEST (code $?)"
  exit 1
fi
EOF
  chmod 750 "$BASE_DIR/offsite-backup.sh"

  cat > "$CRON_OFFSITE" <<EOF
# Sauvegarde hors serveur de gestion-tournois, chaque nuit à 3h30 (généré par install.sh)
# Inactive tant que $BASE_DIR/offsite.env n'existe pas.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root $BASE_DIR/offsite-backup.sh
EOF
  chmod 644 "$CRON_OFFSITE"
  touch "$OFFSITE_LOG"

  if [[ -f "$BASE_DIR/offsite.env" ]]; then
    ok "Sauvegarde hors serveur ACTIVE (config : $BASE_DIR/offsite.env, cron 3h30)"
  else
    ok "Sauvegarde hors serveur installée mais INACTIVE (créer $BASE_DIR/offsite.env pour l'activer)"
  fi
}

# =============================================================================
# G. DÉSINSTALLATION — script écrit pour plus tard, jamais exécuté ici
# =============================================================================
write_uninstaller() {
  cat > "$BASE_DIR/uninstall.sh" <<'EOF'
#!/usr/bin/env bash
# =============================================================================
#  uninstall.sh — retire « Gestion de tournois » du VPS, proprement
#  - arrête et supprime le conteneur ;
#  - retire le bloc Caddy entre les marqueurs (sauvegarde + validation + recréation) ;
#  - retire les crons et la rotation de journaux ;
#  - NE SUPPRIME PAS /opt/tournois/data sans confirmation explicite (taper SUPPRIMER).
# =============================================================================
set -euo pipefail

BASE_DIR=/opt/tournois
REPO_DIR="$BASE_DIR/repo"
DATA_DIR="$BASE_DIR/data"
BACKUP_DIR="$BASE_DIR/backups"
COMPOSE_FILE="$REPO_DIR/deploy/docker-compose.yml"
AGEA_COMPOSE_DIR=/opt/agea/docker
CADDYFILE="$AGEA_COMPOSE_DIR/caddy/Caddyfile"
CADDY_CONTAINER=docker-caddy-1
MARK_BEGIN="# --- gestion-tournois (début) ---"
MARK_END="# --- gestion-tournois (fin) ---"

info() { printf '   %s\n' "$*"; }
ok()   { printf ' ✔ %s\n' "$*"; }
warn() { printf ' ⚠ %s\n' "$*" >&2; }
die()  { printf '\n ✖ ERREUR : %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "À lancer en root."

caddy_recreate() { ( cd "$AGEA_COMPOSE_DIR" && docker compose --env-file ../.env up -d --force-recreate --no-deps caddy ); }
caddy_running()  { [[ "$(docker inspect -f '{{.State.Running}}' "$CADDY_CONTAINER" 2>/dev/null || echo false)" == "true" ]]; }
caddy_wait()     { local i; for ((i = 1; i <= 30; i++)); do caddy_running && return 0; sleep 1; done; return 1; }

printf '\n══ Désinstallation de gestion-tournois ══\n\n'

# 1. Conteneur
if [[ -f "$COMPOSE_FILE" ]]; then
  docker compose -f "$COMPOSE_FILE" down --remove-orphans || true
else
  docker rm -f tournois >/dev/null 2>&1 || true
fi
docker image rm gestion-tournois:local >/dev/null 2>&1 || true
ok "Conteneur arrêté et supprimé"

# 2. Bloc Caddy (réversible : sauvegarde + candidat + validation + recréation)
if [[ -f "$CADDYFILE" ]] && grep -qF -- "$MARK_BEGIN" "$CADDYFILE"; then
  caddy_running || die "Caddy ($CADDY_CONTAINER) ne tourne pas : impossible de valider. Relancer la pile AGEA d'abord."
  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/Caddyfile.$(date +%Y%m%d-%H%M%S).avant-desinstallation"
  cp -p "$CADDYFILE" "$backup"
  candidate="$BACKUP_DIR/Caddyfile.candidat"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    { l = $0; sub(/^[ \t]+/, "", l) }
    l == b { skip = 1; next }
    l == e { skip = 0; next }
    !skip { print }
  ' "$CADDYFILE" > "$candidate"
  cat "$candidate" > "$CADDYFILE"        # en place : même inode, jamais mv/sed -i
  rm -f -- "$candidate"
  if docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    if caddy_recreate && caddy_wait; then
      ok "Bloc Caddy retiré, Caddy relancé (sauvegarde : $backup)"
    else
      cat "$backup" > "$CADDYFILE"; caddy_recreate || true
      die "Caddy n'a pas redémarré : Caddyfile restauré depuis $backup."
    fi
  else
    cat "$backup" > "$CADDYFILE"
    die "Caddyfile invalide après retrait du bloc : restauré depuis $backup, rien n'a changé."
  fi
else
  ok "Aucun bloc gestion-tournois dans le Caddyfile"
fi

# 3. Crons, rotation de journaux
rm -f /etc/cron.d/tournois-update /etc/cron.d/tournois-offsite /etc/logrotate.d/tournois
ok "Crons et rotation de journaux retirés"

# 4. Code et scripts (les données et les sauvegardes restent)
rm -rf "$REPO_DIR" "$BASE_DIR/update.sh" "$BASE_DIR/offsite-backup.sh" "$BASE_DIR/.update.lock" "$BASE_DIR/.update-failed"
ok "Code et scripts retirés"

# 5. Données : jamais sans confirmation explicite
printf '\n'
if [[ -d "$DATA_DIR" ]]; then
  info "Les données (tournois + sauvegardes) sont conservées dans $DATA_DIR."
  if [[ -r /dev/tty ]]; then
    printf 'Pour les supprimer DÉFINITIVEMENT, taper SUPPRIMER (autre chose = conserver) : '
    read -r answer </dev/tty || answer=""
    if [[ "$answer" == "SUPPRIMER" ]]; then
      rm -rf "$DATA_DIR"
      ok "Données supprimées"
    else
      ok "Données conservées"
    fi
  else
    warn "Pas de terminal : données conservées (les supprimer à la main si besoin)."
  fi
fi
printf '\nDésinstallation terminée. Restent : %s (données si conservées, sauvegardes Caddyfile, config.env, ce script).\n' "$BASE_DIR"
EOF
  chmod 750 "$BASE_DIR/uninstall.sh"
}

# =============================================================================
# H. RÉSUMÉ
# =============================================================================
summary() {
  step "7/7  TERMINÉ"
  local version
  version="$(git -C "$REPO_DIR" log -1 --format='%h (%cd)' --date=format:'%d/%m/%Y %H:%M' 2>/dev/null || echo '?')"
  cat <<EOF

  ${C_BLD}Site           :${C_RST} https://$DOMAIN
  ${C_BLD}Version        :${C_RST} $version — branche $TOURNOIS_BRANCH
  ${C_BLD}Données        :${C_RST} $DATA_DIR/tournois.sqlite
  ${C_BLD}Sauvegardes    :${C_RST} $DATA_DIR/backups/            (auto : toutes les 10 min + 1/jour, 30 jours)
                   $DATA_DIR/backups/json/       (1 fichier JSON par tournoi, réimportable dans l'appli)
                   $BACKUP_DIR/Caddyfile.*       (10 dernières copies du Caddyfile)
  ${C_BLD}Hors serveur   :${C_RST} $( [[ -f "$BASE_DIR/offsite.env" ]] && echo "actif (3h30)" || echo "inactif — créer $BASE_DIR/offsite.env" )
  ${C_BLD}Mises à jour   :${C_RST} automatiques toutes les 5 min (journal : $UPDATE_LOG)

  Voir les logs      : docker logs -f $CONTAINER_NAME
  Tester             : curl -s https://$DOMAIN/api/health
  Mettre à jour      : pousser sur la branche « $TOURNOIS_BRANCH » (ou relancer ce script)
  Désinstaller       : $BASE_DIR/uninstall.sh

  Aucun secret n'a été échangé ni stocké par ce script.

EOF
}

# =============================================================================
main() {
  printf '%s%s\n  Gestion de tournois — installation / mise à jour sur le VPS\n%s' "$C_BLD" "$C_BLU" "$C_RST"
  audit
  fetch_code
  build_and_run
  configure_caddy
  install_auto_update
  install_offsite_backup
  write_uninstaller
  summary
}

# « main » en fin de fichier : bash a lu TOUT le script avant d'exécuter quoi que
# ce soit (protège d'un téléchargement tronqué via curl | bash).
# stdin est fermé : aucune commande ne peut avaler le reste du script.
main "$@" </dev/null
