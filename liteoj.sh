#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RUNTIME_DIR="$ROOT_DIR/.runtime"
JUDGE_PID_FILE="$RUNTIME_DIR/judge.pid"
LOG_DIR="$ROOT_DIR/logs"
JUDGE_LOG_FILE="$LOG_DIR/judge.log"
ACTION="${1:-start}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=()
else
  SUDO=(sudo)
fi

log() { printf '[LiteOJ] %s\n' "$*"; }
warn() { printf '[LiteOJ][WARN] %s\n' "$*" >&2; }
die() { printf '[LiteOJ][ERROR] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
quote() { printf '%q' "$1"; }

DOCKER=(docker)
NODE_BIN=""
MIRROR_CHANGED=0

random_secret() {
  if have openssl; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

set_env_key() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s/^${key}=.*/${key}=${escaped}/" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

is_placeholder() {
  local value="${1:-}"
  [ -z "$value" ] && return 0
  case "$value" in
    replace-this*|change-me*|changeme*|dev-secret|dev-judge-token|admin123)
      return 0
      ;;
  esac
  return 1
}

ensure_secret_key() {
  local key="$1"
  local value
  value="$(env_value "$key")"
  if is_placeholder "$value"; then
    set_env_key "$key" "$(random_secret)"
  fi
}

ensure_plain_key() {
  local key="$1"
  local value="$2"
  if [ -z "$(env_value "$key")" ]; then
    set_env_key "$key" "$value"
  fi
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    log "Creating .env with random production secrets"
    cat > "$ENV_FILE" <<EOF
PORT=${PORT:-3000}
NODE_ENV=production
DATA_DIR=/app/data
DATABASE_PATH=/app/data/liteoj.db
JWT_SECRET=$(random_secret)
ADMIN_USERNAME=admin
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
    chmod 600 "$ENV_FILE" || true
  fi

  chmod 600 "$ENV_FILE" || true
  ensure_plain_key PORT "${PORT:-3000}"
  ensure_plain_key NODE_ENV production
  ensure_plain_key DATA_DIR /app/data
  ensure_plain_key DATABASE_PATH /app/data/liteoj.db
  ensure_plain_key ADMIN_USERNAME admin
  ensure_secret_key JWT_SECRET
  ensure_secret_key ADMIN_PASSWORD
  ensure_secret_key JUDGE_TOKEN
  ensure_plain_key JUDGE_POLL_INTERVAL_MS 2000
  ensure_plain_key JUDGE_MAX_OUTPUT_BYTES 1048576
  ensure_plain_key JUDGE_SANDBOX docker
  ensure_plain_key JUDGE_SANDBOX_IMAGE liteoj:latest
  ensure_plain_key JUDGE_SANDBOX_CPUS 1
  ensure_plain_key JUDGE_PROCESS_LIMIT 64
  ensure_plain_key JUDGE_FILE_LIMIT_KB 65536
  ensure_plain_key TESTDATA_ZIP_LIMIT 50
  ensure_plain_key TESTDATA_UNZIPPED_LIMIT 200
  ensure_plain_key LOGIN_RATE_LIMIT 20
  ensure_plain_key REGISTER_RATE_LIMIT 10
  ensure_plain_key COOKIE_SECURE auto

  local port backend_url
  port="$(env_value PORT)"
  backend_url="$(env_value BACKEND_URL)"
  if [ -z "$backend_url" ] || [ "$backend_url" = "http://app:3000" ]; then
    set_env_key BACKEND_URL "http://127.0.0.1:${port:-3000}"
  fi
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

apt_update() {
  if "${SUDO[@]}" apt-get update; then
    return 0
  fi
  warn "apt update failed, switching Ubuntu/Debian sources to Tsinghua mirror and retrying"
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    "${SUDO[@]}" cp -n /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.liteoj.bak || true
    "${SUDO[@]}" sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|http://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      /etc/apt/sources.list.d/ubuntu.sources
  elif [ -f /etc/apt/sources.list ]; then
    "${SUDO[@]}" cp -n /etc/apt/sources.list /etc/apt/sources.list.liteoj.bak || true
    "${SUDO[@]}" sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|http://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      -e 's|https://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' \
      /etc/apt/sources.list
  fi
  "${SUDO[@]}" apt-get update
}

install_basic_tools() {
  local missing=()
  for tool in ca-certificates curl tar xz; do
    if ! have "$tool"; then
      missing+=("$tool")
    fi
  done
  [ "${#missing[@]}" -eq 0 ] && return 0
  have apt-get || die "Missing tools (${missing[*]}), and apt-get is unavailable"
  apt_update
  "${SUDO[@]}" apt-get install -y ca-certificates curl tar xz-utils
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
  "${SUDO[@]}" apt-get install -y ca-certificates curl gnupg
  "${SUDO[@]}" install -m 0755 -d /etc/apt/keyrings
  "${SUDO[@]}" rm -f /etc/apt/keyrings/docker.gpg
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | "${SUDO[@]}" gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  "${SUDO[@]}" chmod a+r /etc/apt/keyrings/docker.gpg
  local codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || codename="$(lsb_release -cs 2>/dev/null || true)"
  [ -n "$codename" ] || die "Cannot determine OS codename"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${codename} stable" \
    | "${SUDO[@]}" tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt_update
  "${SUDO[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

ensure_docker_group() {
  [ "$(id -u)" -eq 0 ] && return 0
  getent group docker >/dev/null 2>&1 || return 0
  if ! getent group docker | awk -F: -v user="$USER" '{ split($4, users, ","); for (i in users) if (users[i] == user) found=1 } END { exit found ? 0 : 1 }'; then
    log "Adding $USER to docker group"
    "${SUDO[@]}" usermod -aG docker "$USER" || true
  fi
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
  "${SUDO[@]}" mkdir -p /etc/docker
  cat <<'JSON' | "${SUDO[@]}" tee /etc/docker/daemon.json >/dev/null
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
    "${SUDO[@]}" systemctl restart docker
  elif have service; then
    "${SUDO[@]}" service docker restart || true
  else
    "${SUDO[@]}" pkill dockerd || true
    sleep 2
    "${SUDO[@]}" nohup dockerd --host=unix:///var/run/docker.sock >/tmp/liteoj-dockerd.log 2>&1 &
  fi
}

start_docker() {
  if docker info >/dev/null 2>&1; then
    DOCKER=(docker)
    [ "$MIRROR_CHANGED" = "1" ] && restart_docker
  elif "${SUDO[@]}" docker info >/dev/null 2>&1; then
    DOCKER=("${SUDO[@]}" docker)
    [ "$MIRROR_CHANGED" = "1" ] && restart_docker
  else
    if have systemctl && [ -d /run/systemd/system ]; then
      "${SUDO[@]}" systemctl enable --now docker || true
    elif have service; then
      "${SUDO[@]}" service docker start || true
    else
      "${SUDO[@]}" nohup dockerd --host=unix:///var/run/docker.sock >/tmp/liteoj-dockerd.log 2>&1 &
    fi
  fi

  for _ in $(seq 1 40); do
    if docker info >/dev/null 2>&1; then
      DOCKER=(docker)
      return 0
    fi
    if "${SUDO[@]}" docker info >/dev/null 2>&1; then
      DOCKER=("${SUDO[@]}" docker)
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
  ensure_docker_group
  configure_docker_mirrors
  start_docker
  ensure_mirrors_loaded
}

node_major() {
  "$1" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

ensure_node() {
  if have node && [ "$(node_major "$(command -v node)")" -ge 22 ]; then
    NODE_BIN="$(command -v node)"
    return 0
  fi

  install_basic_tools
  mkdir -p "$RUNTIME_DIR"
  local arch node_arch version archive url node_dir
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) die "Unsupported CPU architecture for portable Node.js: $arch" ;;
  esac

  if [ -x "$RUNTIME_DIR/node/bin/node" ] && [ "$("$RUNTIME_DIR/node/bin/node" -p "Number(process.versions.node.split('.')[0])")" -ge 22 ]; then
    NODE_BIN="$RUNTIME_DIR/node/bin/node"
    return 0
  fi

  log "Preparing portable Node.js 22 from npmmirror"
  version="$(curl -fsSL https://npmmirror.com/mirrors/node/index.json | grep -m1 -o '"version":"v22[^"]*' | cut -d'"' -f4)"
  [ -n "$version" ] || die "Cannot resolve latest Node.js 22 version from npmmirror"
  archive="node-${version}-linux-${node_arch}.tar.xz"
  url="https://npmmirror.com/mirrors/node/${version}/${archive}"
  curl -fL "$url" -o "$RUNTIME_DIR/$archive"
  rm -rf "$RUNTIME_DIR/node-${version}-linux-${node_arch}"
  tar -xJf "$RUNTIME_DIR/$archive" -C "$RUNTIME_DIR"
  node_dir="$RUNTIME_DIR/node-${version}-linux-${node_arch}"
  ln -sfn "$node_dir" "$RUNTIME_DIR/node"
  NODE_BIN="$RUNTIME_DIR/node/bin/node"
}

compose() {
  (cd "$ROOT_DIR" && "${DOCKER[@]}" compose "$@")
}

docker_available_for_user() {
  docker info >/dev/null 2>&1
}

docker_available_with_sg() {
  [ "$(id -u)" -ne 0 ] || return 1
  have sg || return 1
  getent group docker >/dev/null 2>&1 || return 1
  getent group docker | awk -F: -v user="$USER" '{ split($4, users, ","); for (i in users) if (users[i] == user) found=1 } END { exit found ? 0 : 1 }' || return 1
  sg docker -c 'docker info >/dev/null 2>&1'
}

judge_is_running() {
  [ -f "$JUDGE_PID_FILE" ] || return 1
  local pid
  pid="$(cat "$JUDGE_PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

start_judge() {
  mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
  if judge_is_running; then
    log "Judge worker already running with pid $(cat "$JUDGE_PID_FILE")"
    return 0
  fi
  rm -f "$JUDGE_PID_FILE"
  touch "$JUDGE_LOG_FILE"

  local port backend_url node_bin path_value cmd inner
  port="${PORT:-3000}"
  backend_url="http://127.0.0.1:${port}"
  node_bin="$NODE_BIN"
  path_value="$(dirname "$node_bin"):$PATH"

  inner="cd $(quote "$ROOT_DIR")"
  inner+=" && exec env"
  inner+=" NODE_ENV=production"
  inner+=" BACKEND_URL=$(quote "$backend_url")"
  inner+=" JUDGE_TOKEN=$(quote "${JUDGE_TOKEN:-}")"
  inner+=" JUDGE_ID=$(quote "${JUDGE_ID:-same-server-judge-1}")"
  inner+=" JUDGE_POLL_INTERVAL_MS=$(quote "${JUDGE_POLL_INTERVAL_MS:-2000}")"
  inner+=" JUDGE_MAX_OUTPUT_BYTES=$(quote "${JUDGE_MAX_OUTPUT_BYTES:-1048576}")"
  inner+=" JUDGE_SANDBOX=docker"
  inner+=" JUDGE_SANDBOX_IMAGE=$(quote "${JUDGE_SANDBOX_IMAGE:-liteoj:latest}")"
  inner+=" JUDGE_SANDBOX_CPUS=$(quote "${JUDGE_SANDBOX_CPUS:-1}")"
  inner+=" JUDGE_PROCESS_LIMIT=$(quote "${JUDGE_PROCESS_LIMIT:-64}")"
  inner+=" JUDGE_FILE_LIMIT_KB=$(quote "${JUDGE_FILE_LIMIT_KB:-65536}")"
  inner+=" PATH=$(quote "$path_value")"
  inner+=" $(quote "$node_bin") judge/worker.js"

  if docker_available_for_user; then
    cmd="$inner"
  elif docker_available_with_sg; then
    log "Re-entering docker group for host judge"
    cmd="sg docker -c $(quote "$inner")"
  else
    die "The current user cannot run docker without sudo. Log out and back in after Docker group setup, or run: sudo usermod -aG docker $USER"
  fi

  log "Starting host judge worker with Docker sandbox"
  if have setsid; then
    setsid bash -lc "$cmd" >>"$JUDGE_LOG_FILE" 2>&1 &
  else
    nohup bash -lc "$cmd" >>"$JUDGE_LOG_FILE" 2>&1 &
  fi
  echo $! > "$JUDGE_PID_FILE"
  sleep 1
  if ! judge_is_running; then
    tail -n 120 "$JUDGE_LOG_FILE" || true
    die "Judge worker failed to start"
  fi
}

stop_judge() {
  if ! [ -f "$JUDGE_PID_FILE" ]; then
    log "Judge worker is not running"
    return 0
  fi
  local pid
  pid="$(cat "$JUDGE_PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    log "Stopping judge worker pid $pid"
    kill -TERM "-$pid" >/dev/null 2>&1 || kill -TERM "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 0.5
    done
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL "-$pid" >/dev/null 2>&1 || kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$JUDGE_PID_FILE"
}

start_all() {
  ensure_env
  load_env
  ensure_docker
  ensure_node
  prepare_base_image
  log "Building and starting LiteOJ web container"
  compose up -d --build app
  start_judge
  log "LiteOJ is running at http://127.0.0.1:${PORT:-3000}"
  log "Judge log: $JUDGE_LOG_FILE"
}

stop_all() {
  stop_judge
  if have docker; then
    if docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && docker compose down) || true
    elif "${SUDO[@]}" docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && "${SUDO[@]}" docker compose down) || true
    fi
  fi
  log "LiteOJ stopped"
}

status_all() {
  if have docker; then
    if docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && docker compose ps) || true
    elif "${SUDO[@]}" docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && "${SUDO[@]}" docker compose ps) || true
    else
      log "Docker daemon is not reachable"
    fi
  else
    log "Docker CLI is not installed"
  fi

  if judge_is_running; then
    log "Judge worker: running, pid $(cat "$JUDGE_PID_FILE")"
  else
    log "Judge worker: stopped"
  fi
}

logs_all() {
  mkdir -p "$LOG_DIR"
  touch "$JUDGE_LOG_FILE"
  if have docker && docker info >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && docker compose logs --tail=120 app) || true
  elif have docker && "${SUDO[@]}" docker info >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && "${SUDO[@]}" docker compose logs --tail=120 app) || true
  fi
  log "Following judge log. Press Ctrl+C to exit."
  tail -f "$JUDGE_LOG_FILE"
}

install_all() {
  ensure_env
  load_env
  ensure_docker
  ensure_node
  prepare_base_image
  log "Install checks completed"
}

case "$ACTION" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; start_all ;;
  status) status_all ;;
  logs) logs_all ;;
  install) install_all ;;
  stop-all) stop_all ;;
  *)
    cat <<'EOF'
Usage: ./liteoj.sh [start|stop|restart|status|logs|install|stop-all]
EOF
    exit 1
    ;;
esac
