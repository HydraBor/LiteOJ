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
  local index_file="$RUNTIME_DIR/node-index.json"
  curl -fsSL https://npmmirror.com/mirrors/node/index.json -o "$index_file"
  version="$(awk 'match($0, /"version"[[:space:]]*:[[:space:]]*"v22[^"]*/) { value = substr($0, RSTART, RLENGTH); sub(/^"version"[[:space:]]*:[[:space:]]*"/, "", value); print value; exit }' "$index_file")"
  [ -n "$version" ] || die "Cannot resolve latest Node.js 22 version from npmmirror."
  archive="node-${version}-linux-${node_arch}.tar.xz"
  url="https://npmmirror.com/mirrors/node/${version}/${archive}"
  curl -fL "$url" -o "$RUNTIME_DIR/$archive"
  rm -rf "$RUNTIME_DIR/node-${version}-linux-${node_arch}"
  tar -xJf "$RUNTIME_DIR/$archive" -C "$RUNTIME_DIR"
  node_dir="$RUNTIME_DIR/node-${version}-linux-${node_arch}"
  ln -sfn "$node_dir" "$RUNTIME_DIR/node"
  NODE_BIN="$RUNTIME_DIR/node/bin/node"
}
