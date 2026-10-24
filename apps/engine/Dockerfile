# Core Risk Engine — image worker (`tahansoe start`, foreground).
# Build context = root repo (butuh packages/* dan package-lock.json root):
#   docker build -f apps/engine/Dockerfile -t tahansoe-engine .
# Secret TIDAK masuk image: .env dipasang lewat env_file di docker-compose (I8).
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    TZ=Asia/Jakarta \
    CI=1 \
    NO_COLOR=1

WORKDIR /app

# Manifest dulu agar layer npm ci ter-cache. apps/web/package.json hanya untuk
# konsistensi lockfile workspaces; dependensi web tidak di-install.
COPY package.json package-lock.json ./
COPY apps/engine/package.json apps/engine/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN npm ci --include=dev --no-audit --no-fund \
      -w @tahansoe/engine -w @tahansoe/db -w @tahansoe/domain \
    && npm cache clean --force

COPY packages/ packages/
COPY apps/engine/ apps/engine/

RUN mkdir -p apps/engine/.data apps/engine/out /app/config \
    && chown -R node:node apps/engine/.data apps/engine/out /app/config

USER node
WORKDIR /app/apps/engine

CMD ["npx", "tsx", "src/cli/tahansoe.ts", "start"]
