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
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/deploy/data.sh"

case "$ACTION" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; start_all ;;
  status) status_all ;;
  logs) logs_all ;;
  install) install_all ;;
  backup) backup_all "${2:-}" ;;
  restore) restore_all "${2:-}" ;;
  data-volume) print_data_volume ;;
  stop-all) stop_all ;;
  *)
    cat <<'EOF'
Usage: ./start.sh [start|stop|restart|status|logs|install|backup|restore|data-volume|stop-all]

Examples:
  ./start.sh backup
  ./start.sh backup /path/to/backups
  ./start.sh restore backups/liteoj-data-YYYYMMDD-HHMMSS.tgz
  ./start.sh data-volume
EOF
    exit 1
    ;;
esac
