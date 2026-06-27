ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    NEW_ENV_CREATED=1
    log "Creating .env with production secrets and default admin"
    cat > "$ENV_FILE" <<EOF
PORT=${PORT:-3000}
NODE_ENV=production
DATA_DIR=/app/data
DATABASE_PATH=/app/data/liteoj.db
JWT_SECRET=$(random_secret)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
JUDGE_TOKEN=$(random_secret)
BACKEND_URL=http://127.0.0.1:${PORT:-3000}
JUDGE_POLL_INTERVAL_MS=2000
JUDGE_LOCK_TIMEOUT_SECONDS=600
JUDGE_MAX_OUTPUT_BYTES=16777216
GO_JUDGE_URL=http://127.0.0.1:5050
GO_JUDGE_PORT=5050
GO_JUDGE_VERSION=1.12.0
GO_JUDGE_RELEASE_BASE=https://github.com/criyle/go-judge/releases/download
GO_JUDGE_PROCESS_LIMIT=64
TESTDATA_ZIP_LIMIT=50
TESTDATA_UNZIPPED_LIMIT=200
ATTACHMENT_FILE_LIMIT=200
CHECKER_SOURCE_LIMIT=1
MANUAL_CASE_LIMIT=5
PROBLEM_STORAGE_LIMIT=500
MAX_CODE_SIZE_KB=128
SUBMIT_RATE_LIMIT=20
SUBMIT_RATE_WINDOW_SECONDS=60
MAX_PENDING_SUBMISSIONS_PER_USER=20
MAX_JUDGE_QUEUE=500
SPJ_TIMEOUT_MS=3000
SPJ_MEMORY_LIMIT_MB=256
LOGIN_RATE_LIMIT=20
REGISTER_RATE_LIMIT=10
XFYUN_API_KEY=
DEEPSEEK_API_KEY=
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
  if is_placeholder "$(env_value ADMIN_PASSWORD)"; then
    set_env_key ADMIN_PASSWORD admin123
  fi
  ensure_secret_key JUDGE_TOKEN
  ensure_plain_key JUDGE_POLL_INTERVAL_MS 2000
  ensure_plain_key JUDGE_LOCK_TIMEOUT_SECONDS 600
  ensure_plain_key JUDGE_MAX_OUTPUT_BYTES 16777216
  if [ "$(env_value JUDGE_MAX_OUTPUT_BYTES)" = "1048576" ]; then
    set_env_key JUDGE_MAX_OUTPUT_BYTES 16777216
  fi
  ensure_plain_key GO_JUDGE_PORT 5050
  ensure_plain_key GO_JUDGE_VERSION 1.12.0
  ensure_plain_key GO_JUDGE_RELEASE_BASE https://github.com/criyle/go-judge/releases/download
  ensure_plain_key GO_JUDGE_PROCESS_LIMIT 64
  ensure_plain_key TESTDATA_ZIP_LIMIT 50
  ensure_plain_key TESTDATA_UNZIPPED_LIMIT 200
  ensure_plain_key ATTACHMENT_FILE_LIMIT 200
  ensure_plain_key CHECKER_SOURCE_LIMIT 1
  ensure_plain_key MANUAL_CASE_LIMIT 5
  ensure_plain_key PROBLEM_STORAGE_LIMIT 500
  ensure_plain_key MAX_CODE_SIZE_KB 128
  ensure_plain_key SUBMIT_RATE_LIMIT 20
  ensure_plain_key SUBMIT_RATE_WINDOW_SECONDS 60
  ensure_plain_key MAX_PENDING_SUBMISSIONS_PER_USER 20
  ensure_plain_key MAX_JUDGE_QUEUE 500
  ensure_plain_key SPJ_TIMEOUT_MS 3000
  ensure_plain_key SPJ_MEMORY_LIMIT_MB 256
  ensure_plain_key LOGIN_RATE_LIMIT 20
  ensure_plain_key REGISTER_RATE_LIMIT 10
  ensure_plain_key XFYUN_API_KEY ''
  ensure_plain_key DEEPSEEK_API_KEY ''
  ensure_plain_key COOKIE_SECURE auto
  ensure_plain_key NPM_REGISTRY https://registry.npmmirror.com
  ensure_plain_key DOCKER_BUILD_APT_MIRROR http://mirrors.tuna.tsinghua.edu.cn/debian
  ensure_plain_key DOCKER_BUILD_APT_SECURITY_MIRROR http://mirrors.tuna.tsinghua.edu.cn/debian-security
  ensure_plain_key DOCKER_BUILD_NETWORK host
  ensure_plain_key LITEOJ_AUTO_PORT 1
  ensure_plain_key LITEOJ_PORT_SCAN_END 3099
  ensure_plain_key LITEOJ_GO_JUDGE_PORT_SCAN_END 5099
  ensure_plain_key LITEOJ_APT_MIRROR 1
  remove_env_key JUDGE_EXECUTOR
  remove_env_key JUDGE_SANDBOX
  remove_env_key JUDGE_SANDBOX_IMAGE
  remove_env_key JUDGE_SANDBOX_CPUS
  remove_env_key JUDGE_PROCESS_LIMIT
  remove_env_key JUDGE_FILE_LIMIT_KB
  remove_env_key JUDGE_GOJUDGE_URL
  remove_env_key JUDGE_GOJUDGE_TOKEN
  remove_env_key GO_JUDGE_BASE_IMAGE

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
    log "The initial password is saved in .env as ADMIN_PASSWORD."
  else
    log "Existing databases keep their current admin password; start.sh will not reset it from .env."
  fi
}
