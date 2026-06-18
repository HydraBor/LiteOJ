#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$ROOT_DIR/$(basename "${BASH_SOURCE[0]}")"
ENV_FILE="$ROOT_DIR/.env"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$ROOT_DIR/logs"
JUDGE_PID_FILE="$RUNTIME_DIR/judge.pid"
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

random_secret() {
  if have openssl; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

env_set() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

is_placeholder() {
  local value="${1:-}"
  [ -z "$value" ] && return 0
  case "$value" in
    replace-*|replace_this*|replace-this*|liteoj-dev-*|dev-secret-change-me|dev-judge-token)
      return 0
      ;;
  esac
  return 1
}

ensure_env() {
  mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
  if [ ! -f "$ENV_FILE" ]; then
    log "Creating .env with random production secrets"
    cat > "$ENV_FILE" <<EOF
PORT=${PORT:-3000}
NODE_ENV=production
DATA_DIR=/app/data
DATABASE_PATH=/app/data/liteoj.db
JWT_SECRET=$(random_secret)
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=$(random_secret)
JUDGE_TOKEN=$(random_secret)
BACKEND_URL=http://127.0.0.1:${PORT:-3000}
JUDGE_POLL_INTERVAL_MS=2000
JUDGE_MAX_OUTPUT_BYTES=1048576
JUDGE_SANDBOX=docker
JUDGE_SANDBOX_IMAGE=liteoj:latest
JUDGE_SANDBOX_CPUS=1
JUDGE_PROCESS_LIMIT=64
JUDGE_FILE_LIMIT_KB=65536
TESTDATA_ZIP_LIMIT=50
TESTDATA_UNZIPPED_LIMIT=200
LOGIN_RATE_LIMIT=20
REGISTER_RATE_LIMIT=10
COOKIE_SECURE=auto
EOF
    chmod 600 "$ENV_FILE"
  fi

  local jwt judge admin_password port
  jwt="$(env_get JWT_SECRET)"
  judge="$(env_get JUDGE_TOKEN)"
  admin_password="$(env_get ADMIN_PASSWORD)"
  port="$(env_get PORT)"
  [ -n "$port" ] || env_set PORT "3000"
  is_placeholder "$jwt" && env_set JWT_SECRET "$(random_secret)"
  is_placeholder "$judge" && env_set JUDGE_TOKEN "$(random_secret)"
  [ -n "$(env_get ADMIN_USERNAME)" ] || env_set ADMIN_USERNAME "admin"
  if is_placeholder "$admin_password" || [ "$admin_password" = "admin123" ]; then
    env_set ADMIN_PASSWORD "$(random_secret)"
  fi
  [ -n "$(env_get NODE_ENV)" ] || env_set NODE_ENV "production"
  [ -n "$(env_get COOKIE_SECURE)" ] || env_set COOKIE_SECURE "auto"
  [ -n "$(env_get JUDGE_SANDBOX)" ] || env_set JUDGE_SANDBOX "docker"
  [ -n "$(env_get JUDGE_SANDBOX_IMAGE)" ] || env_set JUDGE_SANDBOX_IMAGE "liteoj:latest"
  [ -n "$(env_get BACKEND_URL)" ] || env_set BACKEND_URL "http://127.0.0.1:$(env_get PORT)"
  [ -n "$(env_get TESTDATA_ZIP_LIMIT)" ] || env_set TESTDATA_ZIP_LIMIT "50"
  [ -n "$(env_get TESTDATA_UNZIPPED_LIMIT)" ] || env_set TESTDATA_UNZIPPED_LIMIT "200"
  [ -n "$(env_get LOGIN_RATE_LIMIT)" ] || env_set LOGIN_RATE_LIMIT "20"
  [ -n "$(env_get REGISTER_RATE_LIMIT)" ] || env_set REGISTER_RATE_LIMIT "10"
  chmod 600 "$ENV_FILE" || true
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  PORT="${PORT:-3000}"
  JUDGE_SANDBOX_IMAGE="${JUDGE_SANDBOX_IMAGE:-liteoj:latest}"
  JUDGE_SANDBOX_CPUS="${JUDGE_SANDBOX_CPUS:-1}"
  JUDGE_PROCESS_LIMIT="${JUDGE_PROCESS_LIMIT:-64}"
  JUDGE_POLL_INTERVAL_MS="${JUDGE_POLL_INTERVAL_MS:-2000}"
}

use_apt_mirror_if_needed() {
  [ -f /etc/os-release ] || return 0
  # shellcheck disable=SC1091
  . /etc/os-release
  local mirror="${LITEOJ_APT_MIRROR:-auto}"
  [ "$mirror" = "0" ] && return 0
  [ "$mirror" = "off" ] && return 0
  [ "$mirror" = "false" ] && return 0

  if [ "${ID:-}" = "ubuntu" ]; then
    local target="${LITEOJ_UBUNTU_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/ubuntu}"
    if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
      $SUDO cp -n /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.liteoj.bak || true
      $SUDO sed -i \
        -e "s|http://archive.ubuntu.com/ubuntu|$target|g" \
        -e "s|http://security.ubuntu.com/ubuntu|$target|g" \
        -e "s|https://archive.ubuntu.com/ubuntu|$target|g" \
        -e "s|https://security.ubuntu.com/ubuntu|$target|g" \
        /etc/apt/sources.list.d/ubuntu.sources
    elif [ -f /etc/apt/sources.list ]; then
      $SUDO cp -n /etc/apt/sources.list /etc/apt/sources.list.liteoj.bak || true
      $SUDO sed -i \
        -e "s|http://archive.ubuntu.com/ubuntu|$target|g" \
        -e "s|http://security.ubuntu.com/ubuntu|$target|g" \
        -e "s|https://archive.ubuntu.com/ubuntu|$target|g" \
        -e "s|https://security.ubuntu.com/ubuntu|$target|g" \
        /etc/apt/sources.list
    fi
  elif [ "${ID:-}" = "debian" ]; then
    local debian="${LITEOJ_DEBIAN_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/debian}"
    local security="${LITEOJ_DEBIAN_SECURITY_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/debian-security}"
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then
      $SUDO cp -n /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list.d/debian.sources.liteoj.bak || true
      $SUDO sed -i \
        -e "s|http://deb.debian.org/debian-security|$security|g" \
        -e "s|http://security.debian.org/debian-security|$security|g" \
        -e "s|http://deb.debian.org/debian|$debian|g" \
        -e "s|https://deb.debian.org/debian-security|$security|g" \
        -e "s|https://security.debian.org/debian-security|$security|g" \
        -e "s|https://deb.debian.org/debian|$debian|g" \
        /etc/apt/sources.list.d/debian.sources
    elif [ -f /etc/apt/sources.list ]; then
      $SUDO cp -n /etc/apt/sources.list /etc/apt/sources.list.liteoj.bak || true
      $SUDO sed -i \
        -e "s|http://deb.debian.org/debian-security|$security|g" \
        -e "s|http://security.debian.org/debian-security|$security|g" \
        -e "s|http://deb.debian.org/debian|$debian|g" \
        -e "s|https://deb.debian.org/debian-security|$security|g" \
        -e "s|https://security.debian.org/debian-security|$security|g" \
        -e "s|https://deb.debian.org/debian|$debian|g" \
        /etc/apt/sources.list
    fi
  fi
}

apt_update() {
  if $SUDO apt-get update; then
    return 0
  fi
  warn "apt update failed; switching Ubuntu/Debian sources to domestic mirrors and retrying"
  use_apt_mirror_if_needed
  $SUDO apt-get update
}

ensure_base_packages() {
  have apt-get || return 0
  local missing=()
  for cmd in curl gpg tar xz openssl; do
    have "$cmd" || missing+=("$cmd")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    log "Installing base tools: ${missing[*]}"
    apt_update
    $SUDO apt-get install -y ca-certificates curl gnupg tar xz-utils openssl
  fi
}

configure_docker_mirrors() {
  [ "${LITEOJ_DOCKER_MIRROR:-1}" = "0" ] && return 0
  if [ -s /etc/docker/daemon.json ] && grep -q 'registry-mirrors' /etc/docker/daemon.json; then
    return 0
  fi
  if [ -s /etc/docker/daemon.json ]; then
    warn "/etc/docker/daemon.json already exists; not overwriting custom Docker daemon config"
    return 0
  fi
  $SUDO mkdir -p /etc/docker
  log "Configuring Docker registry mirrors"
  cat <<'JSON' | $SUDO tee /etc/docker/daemon.json >/dev/null
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.m.daocloud.io"
  ]
}
JSON
}

install_docker() {
  if have docker && docker compose version >/dev/null 2>&1; then
    return 0
  fi
  have apt-get || die "Docker auto-install currently supports Ubuntu/Debian with apt-get"
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || [ "${ID:-}" = "debian" ] || die "Unsupported OS for Docker auto-install: ${ID:-unknown}"

  log "Installing Docker Engine and Compose plugin"
  apt_update
  $SUDO apt-get install -y ca-certificates curl gnupg
  $SUDO install -m 0755 -d /etc/apt/keyrings
  $SUDO rm -f /etc/apt/keyrings/docker.gpg
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  local codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || codename="$(lsb_release -cs 2>/dev/null || true)"
  [ -n "$codename" ] || die "Cannot determine OS codename for Docker repository"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${codename} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt_update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO usermod -aG docker "$USER" || true
}

docker_info_any() {
  docker info >/dev/null 2>&1 || $SUDO docker info >/dev/null 2>&1
}

start_docker_daemon() {
  docker_info_any && return 0
  configure_docker_mirrors
  if have systemctl && [ -d /run/systemd/system ]; then
    $SUDO systemctl enable --now docker || true
  elif have service; then
    $SUDO service docker start || true
  fi
  docker_info_any && return 0

  if ! pgrep -x dockerd >/dev/null 2>&1; then
    log "Starting Docker daemon manually"
    $SUDO nohup dockerd --host=unix:///var/run/docker.sock >/tmp/liteoj-dockerd.log 2>&1 &
  fi
  for _ in $(seq 1 30); do
    docker_info_any && return 0
    sleep 1
  done
  tail -n 120 /tmp/liteoj-dockerd.log 2>/dev/null || true
  die "Docker daemon did not become ready"
}

ensure_docker_access() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if $SUDO docker info >/dev/null 2>&1; then
    $SUDO usermod -aG docker "$USER" || true
    if have sg && [ "${LITEOJ_REEXECED:-0}" != "1" ]; then
      local root_q script_q
      root_q="$(printf '%q' "$ROOT_DIR")"
      script_q="$(printf '%q' "$SCRIPT_PATH")"
      log "Re-entering the docker group for this run"
      exec sg docker -c "cd $root_q && LITEOJ_REEXECED=1 $script_q $ACTION"
    fi
    die "Current shell cannot access Docker yet. Run 'newgrp docker' or log in again, then rerun ./liteoj.sh $ACTION"
  fi
  die "Docker is not reachable"
}

ensure_docker() {
  ensure_base_packages
  install_docker
  configure_docker_mirrors
  start_docker_daemon
  ensure_docker_access
}

node_major() {
  "$1" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0'
}

find_usable_node() {
  if have node && [ "$(node_major "$(command -v node)")" -ge 20 ]; then
    NODE_BIN="$(command -v node)"
    return 0
  fi
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$HOME/.nvm/nvm.sh"
    if have node && [ "$(node_major "$(command -v node)")" -ge 20 ]; then
      NODE_BIN="$(command -v node)"
      return 0
    fi
  fi
  if [ -x "$RUNTIME_DIR/node/bin/node" ] && [ "$("$RUNTIME_DIR/node/bin/node" -p "Number(process.versions.node.split('.')[0])")" -ge 20 ]; then
    NODE_BIN="$RUNTIME_DIR/node/bin/node"
    export PATH="$RUNTIME_DIR/node/bin:$PATH"
    return 0
  fi
  return 1
}

install_portable_node() {
  ensure_base_packages
  local machine node_arch base shasums node_file tmp
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) die "Unsupported CPU architecture for portable Node.js: $machine" ;;
  esac
  base="${LITEOJ_NODE_MIRROR:-https://npmmirror.com/mirrors/node/latest-v22.x}"
  tmp="$RUNTIME_DIR/downloads"
  mkdir -p "$tmp"
  log "Installing portable Node.js 22 from $base"
  shasums="$(curl -fsSL "$base/SHASUMS256.txt")"
  node_file="$(printf '%s\n' "$shasums" | awk -v arch="linux-${node_arch}.tar.xz" '$2 ~ arch { print $2; exit }')"
  [ -n "$node_file" ] || die "Cannot find Node.js archive for linux-${node_arch}"
  curl -fL "$base/$node_file" -o "$tmp/$node_file"
  rm -rf "$RUNTIME_DIR/node" "$RUNTIME_DIR"/node-v*
  tar -xJf "$tmp/$node_file" -C "$RUNTIME_DIR"
  mv "$RUNTIME_DIR/${node_file%.tar.xz}" "$RUNTIME_DIR/node"
  NODE_BIN="$RUNTIME_DIR/node/bin/node"
  export PATH="$RUNTIME_DIR/node/bin:$PATH"
}

ensure_node() {
  if find_usable_node; then
    return 0
  fi
  install_portable_node
  find_usable_node || die "Node.js 20+ is still unavailable after installation"
}

compose() {
  docker compose "$@"
}

wait_for_app() {
  local url="http://127.0.0.1:${PORT}/api/auth/me"
  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  compose logs --tail=120 app || true
  die "LiteOJ web service did not become ready at $url"
}

stop_host_judge() {
  if [ -f "$JUDGE_PID_FILE" ]; then
    local pid
    pid="$(cat "$JUDGE_PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
      log "Stopping host judge worker pid=$pid"
      kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" || true
      for _ in $(seq 1 10); do
        kill -0 "$pid" >/dev/null 2>&1 || break
        sleep 1
      done
      kill -9 -- "-$pid" >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$JUDGE_PID_FILE"
  fi
  local leftovers
  leftovers="$(pgrep -f '[n]ode .*judge/worker.js' || true)"
  if [ -n "$leftovers" ]; then
    warn "Cleaning up leftover judge worker processes: $leftovers"
    kill $leftovers >/dev/null 2>&1 || true
  fi
}

start_host_judge() {
  ensure_node
  stop_host_judge
  mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
  local backend_url
  backend_url="${HOST_JUDGE_BACKEND_URL:-http://127.0.0.1:${PORT}}"
  log "Starting host judge worker with Docker sandbox"
  (
    cd "$ROOT_DIR"
    detach_cmd="nohup"
    if have setsid; then
      detach_cmd="setsid"
    fi
    "$detach_cmd" env \
      NODE_ENV=production \
      BACKEND_URL="$backend_url" \
      JUDGE_TOKEN="$JUDGE_TOKEN" \
      JUDGE_ID="${JUDGE_ID:-same-host-judge-1}" \
      JUDGE_POLL_INTERVAL_MS="$JUDGE_POLL_INTERVAL_MS" \
      JUDGE_SANDBOX=docker \
      JUDGE_SANDBOX_IMAGE="$JUDGE_SANDBOX_IMAGE" \
      JUDGE_SANDBOX_CPUS="$JUDGE_SANDBOX_CPUS" \
      JUDGE_PROCESS_LIMIT="$JUDGE_PROCESS_LIMIT" \
      JUDGE_FILE_LIMIT_KB="${JUDGE_FILE_LIMIT_KB:-65536}" \
      JUDGE_MAX_OUTPUT_BYTES="${JUDGE_MAX_OUTPUT_BYTES:-1048576}" \
      bash -c 'trap "" HUP; "$@"; code=$?; echo "[liteoj.sh] host judge exited with code ${code}"; exit "$code"' _ "$NODE_BIN" judge/worker.js \
      </dev/null >> "$LOG_DIR/judge.log" 2>&1 &
    printf '%s\n' "$!" > "$JUDGE_PID_FILE"
  )
  sleep 1
  local pid
  pid="$(cat "$JUDGE_PID_FILE")"
  kill -0 "$pid" >/dev/null 2>&1 || {
    tail -n 80 "$LOG_DIR/judge.log" 2>/dev/null || true
    die "Host judge worker failed to start"
  }
}

start_all() {
  ensure_env
  load_env
  ensure_docker
  log "Building and starting LiteOJ web container"
  compose up -d --build app
  wait_for_app
  # The app build produces the same image used by Docker sandbox runs.
  docker image inspect "$JUDGE_SANDBOX_IMAGE" >/dev/null 2>&1 || docker build -t "$JUDGE_SANDBOX_IMAGE" .
  start_host_judge
  log "LiteOJ is ready: http://127.0.0.1:${PORT}"
  log "App logs:   docker compose logs -f app"
  log "Judge logs: tail -f logs/judge.log"
}

stop_all() {
  ensure_env
  load_env
  stop_host_judge
  if have docker && docker compose version >/dev/null 2>&1; then
    compose down
  fi
  log "LiteOJ services stopped"
}

status_all() {
  ensure_env
  load_env
  if have docker && docker info >/dev/null 2>&1; then
    docker compose ps || true
  elif have docker; then
    log "Docker daemon: stopped or not reachable"
  else
    log "Docker CLI: not installed"
  fi
  if [ -f "$JUDGE_PID_FILE" ] && kill -0 "$(cat "$JUDGE_PID_FILE")" >/dev/null 2>&1; then
    log "Host judge worker: running pid=$(cat "$JUDGE_PID_FILE")"
  elif pgrep -f '[n]ode .*judge/worker.js' >/dev/null 2>&1; then
    warn "Host judge worker: running without pid file"
    pgrep -af '[n]ode .*judge/worker.js' || true
  else
    log "Host judge worker: stopped"
  fi
}

logs_all() {
  log "Last 80 lines of app logs"
  if have docker && docker info >/dev/null 2>&1; then
    docker compose logs --tail=80 app || true
  else
    log "Docker daemon is not reachable; app logs are unavailable"
  fi
  log "Last 80 lines of host judge logs"
  tail -n 80 "$LOG_DIR/judge.log" 2>/dev/null || true
}

case "$ACTION" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    status_all
    ;;
  logs)
    logs_all
    ;;
  install)
    ensure_env
    load_env
    ensure_docker
    ensure_node
    log "Environment is ready"
    ;;
  stop-all)
    stop_all
    if have systemctl && [ -d /run/systemd/system ]; then
      $SUDO systemctl stop docker || true
    else
      $SUDO pkill dockerd || true
    fi
    log "LiteOJ and Docker daemon stopped"
    ;;
  *)
    cat <<'EOF'
Usage: ./liteoj.sh [start|stop|restart|status|logs|install|stop-all]

Default: start

start    Install missing runtime pieces, start web container, start host judge
stop     Stop host judge and LiteOJ containers
restart  Stop then start
status   Show container and host judge status
logs     Show recent app and judge logs
install  Only prepare Docker/Node/.env
stop-all Stop LiteOJ and also stop Docker daemon
EOF
    exit 1
    ;;
esac
