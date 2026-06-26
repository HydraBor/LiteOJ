compose() {
  (cd "$ROOT_DIR" && "${DOCKER[@]}" compose "$@")
}

port_is_busy() {
  local port="$1"
  if have ss; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$" && return 0
  fi
  if have lsof; then
    lsof -iTCP:"$port" -sTCP:LISTEN -Pn >/dev/null 2>&1 && return 0
  fi
  if have netstat; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$" && return 0
  fi
  # WSL/Docker Desktop can fail to show Windows-side listeners in Linux `ss`,
  # but Docker port publishing still conflicts with them. A loopback connect
  # catches those host-level listeners before `docker compose up` fails.
  if have timeout; then
    timeout 1 bash -c ":</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1 && return 0
  else
    bash -c ":</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1 && return 0
  fi
  return 1
}

port_used_by_current_app() {
  local port="$1"
  have docker || return 1
  local ports
  ports="$("${DOCKER[@]}" ps --filter 'name=^/liteoj-app$' --format '{{.Ports}}' 2>/dev/null || true)"
  [ -n "$ports" ] || return 1
  printf '%s\n' "$ports" | grep -Eq "(0\.0\.0\.0|::|127\.0\.0\.1):${port}->3000/tcp"
}

port_used_by_current_go_judge() {
  local port="$1"
  have docker || return 1
  local ports
  ports="$("${DOCKER[@]}" ps --filter 'name=^/liteoj-go-judge$' --format '{{.Ports}}' 2>/dev/null || true)"
  [ -n "$ports" ] || return 1
  printf '%s\n' "$ports" | grep -Eq "(0\.0\.0\.0|::|127\.0\.0\.1):${port}->5050/tcp"
}

ensure_web_port_available() {
  local requested="${PORT:-3000}"
  if ! printf '%s' "$requested" | grep -Eq '^[0-9]+$'; then
    die "PORT must be a number, got: $requested"
  fi
  if ! port_is_busy "$requested" || port_used_by_current_app "$requested"; then
    return 0
  fi

  if [ "${LITEOJ_AUTO_PORT:-1}" = "0" ]; then
    die "Port $requested is already in use. Stop the process using it or set PORT in .env."
  fi

  local end="${LITEOJ_PORT_SCAN_END:-3099}"
  if ! printf '%s' "$end" | grep -Eq '^[0-9]+$'; then
    end=3099
  fi
  local candidate
  for candidate in $(seq "$((requested + 1))" "$end"); do
    if ! port_is_busy "$candidate"; then
      warn "Port $requested is already in use; switching LiteOJ to port $candidate."
      set_env_key PORT "$candidate"
      set_env_key BACKEND_URL "http://127.0.0.1:${candidate}"
      export PORT="$candidate"
      export BACKEND_URL="http://127.0.0.1:${candidate}"
      return 0
    fi
  done
  die "Port $requested is already in use and no free port was found before $end. Set PORT in .env manually."
}

ensure_go_judge_port_available() {
  local requested="${GO_JUDGE_PORT:-5050}"
  if ! printf '%s' "$requested" | grep -Eq '^[0-9]+$'; then
    die "GO_JUDGE_PORT must be a number, got: $requested"
  fi
  if ! port_is_busy "$requested" || port_used_by_current_go_judge "$requested"; then
    return 0
  fi

  if [ "${LITEOJ_AUTO_PORT:-1}" = "0" ]; then
    die "go-judge port $requested is already in use. Stop the process using it or set GO_JUDGE_PORT in .env."
  fi

  local end="${LITEOJ_GO_JUDGE_PORT_SCAN_END:-5099}"
  if ! printf '%s' "$end" | grep -Eq '^[0-9]+$'; then
    end=5099
  fi
  local candidate
  for candidate in $(seq "$((requested + 1))" "$end"); do
    if ! port_is_busy "$candidate"; then
      warn "go-judge port $requested is already in use; switching go-judge to port $candidate."
      set_env_key GO_JUDGE_PORT "$candidate"
      set_env_key GO_JUDGE_URL "http://127.0.0.1:${candidate}"
      export GO_JUDGE_PORT="$candidate"
      export GO_JUDGE_URL="http://127.0.0.1:${candidate}"
      return 0
    fi
  done
  die "go-judge port $requested is already in use and no free port was found before $end. Set GO_JUDGE_PORT in .env manually."
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
  inner+=" JUDGE_MAX_OUTPUT_BYTES=$(quote "${JUDGE_MAX_OUTPUT_BYTES:-16777216}")"
  inner+=" GO_JUDGE_URL=$(quote "${GO_JUDGE_URL:-http://127.0.0.1:${GO_JUDGE_PORT:-5050}}")"
  inner+=" GO_JUDGE_PROCESS_LIMIT=$(quote "${GO_JUDGE_PROCESS_LIMIT:-64}")"
  inner+=" SPJ_TIMEOUT_MS=$(quote "${SPJ_TIMEOUT_MS:-3000}")"
  inner+=" SPJ_MEMORY_LIMIT_MB=$(quote "${SPJ_MEMORY_LIMIT_MB:-256}")"
  inner+=" PATH=$(quote "$path_value")"
  inner+=" $(quote "$node_bin") judge/worker.js"

  cmd="$inner"

  log "Starting host judge worker with go-judge executor"
  if have setsid; then
    setsid bash -lc "$cmd" >>"$JUDGE_LOG_FILE" 2>&1 &
  else
    nohup bash -lc "$cmd" >>"$JUDGE_LOG_FILE" 2>&1 &
  fi
  echo $! > "$JUDGE_PID_FILE"
  sleep 1
  if ! judge_is_running; then
    tail -n 120 "$JUDGE_LOG_FILE" || true
    die "Judge worker failed to start."
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
  ensure_web_port_available
  ensure_go_judge_port_available
  ensure_node
  prepare_base_image
  prepare_go_judge_base_image
  log "Building and starting LiteOJ web and go-judge containers"
  compose up -d --build app go-judge
  start_judge
  print_start_summary
}

stop_all() {
  stop_judge
  if have docker; then
    if docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && docker compose down) || true
    elif have sudo && sudo docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && sudo docker compose down) || true
    fi
  fi
  log "LiteOJ stopped"
}

status_all() {
  if have docker; then
    if docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && docker compose ps) || true
    elif have sudo && sudo docker info >/dev/null 2>&1; then
      (cd "$ROOT_DIR" && sudo docker compose ps) || true
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
    (cd "$ROOT_DIR" && docker compose logs --tail=120 app go-judge) || true
  elif have sudo && sudo docker info >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && sudo docker compose logs --tail=120 app go-judge) || true
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
  prepare_go_judge_base_image
  log "Install checks completed"
}
