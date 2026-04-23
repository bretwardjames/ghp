#syntax=docker/dockerfile:1.7

# --------------------------------------------------------------------------
# ghp-mcp-hosted — production container.
#
# Build context MUST be the repo root (not packages/mcp-hosted/) so that
# pnpm can resolve workspace dependencies (@bretwardjames/ghp-core,
# @bretwardjames/ghp-mcp). Run from root:
#
#   docker build -f packages/mcp-hosted/Dockerfile -t ghp-mcp-hosted .
#
# Railway reads this path via railway.json; see DEPLOY.md.
# --------------------------------------------------------------------------

# -------- builder --------
FROM node:20-alpine AS builder
WORKDIR /app

# Install corepack + pnpm@9 (pin matches root package.json packageManager).
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy the minimum workspace metadata so pnpm can resolve the graph.
# Source changes (and only source changes) invalidate the later layers.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY packages/mcp-hosted/package.json packages/mcp-hosted/
# Sibling packages in the workspace — only their manifests are needed for
# pnpm's workspace resolver, not their source.
COPY packages/cli/package.json packages/cli/
COPY apps/vscode/package.json apps/vscode/

# Install deps for the hosted package and its transitive workspace graph.
# `--filter ghp-mcp-hosted...` means "the hosted package plus everything
# it depends on" (core, mcp), skipping cli and vscode.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
        --filter @bretwardjames/ghp-mcp-hosted...

# Copy source for the three packages we actually build.
COPY packages/core/ packages/core/
COPY packages/mcp/ packages/mcp/
COPY packages/mcp-hosted/ packages/mcp-hosted/

RUN pnpm --filter @bretwardjames/ghp-mcp-hosted... build

# `pnpm deploy` produces a self-contained output: built dist + only
# production dependencies, with workspace:* deps materialised as real
# directories instead of symlinks. The result is portable, so the
# runtime stage doesn't need pnpm at all and no second install is run.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter @bretwardjames/ghp-mcp-hosted --prod /deploy

# -------- runtime --------
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache wget

# Only the deployed output — no pnpm, no workspace manifests for
# unrelated packages, no devDependencies.
COPY --from=builder /deploy /app

ENV NODE_ENV=production
ENV GHP_MCP_MODE=hosted
EXPOSE 8731

# Non-root user for runtime. The image base has `node` (uid 1000) preset.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://localhost:${PORT:-8731}/healthz" | grep -q ok || exit 1

CMD ["node", "dist/bin.js"]
