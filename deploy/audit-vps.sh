#!/usr/bin/env bash
# =============================================================================
#  audit-vps.sh — Audit de nettoyage d'un VPS Ubuntu + Docker, EN LECTURE SEULE
#
#  Usage (en root sur le VPS) :
#    curl -fsSL <url>/audit-vps.sh | bash
#
#  GARANTIES :
#   - ne supprime RIEN, ne redémarre RIEN, ne modifie AUCUNE configuration ;
#   - le seul fichier écrit est le rapport : /root/audit-vps-<machine>-<date>.txt ;
#   - tourne en priorité minimale (nice 19 + ionice idle) pour ne pas gêner
#     les services sur un serveur déjà chargé ;
#   - n'affiche AUCUN secret : pas de variables d'environnement des conteneurs,
#     pas de lignes de commande complètes des processus (seulement leur nom),
#     pas de contenu de fichiers .env.
#
#  Durée : 1 à 5 minutes selon la taille du disque.
# =============================================================================
set -uo pipefail

STAMP="$(date +%Y%m%d-%H%M)"
HOST="$(hostname 2>/dev/null || echo vps)"
REPORT="/root/audit-vps-${HOST}-${STAMP}.txt"

PISTES=()            # pistes de nettoyage : "gain_octets|risque|texte"
ALERTES=()           # points de vigilance (ressources, santé)

have()  { command -v "$1" >/dev/null 2>&1; }
hr()    { local b="${1:-0}"; numfmt --to=iec --suffix=o --format='%.1f' "$b" 2>/dev/null || echo "${b} o"; }
title() { printf '\n\n==================== %s ====================\n' "$*"; }
sub()   { printf '\n--- %s ---\n' "$*"; }
piste() { PISTES+=("${1:-0}|$2|$3"); }
alerte(){ ALERTES+=("$*"); }
dirbytes() { [[ -e "$1" ]] && timeout 600 du -xsb "$1" 2>/dev/null | awk '{print $1}' || echo 0; }

# -----------------------------------------------------------------------------
section_systeme() {
  title "1. MACHINE"
  local os="?"; [[ -r /etc/os-release ]] && os="$(. /etc/os-release; echo "${PRETTY_NAME:-?}")"
  echo "Machine        : $HOST"
  echo "Système        : $os — noyau $(uname -r)"
  echo "Démarré depuis : $(uptime -p 2>/dev/null || uptime)"
  echo "Processeurs    : $(nproc 2>/dev/null || echo ?) cœur(s)"
  echo "Charge (1/5/15 min) : $(cut -d' ' -f1-3 /proc/loadavg)"
  local load1 cores
  load1="$(cut -d' ' -f1 /proc/loadavg)"; cores="$(nproc 2>/dev/null || echo 1)"
  if awk -v l="$load1" -v c="$cores" 'BEGIN{exit !(l > c)}'; then
    alerte "Processeur saturé : charge $load1 pour $cores cœur(s)."
  fi

  if have apt; then
    local up
    up="$(apt list --upgradable 2>/dev/null | grep -c upgradable || true)"
    echo "Mises à jour en attente : ${up:-0}"
  fi
  if [[ -f /var/run/reboot-required ]]; then
    echo "Redémarrage requis : OUI (mise à jour du noyau ou de bibliothèques en attente)"
    alerte "Un redémarrage est requis pour finir des mises à jour."
  else
    echo "Redémarrage requis : non"
  fi
}

# -----------------------------------------------------------------------------
section_memoire_cpu() {
  title "2. MÉMOIRE ET PROCESSEUR"
  free -h
  sub "Swap (mémoire de secours sur disque)"
  if [[ -n "$(swapon --show --noheadings 2>/dev/null)" ]]; then swapon --show; else echo "AUCUN swap configuré"; fi

  local total avail pct
  total="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
  avail="$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
  pct=$(( avail * 100 / (total > 0 ? total : 1) ))
  echo; echo "Mémoire réellement disponible : ${pct}%"
  if (( pct < 15 )); then alerte "Mémoire presque pleine : seulement ${pct}% disponible."; fi
  if [[ -z "$(swapon --show --noheadings 2>/dev/null)" ]] && (( pct < 25 )); then
    alerte "Pas de swap et mémoire tendue : risque d'arrêt brutal de services (OOM)."
  fi

  sub "Processus les plus gourmands en MÉMOIRE (top 15)"
  ps -eo rss=,pcpu=,user=,comm= --sort=-rss 2>/dev/null | head -15 \
    | awk '{printf "%8.0f Mo  %5s%% CPU  %-12s %s\n", $1/1024, $2, $3, $4}'

  sub "Processus les plus gourmands en PROCESSEUR (instantané sur 3 s)"
  if have top; then
    top -b -n 2 -d 3 -o %CPU 2>/dev/null | awk '/^top -/{n++} n==2' | sed -n '7,22p'
  fi

  sub "Vol de processeur par l'hébergeur (colonne st) et attente disque (colonne wa)"
  have vmstat && vmstat 2 3

  if have journalctl; then
    local oom
    oom="$(journalctl -k --since '-14 days' --no-pager 2>/dev/null | grep -ciE 'out of memory|oom-kill|killed process' || true)"
    echo; echo "Arrêts forcés par manque de mémoire (OOM) sur 14 jours : ${oom:-0}"
    (( ${oom:-0} > 0 )) && alerte "$oom arrêt(s) de processus par manque de mémoire en 14 jours."
  fi
}

# -----------------------------------------------------------------------------
section_disque() {
  title "3. DISQUE"
  df -h -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null
  sub "Inodes (nombre de fichiers)"
  df -i / 2>/dev/null | tail -1

  local usep
  usep="$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"
  if (( ${usep:-0} >= 90 )); then alerte "Disque principal plein à ${usep}% : URGENT.";
  elif (( ${usep:-0} >= 80 )); then alerte "Disque principal rempli à ${usep}%."; fi

  sub "Plus gros dossiers à la racine"
  timeout 900 du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -15
  local d
  for d in /opt /var /var/lib /root /home /srv; do
    [[ -d "$d" ]] || continue
    sub "Plus gros dans $d"
    timeout 600 du -xh --max-depth=1 "$d" 2>/dev/null | sort -rh | head -12
  done

  sub "Plus gros fichiers (> 200 Mo, hors couches Docker)"
  timeout 900 find / -xdev \( -path /proc -o -path /sys -o -path /var/lib/docker/overlay2 -o -path /var/lib/containerd \) -prune \
    -o -type f -size +200M -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null \
    | sort -rn | head -20 | while IFS=$'\t' read -r s dt p; do printf '%10s  %s  %s\n' "$(hr "$s")" "$dt" "$p"; done

  sub "Fichiers système nettoyables"
  local j apt_b snap_b tmp_b
  if have journalctl; then
    echo "Journaux système (journald) : $(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMGT]' | head -1)"
    j="$(dirbytes /var/log/journal)"
    (( j > 500*1024*1024 )) && piste "$(( j - 500*1024*1024 ))" "SANS RISQUE" "Limiter les journaux système (journald) à 500 Mo — actuellement $(hr "$j")."
  fi
  apt_b="$(dirbytes /var/cache/apt)"
  echo "Cache des paquets (apt)     : $(hr "$apt_b")"
  (( apt_b > 100*1024*1024 )) && piste "$apt_b" "SANS RISQUE" "Vider le cache des paquets téléchargés (apt clean)."
  echo "Dossier /var/log            : $(hr "$(dirbytes /var/log)")"
  tmp_b=$(( $(dirbytes /tmp) + $(dirbytes /var/tmp) ))
  echo "Fichiers temporaires        : $(hr "$tmp_b")"
  (( tmp_b > 500*1024*1024 )) && piste "$tmp_b" "À VÉRIFIER" "Fichiers temporaires volumineux dans /tmp et /var/tmp."

  if have snap; then
    snap_b="$(dirbytes /var/lib/snapd/snaps)"
    local disabled
    disabled="$(snap list --all 2>/dev/null | awk '/disabled/' | wc -l)"
    echo "Snaps : $(hr "$snap_b") — anciennes versions désactivées : $disabled"
    (( disabled > 0 )) && piste 0 "SANS RISQUE" "$disabled ancienne(s) version(s) de snaps désactivées à retirer."
  fi

  if have dpkg; then
    local kernels
    kernels="$(dpkg -l 'linux-image-[0-9]*' 2>/dev/null | awk '/^ii/{print $2}' | wc -l)"
    echo "Noyaux Linux installés      : $kernels (en service : $(uname -r))"
    (( kernels > 2 )) && piste 0 "SANS RISQUE" "$kernels noyaux installés : retirer les anciens (apt autoremove, après redémarrage)."
  fi

  sub "Gros fichiers de journaux (> 100 Mo) dans /var/log"
  find /var/log -xdev -type f -size +100M -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -10 \
    | while IFS=$'\t' read -r s p; do printf '%10s  %s\n' "$(hr "$s")" "$p"; done
}

# -----------------------------------------------------------------------------
section_docker() {
  title "4. DOCKER"
  if ! have docker || ! docker info >/dev/null 2>&1; then
    echo "Docker absent ou injoignable sur cette machine."
    return
  fi
  echo "Version : $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  echo "Dossier Docker : $(docker info --format '{{.DockerRootDir}}' 2>/dev/null) — $(hr "$(dirbytes "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)")")"

  sub "Résumé (colonne RECLAIMABLE = place récupérable)"
  docker system df 2>/dev/null

  sub "Projets docker compose"
  docker compose ls -a 2>/dev/null || echo "(commande indisponible)"

  sub "Conteneurs : état et taille propre"
  docker ps -a --size --format 'table {{.Names}}\t{{.State}}\t{{.Status}}\t{{.Size}}' 2>/dev/null

  sub "Consommation en direct des conteneurs qui tournent"
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null

  sub "Conteneurs arrêtés (candidats au nettoyage, à vérifier)"
  local stopped
  stopped="$(docker ps -a --filter status=exited --filter status=created --filter status=dead \
             --format '{{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null)"
  if [[ -n "$stopped" ]]; then
    echo "$stopped"
    piste 0 "À VÉRIFIER" "$(wc -l <<<"$stopped") conteneur(s) arrêté(s) : vérifier s'ils servent encore, puis les retirer."
  else
    echo "Aucun."
  fi

  sub "Conteneurs en mauvaise santé ou qui redémarrent en boucle"
  local id name rc health bad=0
  while read -r id; do
    [[ -n "$id" ]] || continue
    name="$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##')"
    rc="$(docker inspect --format '{{.RestartCount}}' "$id" 2>/dev/null)"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)"
    if [[ "${rc:-0}" -gt 0 || "$health" == "unhealthy" ]]; then
      echo "$name : redémarrages=$rc santé=${health:-n/a}"; bad=1
      alerte "Conteneur « $name » instable (redémarrages=$rc, santé=${health:-n/a})."
    fi
  done < <(docker ps -aq 2>/dev/null)
  (( bad == 0 )) && echo "Aucun."

  sub "Images Docker NON utilisées par un conteneur"
  local used all unused_b=0 unused_n=0 sz tags created
  used="$(docker ps -aq 2>/dev/null | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null | sort -u)"
  all="$(docker images -q --no-trunc 2>/dev/null | sort -u)"
  while read -r id; do
    [[ -n "$id" ]] || continue
    grep -qxF "$id" <<<"$used" && continue
    sz="$(docker image inspect --format '{{.Size}}' "$id" 2>/dev/null || echo 0)"
    tags="$(docker image inspect --format '{{join .RepoTags ", "}}' "$id" 2>/dev/null)"
    created="$(docker image inspect --format '{{.Created}}' "$id" 2>/dev/null | cut -c1-10)"
    printf '%10s  %s  %s\n' "$(hr "$sz")" "$created" "${tags:-<sans nom>}"
    unused_b=$(( unused_b + sz )); unused_n=$(( unused_n + 1 ))
  done <<<"$all"
  echo "Total : $unused_n image(s), $(hr "$unused_b") (une partie peut être partagée entre images)."
  local dangling
  dangling="$(docker images -qf dangling=true 2>/dev/null | wc -l)"
  echo "Dont images « orphelines » (sans nom) : $dangling"
  (( dangling > 0 )) && piste 0 "SANS RISQUE" "$dangling image(s) Docker orpheline(s) sans nom à retirer."
  (( unused_n > dangling )) && piste "$unused_b" "À VÉRIFIER" "$(( unused_n - dangling )) image(s) Docker nommée(s) non utilisée(s) : vérifier qu'aucun service arrêté n'en a besoin."

  sub "Cache de construction Docker"
  docker system df --format '{{.Type}}: {{.Size}} (récupérable : {{.Reclaimable}})' 2>/dev/null | grep -i build || true
  local bc
  bc="$(docker system df --format '{{.Type}}|{{.Reclaimable}}' 2>/dev/null | awk -F'|' 'tolower($1) ~ /build/ {print $2}')"
  [[ -n "$bc" && "$bc" != 0B* ]] && piste 0 "SANS RISQUE" "Vider le cache de construction Docker (récupérable : $bc). Seul effet : la prochaine reconstruction d'image est plus lente."

  sub "Volumes Docker non rattachés à un conteneur (peuvent contenir des DONNÉES)"
  local v mp vb found=0
  while read -r v; do
    [[ -n "$v" ]] || continue
    mp="$(docker volume inspect --format '{{.Mountpoint}}' "$v" 2>/dev/null)"
    vb="$(dirbytes "$mp")"
    printf '%10s  %s\n' "$(hr "$vb")" "$v"; found=1
    (( vb > 50*1024*1024 )) && piste "$vb" "DÉCISION MEHDI" "Volume Docker non rattaché « $v » ($(hr "$vb")) : peut contenir une ancienne base de données. Ne jamais supprimer sans vérifier."
  done < <(docker volume ls -qf dangling=true 2>/dev/null)
  (( found == 0 )) && echo "Aucun."

  sub "Journaux des conteneurs (fichiers *-json.log)"
  local lp lb ltotal=0
  while read -r id; do
    [[ -n "$id" ]] || continue
    lp="$(docker inspect --format '{{.LogPath}}' "$id" 2>/dev/null)"
    [[ -n "$lp" && -f "$lp" ]] || continue
    lb="$(stat -c %s "$lp" 2>/dev/null || echo 0)"
    ltotal=$(( ltotal + lb ))
    name="$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##')"
    (( lb > 50*1024*1024 )) && printf '%10s  %s\n' "$(hr "$lb")" "$name"
  done < <(docker ps -aq --no-trunc 2>/dev/null)
  echo "Total des journaux de conteneurs : $(hr "$ltotal")"
  (( ltotal > 200*1024*1024 )) && piste "$ltotal" "SANS RISQUE" "Journaux de conteneurs volumineux : activer leur rotation automatique (taille plafonnée)."

  sub "Rotation des journaux Docker configurée globalement ?"
  if [[ -f /etc/docker/daemon.json ]] && grep -qE '"max-size"' /etc/docker/daemon.json; then
    grep -E '"log-driver"|"max-size"|"max-file"' /etc/docker/daemon.json
  else
    echo "NON : les journaux des conteneurs peuvent grossir sans limite."
    alerte "Rotation des journaux Docker non configurée globalement."
  fi
}

# -----------------------------------------------------------------------------
section_sauvegardes() {
  title "5. SAUVEGARDES PRÉSENTES SUR LE SERVEUR"
  local d b n oldest newest found=0
  while read -r d; do
    [[ -n "$d" ]] || continue
    b="$(dirbytes "$d")"
    n="$(find "$d" -type f 2>/dev/null | wc -l)"
    oldest="$(find "$d" -type f -printf '%TY-%Tm-%Td\n' 2>/dev/null | sort | head -1)"
    newest="$(find "$d" -type f -printf '%TY-%Tm-%Td\n' 2>/dev/null | sort | tail -1)"
    printf '%10s  %5s fichiers  du %s au %s  %s\n' "$(hr "$b")" "$n" "${oldest:--}" "${newest:--}" "$d"
    found=1
    (( b > 1024*1024*1024 )) && piste "$b" "DÉCISION MEHDI" "Sauvegardes « $d » : $(hr "$b"). Fixer une durée de conservation, et en garder une copie HORS du serveur."
  done < <(find / -xdev -maxdepth 4 -type d \( -iname '*backup*' -o -iname '*sauvegarde*' -o -iname '*snapshot*' \) \
            -not -path '/proc/*' -not -path '/sys/*' -not -path '/var/lib/docker/*' -not -path '/usr/*' -not -path '/snap/*' 2>/dev/null \
            | awk '{ for (i in seen) if (index($0, i"/") == 1) next; seen[$0]=1; print }')
  (( found == 0 )) && echo "Aucun dossier de sauvegarde trouvé."
}

# -----------------------------------------------------------------------------
section_services() {
  title "6. SERVICES, PORTS ET TÂCHES PLANIFIÉES"
  if have systemctl; then
    sub "Services en échec"
    local failed
    failed="$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}')"
    if [[ -n "$failed" ]]; then echo "$failed"; alerte "Service(s) système en échec : $(tr '\n' ' ' <<<"$failed")";
    else echo "Aucun."; fi
    sub "Services système actifs"
    systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}' | sed 's/\.service$//' | paste -sd ' ' | fold -s -w 110
  fi

  sub "Ports ouverts (programmes à l'écoute)"
  if have ss; then
    ss -ltnpH 2>/dev/null | awk '{print $4, $6}' \
      | sed -E 's/users:\(\("([^"]+)".*/\1/' | sort -u -k2,2 -k1,1 | awk '{printf "%-28s %s\n", $1, $2}'
  fi

  sub "Tâches planifiées (cron) — horaires et programme, sans les arguments"
  ls -1 /etc/cron.d 2>/dev/null | sed 's/^/\/etc\/cron.d\//'
  crontab -l 2>/dev/null | grep -vE '^\s*(#|$)' \
    | awk '{ if ($1 ~ /^@/) print "root : " $1 "  " $2; else print "root : " $1" "$2" "$3" "$4" "$5"  "$6 }'
}

# -----------------------------------------------------------------------------
synthese() {
  title "7. SYNTHÈSE — À COPIER-COLLER À CLAUDE"
  echo "Machine : $HOST — $(date '+%d/%m/%Y %H:%M') — rapport complet : $REPORT"
  echo "Disque  : $(df -h --output=used,size,pcent / 2>/dev/null | tail -1 | awk '{print $1" utilisés sur "$2" ("$3")"}')"
  echo "Mémoire : $(free -h | awk '/^Mem/{print $3" utilisés sur "$2", disponible "$7}')"
  echo "Charge  : $(cut -d' ' -f1-3 /proc/loadavg) pour $(nproc) cœur(s)"

  echo; echo "POINTS DE VIGILANCE :"
  if (( ${#ALERTES[@]} == 0 )); then echo "  aucun"; else printf '  ! %s\n' "${ALERTES[@]}"; fi

  echo; echo "PISTES DE NETTOYAGE (rien n'a été supprimé) :"
  if (( ${#PISTES[@]} == 0 )); then
    echo "  aucune piste évidente"
  else
    local total=0 line g r t
    while IFS='|' read -r g r t; do
      if (( g > 0 )); then printf '  [%-14s] ~%-9s %s\n' "$r" "$(hr "$g")" "$t"; else printf '  [%-14s] %-10s %s\n' "$r" "" "$t"; fi
      [[ "$r" == "SANS RISQUE" ]] && total=$(( total + g ))
    done < <(printf '%s\n' "${PISTES[@]}" | sort -t'|' -k1,1nr)
    echo; echo "Place récupérable SANS RISQUE (estimation basse) : ~$(hr "$total")"
  fi
  echo; echo "Aucune modification n'a été faite sur ce serveur."
}

# -----------------------------------------------------------------------------
main() {
  [[ "$EUID" -eq 0 ]] || { echo "À lancer en root (sudo -i puis relancer)."; exit 1; }
  # Priorité minimale pour tout le script et ses sous-commandes.
  renice -n 19 -p $$ >/dev/null 2>&1 || true
  have ionice && ionice -c3 -p $$ >/dev/null 2>&1 || true

  exec > >(tee "$REPORT") 2>&1
  echo "AUDIT DE NETTOYAGE (lecture seule) — $HOST — $(date '+%d/%m/%Y %H:%M')"
  echo "Patience : 1 à 5 minutes. Rien ne sera supprimé ni modifié."

  section_systeme
  section_memoire_cpu
  section_disque
  section_docker
  section_sauvegardes
  section_services
  synthese
  chmod 600 "$REPORT" 2>/dev/null || true
}

# Lu en entier avant exécution (protège d'un téléchargement tronqué) ;
# stdin fermé : aucune commande ne peut avaler le script quand il arrive par « curl | bash ».
main "$@" </dev/null
