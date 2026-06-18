#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-start}"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/deploy/lib.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/deploy/env.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/deploy/apt.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/deploy/docker.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/deploy/node.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/deploy/services.sh"

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
Usage: ./start.sh [start|stop|restart|status|logs|install|stop-all]
EOF
    exit 1
    ;;
esac
