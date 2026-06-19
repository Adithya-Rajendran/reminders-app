# ---- deps: install all deps (incl. dev) + copy source ----
# Shared base for the test and build stages so npm ci (and the native
# better-sqlite3 compile) happens once.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Toolchain for native deps (better-sqlite3) in case a prebuilt binary isn't
# available; the compiled node_modules is reused by the build & test stages.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# ---- test: CI parity in a container (lint, build, server syntax, unit tests). ----
# Run with `docker build --target test .` — any failing check fails the build.
# Mirrors the .github/workflows/ci.yml lint-build job; e2e (Playwright + real
# CalDAV/WebDAV backends) is a separate job and not run here.
FROM deps AS test
RUN npm run lint \
  && npm run build \
  && npm run check \
  && npm test \
  && npm run test:component

# ---- build: production SPA + prod-only deps ----
FROM deps AS build
RUN npm run build && npm prune --omit=dev

# ---- runtime: BFF serves the built SPA ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
