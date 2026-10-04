# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (npm workspaces): the image needs shared/ too.
#   docker build -f api-service/Dockerfile -t arm-api .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production

# bcrypt is a native module: if npm cannot fetch a prebuilt binary for this
# Node version it compiles from source, which needs a toolchain. This lives in
# the builder stage only - the runtime image below stays slim.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Only the manifests first, so `docker build` reuses the install layer whenever
# application code changes but dependencies do not.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY api-service/package.json ./api-service/
RUN npm ci --omit=dev --workspaces --include-workspace-root 2>/dev/null \
    || npm install --omit=dev --workspaces --include-workspace-root

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY api-service ./api-service
# Migration runner + SQL, so `docker compose run migrate` and one-off Render shells work
COPY scripts ./scripts
COPY db ./db

WORKDIR /app/api-service
RUN mkdir -p public/temp && chown -R node:node /app

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:${PORT}/healthz || exit 1

CMD ["node", "src/index.js"]
