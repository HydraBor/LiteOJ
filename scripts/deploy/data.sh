require_docker_ready() {
  if have docker && docker info >/dev/null 2>&1; then
    DOCKER=(docker)
    return 0
  fi
  if have sudo && sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
    return 0
  fi
  die "Docker daemon is not reachable. Start Docker first, or run ./start.sh install to prepare the environment."
}

resolve_data_volume() {
  local volume project volume_key candidate

  volume="$("${DOCKER[@]}" inspect liteoj-app --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{println .Name}}{{end}}{{end}}' 2>/dev/null | sed '/^$/d' | head -n 1 || true)"
  if [ -n "$volume" ]; then
    printf '%s\n' "$volume"
    return 0
  fi

  if [ -n "${LITEOJ_DATA_VOLUME:-}" ]; then
    printf '%s\n' "$LITEOJ_DATA_VOLUME"
    return 0
  fi

  project="$(compose config --format json 2>/dev/null | sed -n 's/^[[:space:]]*"name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 || true)"
  volume_key="$(compose config --volumes 2>/dev/null | sed -n '1p' || true)"
  if [ -n "$project" ] && [ -n "$volume_key" ]; then
    candidate="${project}_${volume_key}"
    printf '%s\n' "$candidate"
    return 0
  fi

  die "Cannot resolve LiteOJ data volume. Start LiteOJ once or set LITEOJ_DATA_VOLUME explicitly."
}

print_data_volume() {
  ensure_env
  load_env
  require_docker_ready
  resolve_data_volume
}

backup_all() {
  local output_dir volume stamp archive_path archive_name
  output_dir="${1:-$ROOT_DIR/backups}"
  ensure_env
  load_env
  require_docker_ready
  volume="$(resolve_data_volume)"
  mkdir -p "$output_dir"
  output_dir="$(cd "$output_dir" && pwd)"
  stamp="$(date +%Y%m%d-%H%M%S)"
  archive_name="liteoj-data-${stamp}.tgz"
  archive_path="$output_dir/$archive_name"

  log "Backing up Docker volume: $volume"
  stop_all
  "${DOCKER[@]}" run --rm \
    -v "${volume}:/data:ro" \
    -v "${output_dir}:/backup" \
    busybox sh -c "tar czf /backup/${archive_name} -C /data ."
  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$output_dir/liteoj-env-${stamp}.bak"
    chmod 600 "$output_dir/liteoj-env-${stamp}.bak" || true
  fi
  log "Backup written to $archive_path"
  start_all
}

restore_all() {
  local archive backup_dir volume
  archive="${1:-}"
  [ -n "$archive" ] || die "Usage: ./start.sh restore backups/liteoj-data-YYYYMMDD-HHMMSS.tgz"
  [ -f "$archive" ] || die "Backup archive not found: $archive"
  backup_dir="$(cd "$(dirname "$archive")" && pwd)"
  archive="$backup_dir/$(basename "$archive")"

  ensure_env
  load_env
  require_docker_ready
  volume="$(resolve_data_volume)"

  if ! tar tzf "$archive" >/dev/null 2>&1; then
    die "Backup archive is not a readable .tgz file: $archive"
  fi
  if ! tar tzf "$archive" | grep -Eq '(^|/)liteoj\.db$'; then
    warn "The archive does not appear to contain liteoj.db. Continuing because it may be an intentionally empty data backup."
  fi

  log "Restoring into Docker volume: $volume"
  log "Source archive: $archive"
  stop_all
  "${DOCKER[@]}" run --rm \
    -v "${volume}:/data" \
    -v "${archive}:/backup.tgz:ro" \
    busybox sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf /backup.tgz -C /data'
  log "Restore completed"
  start_all
}
