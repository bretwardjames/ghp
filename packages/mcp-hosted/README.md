# @bretwardjames/ghp-mcp-hosted

Hosted (HTTP) MCP server for [ghp](https://github.com/bretwardjames/ghp) — multi-tenant GitHub Projects tooling for AI platforms like [runtight](https://github.com/bretwardjames/runtight).

This package is the **sibling** of `@bretwardjames/ghp-mcp`:

|                     | `@bretwardjames/ghp-mcp`          | `@bretwardjames/ghp-mcp-hosted`      |
|---------------------|------------------------------------|--------------------------------------|
| Transport           | stdio                              | MCP Streamable HTTP                  |
| Auth                | `GITHUB_TOKEN` / `gh auth token`   | per-request `Authorization: Bearer`  |
| Tools exposed       | 28 (full)                          | 18 pure-api (local-only disabled)    |
| Deployment target   | Claude Desktop / local CLI         | Railway / Fly / any PaaS             |
| Tenancy             | single user, single machine        | multi-tenant                         |

The stdio server is **not replaced** — power users and local agents keep it. This package is additive.

## Status

**Early.** Implements the HTTP transport + Bearer auth only. OAuth 2.1 + PKCE + RFC 9728 discovery land in #279. Dockerfile + Railway config land in #280.

## Quickstart (local dev with a PAT)

```bash
pnpm build
GHP_MCP_MODE=hosted \
GHP_REPO=bretwardjames/ghp \
PORT=3000 \
  node packages/mcp-hosted/dist/bin.js
```

Probe:

```bash
curl http://localhost:3000/healthz
# ok

curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $(gh auth token)" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

## Environment

| Var                    | Required | Default         | Purpose                                             |
|------------------------|----------|-----------------|-----------------------------------------------------|
| `GHP_MCP_MODE`         | yes      | —               | Must be `hosted`. Refuses to start otherwise.       |
| `PORT`                 | no       | `3000`          | HTTP listen port. Railway / Fly inject this.        |
| `GHP_HOSTED_BASE_URL`  | prod     | —               | Public https URL. Required if `NODE_ENV=production`.|
| `GHP_REPO`             | no       | —               | Lock every session to `owner/name`.                 |
| `GHP_ALLOWED_ORIGINS`  | no       | `*`             | CORS allowlist.                                     |
| `GHP_LOG_LEVEL`        | no       | `info`          | `trace` / `debug` / `info` / `warn` / `error`.      |
| `NODE_ENV`             | no       | `development`   |                                                     |

## Endpoints

| Method | Path                                         | Purpose                                          |
|--------|----------------------------------------------|--------------------------------------------------|
| GET    | `/healthz`                                   | Plaintext `ok` — Railway / Fly healthcheck.      |
| GET    | `/.well-known/oauth-protected-resource`      | RFC 9728 metadata. Stub returning 501 until #279.|
| GET    | `/.well-known/oauth-authorization-server`    | RFC 8414 metadata. Stub returning 501 until #279.|
| POST   | `/mcp`                                       | MCP Streamable HTTP endpoint.                    |

## Security model

- **No persistent token storage.** Each request's Bearer is wrapped in a request-scoped `BearerTokenProvider` and discarded when the response ends.
- **Capability filter at registration.** Only `pureApiTools` from `@bretwardjames/ghp-mcp` are ever registered. Local-only tools (`create_worktree`, `merge_pr`, etc.) cannot be called.
- **Belt + suspenders.** `assertHostedSafe()` re-validates every tool's capability at registration time. A future refactor that accidentally pulls in a local-only tool would fail loudly.
- **Mode guard.** `GHP_MCP_MODE=hosted` is required. Prevents accidental launches on a dev machine where the HTTP surface would be unintended.
- **Production TLS.** Refuses to start in production without `GHP_HOSTED_BASE_URL` starting with `https://`.

## Tool surface (default build)

17 tools registered by default:

`get_my_work`, `get_project_board`, `get_standup`, `get_fields`, `move_issue`, `mark_done`, `update_issue`, `assign_issue`, `add_comment`, `set_field`, `add_label`*, `remove_label`*, `set_parent`*, `link_branch`*, `unlink_branch`*, `get_progress`*, `get_issue`*

*\* opt-in via existing `enabledTools` config — ghp-mcp's `disabledByDefault` honoured here too.*

Excluded (local-only, cannot run on hosted):

`create_worktree`, `remove_worktree`, `list_worktrees`, `create_pr`, `merge_pr`, `sync_merged_prs`, `release`, `start_work`, `stop_work`*, `get_tags`, `create_issue`†

*\* `stop_work` is classified `pure-api` but `disabledByDefault`; opt in to expose.*
*† `create_issue` is gated `local-only` until #278 adds the hook-block guard. See [tool classification](../mcp/src/tools/).*

## Development

```bash
pnpm --filter @bretwardjames/ghp-mcp-hosted build
pnpm --filter @bretwardjames/ghp-mcp-hosted test
pnpm --filter @bretwardjames/ghp-mcp-hosted dev
```

## Related issues

- #276 — Epic: Hosted GHP MCP server for runtight integration
- #278 — **This package** (skeleton + HTTP + Bearer)
- #279 — OAuth 2.1 + well-known discovery
- #280 — Docker + Railway deploy
- #281 — runtight registration + E2E
