FROM node:22-bookworm-slim

WORKDIR /app

ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG NPM_REGISTRY=https://registry.npmmirror.com

# g++/gcc/python3 are used by the teaching judge worker.
# tini improves signal handling inside containers.
RUN APT_BOOTSTRAP_MIRROR="$(printf '%s' "$APT_MIRROR" | sed 's#^https://#http://#')" \
  && APT_BOOTSTRAP_SECURITY_MIRROR="$(printf '%s' "$APT_SECURITY_MIRROR" | sed 's#^https://#http://#')" \
  && if [ -n "$APT_BOOTSTRAP_MIRROR" ] && [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i \
        -e "s#http://deb.debian.org/debian#${APT_BOOTSTRAP_MIRROR}#g" \
        -e "s#https://deb.debian.org/debian#${APT_BOOTSTRAP_MIRROR}#g" \
        -e "s#http://security.debian.org/debian-security#${APT_BOOTSTRAP_SECURITY_MIRROR}#g" \
        -e "s#https://security.debian.org/debian-security#${APT_BOOTSTRAP_SECURITY_MIRROR}#g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 gcc g++ make tini \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 10001 judge

COPY package*.json .npmrc ./
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 300000 \
  && npm config set audit false \
  && npm config set fund false \
  && for registry in "$NPM_REGISTRY" "https://registry.npmmirror.com" "https://registry.npmjs.org"; do \
       [ -n "$registry" ] || continue; \
       npm config set registry "$registry"; \
       echo "Trying npm install from $registry"; \
       for attempt in 1 2 3; do \
         npm ci --omit=dev --no-audit --no-fund && exit 0; \
         echo "npm install failed from $registry, attempt $attempt"; \
         sleep $((attempt * 5)); \
       done; \
     done; \
     echo "npm install failed from all configured registries" >&2; \
     exit 1

COPY . .
RUN mkdir -p /app/data /app/.tmp && chown -R node:node /app/data /app/.tmp

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/server.js"]
