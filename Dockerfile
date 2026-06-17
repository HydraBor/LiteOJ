FROM node:22-bookworm-slim

WORKDIR /app

# g++/gcc/python3 are used by the teaching judge worker.
# tini improves signal handling inside containers.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 gcc g++ make tini \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 10001 judge

COPY package*.json .npmrc ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /app/data /app/.tmp && chown -R node:node /app/data /app/.tmp

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/server.js"]
