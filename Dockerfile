# syntax=docker/dockerfile:1
FROM node:24-bookworm AS build

WORKDIR /app
ENV HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential pipx python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json babel.config.js ./
COPY src ./src
COPY public ./public
COPY bin ./bin
RUN npm run build \
    && npm prune --omit=dev \
    && install -d -o node -g node /home/node/.local/bin /home/node/.local/pipx

USER node
ENV PATH=/home/node/.local/bin:$PATH
RUN pipx install ffsubsync \
    && pipx install autosubsync

FROM node:24-slim AS runtime

ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=512 \
    WEB_HOST=0.0.0.0 \
    WEB_PORT=3000 \
    DB_PATH=/app/data/subsyncarr-plus.db \
    PATH=/home/node/.local/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gosu python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data \
    && chown -R node:node /app /home/node

COPY --from=mwader/static-ffmpeg:8.1.1 /ffmpeg /usr/local/bin/ffmpeg
COPY --from=mwader/static-ffmpeg:8.1.1 /ffprobe /usr/local/bin/ffprobe
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/bin/alass /home/node/.local/bin/alass
COPY --from=build --chown=node:node /home/node/.local /home/node/.local

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.WEB_PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--optimize-for-size", "dist/index-server.js"]
