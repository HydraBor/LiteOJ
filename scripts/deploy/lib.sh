ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
RUNTIME_DIR="${RUNTIME_DIR:-$ROOT_DIR/.runtime}"
JUDGE_PID_FILE="${JUDGE_PID_FILE:-$RUNTIME_DIR/judge.pid}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
JUDGE_LOG_FILE="${JUDGE_LOG_FILE:-$LOG_DIR/judge.log}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=()
else
  SUDO=(sudo)
fi

DOCKER=(docker)
NODE_BIN=""
NEW_ENV_CREATED=0
DOCKER_MIRROR_CHANGED=0

log() { printf '[LiteOJ] %s\n' "$*"; }
warn() { printf '[LiteOJ][WARN] %s\n' "$*" >&2; }
die() { printf '[LiteOJ][ERROR] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
quote() { printf '%q' "$1"; }

require_sudo() {
  [ "$(id -u)" -eq 0 ] && return 0
  have sudo || die "This action needs sudo, but sudo is not installed or not in PATH."
  log "This setup may need sudo privileges. Enter the current user's password if prompted."
  "${SUDO[@]}" -v || die "sudo validation failed. Please run with a sudo-capable user."
}

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

remove_env_key() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  sed -i "/^${key}=.*/d" "$ENV_FILE"
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

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}
