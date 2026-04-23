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
GHP_GITHUB_OAUTH_CLIENT_ID=<your-app-client-id> \
GHP_GITHUB_OAUTH_CLIENT_SECRET=<your-app-client-secret> \
GHP_ALLOWED_REDIRECT_URIS=https://runtight.example.com/oauth/callback \
GHP_HOSTED_BASE_URL=https://your-tailscale-funnel.ts.net \
PORT=8731 \
  node packages/mcp-hosted/dist/bin.js
```

Required setup:

1. **GitHub OAuth App.** Create one at https://github.com/settings/developers.
   Callback URL: `<GHP_HOSTED_BASE_URL>/oauth/callback`. Scopes: `read:project`, `project`, `repo`.
2. **Public HTTPS tunnel.** GitHub's consent page has to be able to redirect
   back to your callback. For dev use Tailscale Funnel:
   ```bash
   tailscale funnel --bg --https=8443 http://localhost:8731
   ```
   Set `GHP_HOSTED_BASE_URL=https://<machine>.tail-xxx.ts.net:8443`.
3. **Redirect URI allowlist.** `GHP_ALLOWED_REDIRECT_URIS` must include the
   exact `redirect_uri` your MCP client (runtight, etc.) uses.

`GHP_REPO` scopes the server to a single GitHub repo per instance — spin
up multiple instances (one per repo) to serve multiple projects.

Probe:

```bash
curl http://localhost:8731/healthz
# ok

curl -X POST http://localhost:8731/mcp \
  -H "Authorization: Bearer $(gh auth token)" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

## Environment

| Var                              | Required | Default    | Purpose                                                                    |
|----------------------------------|----------|------------|----------------------------------------------------------------------------|
| `GHP_MCP_MODE`                   | yes      | —          | Must be `hosted`. Refuses to start otherwise.                              |
| `GHP_REPO`                       | yes      | —          | Locks every session to `owner/name`.                                       |
| `GHP_GITHUB_OAUTH_CLIENT_ID`     | yes      | —          | GitHub OAuth App client id (created at https://github.com/settings/developers). |
| `GHP_GITHUB_OAUTH_CLIENT_SECRET` | yes      | —          | GitHub OAuth App client secret.                                            |
| `GHP_ALLOWED_REDIRECT_URIS`      | yes      | —          | Comma-separated exact redirect_uri allowlist. **Exact binary match.** Trailing slash, host casing, and explicit default ports all count — `https://x/cb` ≠ `https://x/cb/` ≠ `https://X/cb` ≠ `https://x:443/cb`. |
| `PORT`                           | no       | `8731`     | HTTP listen port. Railway / Fly inject this. 8731 avoids common local collisions. |
| `GHP_HOSTED_BASE_URL`            | prod     | —          | Public https URL. Required in production. Used to build OAuth metadata + the GitHub callback URL. |
| `GHP_ALLOWED_ORIGINS`            | no       | `*`        | CORS allowlist.                                                            |
| `GHP_OAUTH_STATE_TTL_SECONDS`    | no       | `600`      | Ephemeral TTL for authorize state + auth codes.                            |
| `NODE_ENV`                       | no       | `development` |                                                                         |

## Endpoints

| Method | Path                                         | Purpose                                                                    |
|--------|----------------------------------------------|----------------------------------------------------------------------------|
| GET    | `/healthz`                                   | Plaintext `ok` — Railway / Fly healthcheck.                                |
| GET    | `/.well-known/oauth-protected-resource`      | RFC 9728 metadata. Advertises ourselves as the authorization server.       |
| GET    | `/.well-known/oauth-authorization-server`    | RFC 8414 metadata. Declares `code_challenge_methods_supported: ["S256"]`.  |
| POST   | `/oauth/register`                            | Dynamic Client Registration (RFC 7591) — validates redirect_uri allowlist. |
| GET    | `/oauth/authorize`                           | Start the flow. Redirects to GitHub consent with a server-side state.      |
| GET    | `/oauth/callback`                            | GitHub redirects here. Exchanges code for token, mints our own auth code.  |
| POST   | `/oauth/token`                               | Exchange our auth code + PKCE verifier for the GitHub access token.        |
| POST   | `/mcp`                                       | MCP Streamable HTTP endpoint. `Authorization: Bearer <token>` required.    |

## OAuth flow

```
  MCP client                  Hosted GHP                     GitHub
      │                            │                            │
      │ 1. GET .well-known/prm     │                            │
      │───────────────────────────▶│                            │
      │ 2. GET .well-known/as      │                            │
      │───────────────────────────▶│                            │
      │ 3. POST /oauth/register    │                            │
      │───────────────────────────▶│                            │
      │ 4. GET /oauth/authorize    │                            │
      │    (PKCE challenge)        │                            │
      │───────────────────────────▶│ 5. Redirect to github      │
      │                            │───────────────────────────▶│
      │                            │                            │ user consents
      │                            │ 6. Callback with code      │
      │                            │◀───────────────────────────│
      │                            │ 7. Exchange code → token   │
      │                            │───────────────────────────▶│
      │                            │◀──── access_token ─────────│
      │ 8. Redirect with our code  │                            │
      │◀───────────────────────────│                            │
      │ 9. POST /oauth/token       │                            │
      │    (code + verifier)       │                            │
      │───────────────────────────▶│ (verify PKCE, return token)│
      │◀─── github access_token ───│                            │
```

PKCE is mediated on our side: GitHub OAuth Apps don't natively support PKCE, so the hosted server tracks the client's `code_challenge` in an ephemeral TTL map keyed by the server-side state it sent to GitHub. The client's original state is echoed back verbatim on final redirect.

Token strategy in v1: **pass-through**. The client receives the GitHub Bearer token directly. Lifetime and revocation are GitHub-controlled. Wrapping tokens (where we'd issue an opaque token mapping to a GitHub token) is a possible future iteration if independent revocation is needed.

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
