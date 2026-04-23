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
# The CLI + vscode packages are siblings in the workspace. We don't need
# their source, but pnpm wants to see their manifests during `install`.
COPY packages/cli/package.json packages/cli/
COPY apps/vscode/package.json apps/vscode/

# Install deps for the hosted package and its transitive workspace graph.
# `--filter ...` (no leading word) means "deps required by mcp-hosted."
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
        --filter @bretwardjames/ghp-mcp-hosted...

# Copy source for the three packages we actually build.
COPY packages/core/ packages/core/
COPY packages/mcp/ packages/mcp/
COPY packages/mcp-hosted/ packages/mcp-hosted/

RUN pnpm --filter @bretwardjames/ghp-mcp-hosted... build

# -------- runtime --------
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache wget \
    && corepack enable \
    && corepack prepare pnpm@9.15.0 --activate

# Copy the whole workspace from the builder. pnpm deployed binaries rely
# on workspace:* symlinks under node_modules, so a trimmed copy is risky;
# the builder stage already dropped devDependencies via --prod implicit
# install below.
COPY --from=builder /app /app

# Re-run install in --prod mode so devDependencies are pruned from node_modules.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod \
        --filter @bretwardjames/ghp-mcp-hosted...

ENV NODE_ENV=production
ENV GHP_MCP_MODE=hosted
EXPOSE 8731

# Non-root user for runtime. The image base has `node` (uid 1000) preset.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://localhost:${PORT:-8731}/healthz" | grep -q ok || exit 1

CMD ["node", "packages/mcp-hosted/dist/bin.js"]
