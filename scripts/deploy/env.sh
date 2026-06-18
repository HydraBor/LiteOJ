ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    NEW_ENV_CREATED=1
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
JUDGE_EXECUTOR=go-judge
GO_JUDGE_URL=http://127.0.0.1:5050
GO_JUDGE_PORT=5050
GO_JUDGE_BASE_IMAGE=criyle/go-judge:latest
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
NPM_REGISTRY=https://registry.npmmirror.com
DOCKER_BUILD_APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
DOCKER_BUILD_APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security
DOCKER_BUILD_NETWORK=host
LITEOJ_AUTO_PORT=1
LITEOJ_PORT_SCAN_END=3099
LITEOJ_GO_JUDGE_PORT_SCAN_END=5099
LITEOJ_APT_MIRROR=1
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
  ensure_plain_key JUDGE_EXECUTOR go-judge
  ensure_plain_key GO_JUDGE_PORT 5050
  ensure_plain_key GO_JUDGE_BASE_IMAGE criyle/go-judge:latest
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
  ensure_plain_key NPM_REGISTRY https://registry.npmmirror.com
  ensure_plain_key DOCKER_BUILD_APT_MIRROR http://mirrors.tuna.tsinghua.edu.cn/debian
  ensure_plain_key DOCKER_BUILD_APT_SECURITY_MIRROR http://mirrors.tuna.tsinghua.edu.cn/debian-security
  ensure_plain_key DOCKER_BUILD_NETWORK host
  ensure_plain_key LITEOJ_AUTO_PORT 1
  ensure_plain_key LITEOJ_PORT_SCAN_END 3099
  ensure_plain_key LITEOJ_GO_JUDGE_PORT_SCAN_END 5099
  ensure_plain_key LITEOJ_APT_MIRROR 1

  local port backend_url go_judge_port go_judge_url
  port="$(env_value PORT)"
  backend_url="$(env_value BACKEND_URL)"
  if [ -z "$backend_url" ] || [ "$backend_url" = "http://app:3000" ]; then
    set_env_key BACKEND_URL "http://127.0.0.1:${port:-3000}"
  fi
  go_judge_port="$(env_value GO_JUDGE_PORT)"
  go_judge_url="$(env_value GO_JUDGE_URL)"
  if [ -z "$go_judge_url" ] || [ "$go_judge_url" = "http://go-judge:5050" ]; then
    set_env_key GO_JUDGE_URL "http://127.0.0.1:${go_judge_port:-5050}"
  fi
}

print_start_summary() {
  log "LiteOJ is running at http://127.0.0.1:${PORT:-3000}"
  log "go-judge is listening at ${GO_JUDGE_URL:-http://127.0.0.1:${GO_JUDGE_PORT:-5050}}"
  log "Judge log: $JUDGE_LOG_FILE"
  log "Admin user: ${ADMIN_USERNAME:-admin}"
  if [ "$NEW_ENV_CREATED" = "1" ]; then
    log "Initial admin password: $(env_value ADMIN_PASSWORD)"
    log "The password is also saved in .env as ADMIN_PASSWORD."
  else
    log "Admin password is the existing password in the database; .env is not used to reset old databases."
  fi
}
