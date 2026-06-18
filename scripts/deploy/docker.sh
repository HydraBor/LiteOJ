install_docker_if_needed() {
  if have docker && docker compose version >/dev/null 2>&1; then
    return 0
  fi

  have apt-get || die "Docker auto install currently supports Ubuntu/Debian with apt-get."
  [ -r /etc/os-release ] || die "Cannot detect Linux distribution from /etc/os-release."
  require_sudo
  install_basic_tools

  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || [ "${ID:-}" = "debian" ] || die "Unsupported OS for Docker auto install: ${ID:-unknown}"

  local codename arch repo
  codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || codename="$(lsb_release -cs 2>/dev/null || true)"
  [ -n "$codename" ] || die "Cannot determine OS codename."
  arch="$(dpkg --print-architecture)"

  "${SUDO[@]}" apt-get install -y ca-certificates curl gnupg
  "${SUDO[@]}" install -m 0755 -d /etc/apt/keyrings

  local candidates=()
  [ -n "${LITEOJ_DOCKER_APT_REPO:-}" ] && candidates+=("$LITEOJ_DOCKER_APT_REPO")
  candidates+=(
    "https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/${ID}"
    "https://mirrors.aliyun.com/docker-ce/linux/${ID}"
    "https://download.docker.com/linux/${ID}"
  )

  for repo in "${candidates[@]}"; do
    log "Trying Docker apt repository: $repo"
    "${SUDO[@]}" rm -f /etc/apt/keyrings/docker.gpg /etc/apt/sources.list.d/docker.list
    if ! curl -fsSL "${repo}/gpg" | "${SUDO[@]}" gpg --dearmor -o /etc/apt/keyrings/docker.gpg; then
      warn "Cannot fetch Docker GPG key from $repo"
      continue
    fi
    "${SUDO[@]}" chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] ${repo} ${codename} stable" \
      | "${SUDO[@]}" tee /etc/apt/sources.list.d/docker.list >/dev/null
    if apt_update && "${SUDO[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
      return 0
    fi
    warn "Docker install failed with repository $repo"
  done

  die "Cannot install Docker. Check network access or set LITEOJ_DOCKER_APT_REPO to a reachable mirror."
}

ensure_docker_group() {
  [ "$(id -u)" -eq 0 ] && return 0
  getent group docker >/dev/null 2>&1 || return 0
  if ! getent group docker | awk -F: -v user="$USER" '{ split($4, users, ","); for (i in users) if (users[i] == user) found=1 } END { exit found ? 0 : 1 }'; then
    require_sudo
    log "Adding $USER to docker group"
    "${SUDO[@]}" usermod -aG docker "$USER" || true
  fi
}

configure_docker_mirrors() {
  [ "${LITEOJ_DOCKER_MIRROR:-1}" = "0" ] && return 0
  require_sudo
  if [ -s /etc/docker/daemon.json ] && grep -q 'registry-mirrors' /etc/docker/daemon.json; then
    return 0
  fi
  if [ -s /etc/docker/daemon.json ]; then
    warn "/etc/docker/daemon.json exists and has no registry-mirrors; not overwriting custom config."
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
  DOCKER_MIRROR_CHANGED=1
}

restart_docker() {
  log "Restarting Docker daemon"
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
    return 0
  fi
  if have docker && "${SUDO[@]}" docker info >/dev/null 2>&1; then
    DOCKER=("${SUDO[@]}" docker)
    return 0
  fi

  require_sudo
  if have systemctl && [ -d /run/systemd/system ]; then
    "${SUDO[@]}" systemctl enable --now docker || true
  elif have service; then
    "${SUDO[@]}" service docker start || true
  else
    "${SUDO[@]}" nohup dockerd --host=unix:///var/run/docker.sock >/tmp/liteoj-dockerd.log 2>&1 &
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
  die "Docker daemon is not reachable."
}

ensure_mirrors_loaded() {
  local mirrors
  mirrors="$("${DOCKER[@]}" info --format '{{json .RegistryConfig.Mirrors}}' 2>/dev/null || true)"
  if printf '%s' "$mirrors" | grep -qE 'docker\.1ms\.run|docker\.m\.daocloud\.io'; then
    log "Docker registry mirrors loaded: $mirrors"
    return 0
  fi
  if [ -s /etc/docker/daemon.json ] && grep -q 'registry-mirrors' /etc/docker/daemon.json; then
    warn "Docker daemon has not loaded daemon.json yet; restarting once more."
    restart_docker
    start_docker
  fi
}

prepare_base_image() {
  log "Preparing base image node:22-bookworm-slim"
  if "${DOCKER[@]}" pull node:22-bookworm-slim; then
    return 0
  fi
  warn "Pull through Docker Hub failed; trying direct mirror images."
  for mirror in docker.1ms.run docker.m.daocloud.io; do
    if "${DOCKER[@]}" pull "${mirror}/library/node:22-bookworm-slim"; then
      "${DOCKER[@]}" tag "${mirror}/library/node:22-bookworm-slim" node:22-bookworm-slim
      return 0
    fi
  done
  die "Cannot pull node:22-bookworm-slim. Check server network or configure a reachable Docker mirror."
}

prepare_debian_base_image() {
  log "Preparing base image debian:bookworm-slim"
  if "${DOCKER[@]}" pull debian:bookworm-slim; then
    return 0
  fi
  warn "Pull through Docker Hub failed; trying direct mirror images for Debian."
  for mirror in docker.1ms.run docker.m.daocloud.io; do
    if "${DOCKER[@]}" pull "${mirror}/library/debian:bookworm-slim"; then
      "${DOCKER[@]}" tag "${mirror}/library/debian:bookworm-slim" debian:bookworm-slim
      return 0
    fi
  done
  die "Cannot pull debian:bookworm-slim. Check server network or configure a reachable Docker mirror."
}

go_judge_asset_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) printf 'amd64v2' ;;
    aarch64|arm64) printf 'arm64' ;;
    i386|i686) printf '386' ;;
    armv7l) printf 'armv7' ;;
    armv5*) printf 'armv5' ;;
    *) die "Unsupported CPU architecture for go-judge: $arch" ;;
  esac
}

prepare_go_judge_binary() {
  install_basic_tools
  local version base asset_arch url dest tmp
  version="${GO_JUDGE_VERSION:-1.12.0}"
  base="${GO_JUDGE_RELEASE_BASE:-https://github.com/criyle/go-judge/releases/download}"
  asset_arch="$(go_judge_asset_arch)"
  url="${base}/v${version}/go-judge_${version}_linux_${asset_arch}"
  dest="$RUNTIME_DIR/go-judge/go-judge"
  tmp="${dest}.tmp"

  mkdir -p "$(dirname "$dest")"
  if [ -x "$dest" ] && "$dest" -version 2>/dev/null | grep -q "v${version}"; then
    log "go-judge binary already prepared: $dest"
    return 0
  fi

  log "Preparing go-judge binary $version for $asset_arch"
  if ! curl -fL --retry 5 --retry-delay 2 --connect-timeout 20 -o "$tmp" "$url"; then
    rm -f "$tmp"
    die "Cannot download go-judge from $url. Set GO_JUDGE_RELEASE_BASE to a reachable release mirror."
  fi
  chmod 0755 "$tmp"
  mv "$tmp" "$dest"
}

prepare_go_judge_base_image() {
  prepare_debian_base_image
  prepare_go_judge_binary
}

ensure_docker() {
  install_docker_if_needed
  ensure_docker_group
  configure_docker_mirrors
  if [ "$DOCKER_MIRROR_CHANGED" = "1" ]; then
    restart_docker
  fi
  start_docker
  ensure_mirrors_loaded
}
