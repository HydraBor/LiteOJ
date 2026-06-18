#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ACTION="${1:-start}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

log() { printf '[LiteOJ] %s\n' "$*"; }
warn() { printf '[LiteOJ][WARN] %s\n' "$*" >&2; }
die() { printf '[LiteOJ][ERROR] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

DOCKER=(docker)
MIRROR_CHANGED=0

random_secret() {
  if have openssl; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

ensure_env() {
  if [ -f "$ENV_FILE" ]; then
    return 0
  fi
  log "Creating .env with random secrets"
  cat > "$ENV_FILE" <<EOF
PORT=${PORT:-3000}
NODE_ENV=production
DATA_DIR=/app/data
DATABASE_PATH=/app/data/liteoj.db
JWT_SECRET=$(random_secret)
JUDGE_TOKEN=$(random_secret)
BACKEND_URL=http://app:3000
JUDGE_POLL_INTERVAL_MS=2000
JUDGE_MAX_OUTPUT_BYTES=1048576
COOKIE_SECURE=auto
EOF
  chmod 600 "$ENV_FILE" || true
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

apt_update() {
  if $SUDO apt-get update; then
    return 0
  fi
  warn "apt update failed, switching Ubuntu/Debian sources to Tsinghua mirror and retrying"
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    $SUDO cp -n /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.liteoj.bak || true
    $SUDO sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|http://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      /etc/apt/sources.list.d/ubuntu.sources
  elif [ -f /etc/apt/sources.list ]; then
    $SUDO cp -n /etc/apt/sources.list /etc/apt/sources.list.liteoj.bak || true
    $SUDO sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|http://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      /etc/apt/sources.list
  fi
  $SUDO apt-get update
}

install_docker_if_needed() {
  if have docker && docker compose version >/dev/null 2>&1; then
    return 0
  fi
  have apt-get || die "Docker auto install currently supports Ubuntu/Debian with apt-get"
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || [ "${ID:-}" = "debian" ] || die "Unsupported OS: ${ID:-unknown}"

  log "Installing Docker Engine and Compose plugin"
  apt_update
  $SUDO apt-get install -y ca-certificates curl gnupg
  $SUDO install -m 0755 -d /etc/apt/keyrings
  $SUDO rm -f /etc/apt/keyrings/docker.gpg
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  local codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || codename="$(lsb_release -cs 2>/dev/null || true)"
  [ -n "$codename" ] || die "Cannot determine OS codename"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${codename} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt_update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO usermod -aG docker "$USER" || true
}

configure_docker_mirrors() {
  [ "${LITEOJ_DOCKER_MIRROR:-1}" = "0" ] && return 0
  if [ -s /etc/docker/daemon.json ] && grep -q 'registry-mirrors' /etc/docker/daemon.json; then
    return 0
  fi
  if [ -s /etc/docker/daemon.json ]; then
    warn "/etc/docker/daemon.json exists and has no registry-mirrors; not overwriting custom config"
    return 0
  fi

  log "Configuring Docker registry mirrors"
  $SUDO mkdir -p /etc/docker
  cat <<'JSON' | $SUDO tee /etc/docker/daemon.json >/dev/null
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.m.daocloud.io"
  ]
}
JSON
  MIRROR_CHANGED=1
}

restart_docker() {
  log "Restarting Docker daemon to load registry mirrors"
  if have systemctl && [ -d /run/systemd/system ]; then
    $SUDO systemctl restart docker
  elif have service; then
    $SUDO service docker restart || true
  else
    $SUDO pkill dockerd || true
    sleep 2
    $SUDO nohup dockerd --host=unix:///var/run/docker.sock >/tmp/liteoj-dockerd.log 2>&1 &
  fi
}

start_docker() {
  if docker info >/dev/null 2>&1; then
    [ "$MIRROR_CHANGED" = "1" ] && restart_docker
  elif $SUDO docker info >/dev/null 2>&1; then
    DOCKER=($SUDO docker)
    [ "$MIRROR_CHANGED" = "1" ] && restart_docker
  else
    if have systemctl && [ -d /run/systemd/system ]; then
      $SUDO systemctl enable --now docker || true
    elif have service; then
      $SUDO service docker start || true
    else
      $SUDO nohup dockerd --host=unix:///var/run/docker.sock >/tmp/liteoj-dockerd.log 2>&1 &
    fi
  fi

  for _ in $(seq 1 40); do
    if docker info >/dev/null 2>&1; then
      DOCKER=(docker)
      return 0
    fi
    if $SUDO docker info >/dev/null 2>&1; then
      DOCKER=($SUDO docker)
      return 0
    fi
    sleep 1
  done
  tail -n 120 /tmp/liteoj-dockerd.log 2>/dev/null || true
  die "Docker daemon is not reachable"
}

ensure_mirrors_loaded() {
  local mirrors
  mirrors="$("${DOCKER[@]}" info --format '{{json .RegistryConfig.Mirrors}}' 2>/dev/null || true)"
  if printf '%s' "$mirrors" | grep -qE 'docker\.1ms\.run|docker\.m\.daocloud\.io'; then
    log "Docker registry mirrors loaded: $mirrors"
    return 0
  fi
  if [ -s /etc/docker/daemon.json ] && grep -q 'registry-mirrors' /etc/docker/daemon.json; then
    warn "Docker daemon has not loaded daemon.json yet; restarting once more"
    restart_docker
    start_docker
  fi
}

prepare_base_image() {
  log "Preparing base image node:22-bookworm-slim"
  if "${DOCKER[@]}" pull node:22-bookworm-slim; then
    return 0
  fi
  warn "Pull through Docker Hub failed; trying direct mirror image"
  for mirror in docker.1ms.run docker.m.daocloud.io; do
    if "${DOCKER[@]}" pull "${mirror}/library/node:22-bookworm-slim"; then
      "${DOCKER[@]}" tag "${mirror}/library/node:22-bookworm-slim" node:22-bookworm-slim
      return 0
    fi
  done
  die "Cannot pull node:22-bookworm-slim. Check server network or configure a reachable Docker mirror."
}

ensure_docker() {
  install_docker_if_needed
  configure_docker_mirrors
  start_docker
  ensure_mirrors_loaded
}

compose() {
  "${DOCKER[@]}" compose "$@"
}

start_all() {
  ensure_env
  load_env
  ensure_docker
  prepare_base_image
  log "Building and starting LiteOJ containers"
  compose up -d --build
  log "LiteOJ is starting at http://127.0.0.1:${PORT:-3000}"
}

stop_all() {
  if have docker; then
    if docker info >/dev/null 2>&1; then
      docker compose down || true
    elif $SUDO docker info >/dev/null 2>&1; then
      $SUDO docker compose down || true
    fi
  fi
  log "LiteOJ containers stopped"
}

status_all() {
  if have docker; then
    if docker info >/dev/null 2>&1; then
      docker compose ps || true
    elif $SUDO docker info >/dev/null 2>&1; then
      $SUDO docker compose ps || true
    else
      log "Docker daemon is not reachable"
    fi
  else
    log "Docker CLI is not installed"
  fi
}

case "$ACTION" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; start_all ;;
  status) status_all ;;
  logs) compose logs -f ;;
  install) ensure_env; load_env; ensure_docker; prepare_base_image ;;
  *)
    cat <<'EOF'
Usage: ./liteoj.sh [start|stop|restart|status|logs|install]
EOF
    exit 1
    ;;
esac
