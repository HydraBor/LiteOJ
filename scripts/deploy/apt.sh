backup_once() {
  local file="$1"
  local backup="${file}.liteoj.bak"
  [ -e "$backup" ] && return 0
  "${SUDO[@]}" cp --update=none "$file" "$backup" 2>/dev/null && return 0
  "${SUDO[@]}" cp -n "$file" "$backup" || true
}

configure_apt_mirror() {
  [ "${LITEOJ_APT_MIRROR:-1}" = "0" ] && return 0
  have apt-get || return 0
  [ -r /etc/os-release ] || return 0

  # shellcheck disable=SC1091
  . /etc/os-release
  local mirror security_mirror files=()
  case "${ID:-}" in
    ubuntu)
      mirror="${LITEOJ_UBUNTU_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/ubuntu}"
      security_mirror="$mirror"
      ;;
    debian)
      mirror="${LITEOJ_DEBIAN_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/debian}"
      security_mirror="${LITEOJ_DEBIAN_SECURITY_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/debian-security}"
      ;;
    *)
      return 0
      ;;
  esac

  [ -f /etc/apt/sources.list ] && files+=("/etc/apt/sources.list")
  [ -f /etc/apt/sources.list.d/ubuntu.sources ] && files+=("/etc/apt/sources.list.d/ubuntu.sources")
  [ -f /etc/apt/sources.list.d/debian.sources ] && files+=("/etc/apt/sources.list.d/debian.sources")
  [ "${#files[@]}" -gt 0 ] || return 0

  log "Configuring apt mirror for ${ID:-Linux}"
  for file in "${files[@]}"; do
    backup_once "$file"
    if [ "${ID:-}" = "ubuntu" ]; then
      "${SUDO[@]}" sed -i \
        -e "s#http://archive.ubuntu.com/ubuntu#${mirror}#g" \
        -e "s#https://archive.ubuntu.com/ubuntu#${mirror}#g" \
        -e "s#http://security.ubuntu.com/ubuntu#${security_mirror}#g" \
        -e "s#https://security.ubuntu.com/ubuntu#${security_mirror}#g" \
        "$file"
    else
      "${SUDO[@]}" sed -i \
        -e "s#http://deb.debian.org/debian#${mirror}#g" \
        -e "s#https://deb.debian.org/debian#${mirror}#g" \
        -e "s#http://security.debian.org/debian-security#${security_mirror}#g" \
        -e "s#https://security.debian.org/debian-security#${security_mirror}#g" \
        "$file"
    fi
  done
}

apt_update() {
  configure_apt_mirror
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
  have apt-get || die "Missing tools (${missing[*]}), and apt-get is unavailable."
  require_sudo
  apt_update
  "${SUDO[@]}" apt-get install -y ca-certificates curl tar xz-utils
}
