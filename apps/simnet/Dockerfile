# Simnet — anvil forks + session API + RPC proxy (ADR 0014).
# Build context = repo root (needs packages/*, contracts/ and the root package-lock.json):
#   docker build -f apps/simnet/Dockerfile -t tahansoe-simnet .
# Secrets are NOT baked in: .env is mounted via env_file in docker-compose (I8).
FROM node:22-bookworm-slim

ARG FOUNDRY_VERSION=stable

ENV NODE_ENV=production \
    TZ=Asia/Jakarta \
    CI=1 \
    NO_COLOR=1 \
    FOUNDRY_DIR=/opt/foundry \
    PATH=/opt/foundry/bin:$PATH

# Foundry (anvil + forge) via foundryup. git is needed by `forge install`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://foundry.paradigm.xyz | bash \
    && foundryup --install "$FOUNDRY_VERSION" \
    && anvil --version && forge --version

WORKDIR /app

# Manifests first so the npm ci layer is cached. Other workspaces' package.json are
# only there to keep the lockfile consistent; their dependencies are not installed.
COPY package.json package-lock.json ./
COPY apps/engine/package.json apps/engine/
COPY apps/web/package.json apps/web/
COPY apps/simnet/package.json apps/simnet/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN npm ci --include=dev --no-audit --no-fund -w @tahansoe/simnet -w @tahansoe/domain \
    && npm cache clean --force

COPY packages/domain/ packages/domain/
COPY contracts/ contracts/
COPY apps/simnet/ apps/simnet/
RUN chown -R node:node contracts

# Build contracts as the runtime user so forge's solc cache lives in its home.
USER node
RUN cd contracts \
    && (test -d lib/forge-std || forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git) \
    && forge build

WORKDIR /app/apps/simnet
EXPOSE 8787
CMD ["npx", "tsx", "src/main.ts"]
