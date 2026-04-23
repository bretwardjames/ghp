# E2E runbook: register hosted GHP in runtight

Verifies the full stack shipped by epic #276 works end-to-end: a
runtight user authenticates with GitHub via the hosted GHP MCP
server's OAuth flow, then calls a read + a write tool from chat, with
no secrets exchanged out-of-band.

**This is a manual runbook** — most steps need your Railway account,
GitHub account, and runtight dev instance. Nothing here is automated
because each step involves a consent screen or a shared-state change
outside the repo.

## Prerequisites

- [ ] `RUNTIGHT_HOST` set to a **tenant** host, not a bare API host.
      runtight's middleware resolves `appId` from the subdomain, a
      `?appId=<id>` query parameter, or an `x-app-id: <id>` header.
      Hitting a bare host without one of these returns 400. Pick the
      subdomain form for simplicity:
      `export RUNTIGHT_HOST=<yourapp>.runtight.io`.
- [ ] Hosted GHP MCP deployed and reachable at a public HTTPS URL.
      Use Railway per `DEPLOY.md`, or Tailscale Funnel for a dev run:
      `tailscale funnel --bg --https=8443 http://localhost:8731`.
- [ ] GitHub OAuth App created with the callback set to
      `<GHP_HOSTED_BASE_URL>/oauth/callback`.
- [ ] Required env vars set on the hosted instance:
      - `GHP_MCP_MODE=hosted`
      - `GHP_REPO=bretwardjames/ghp` (or the repo you want tools scoped to)
      - `GHP_GITHUB_OAUTH_CLIENT_ID`, `GHP_GITHUB_OAUTH_CLIENT_SECRET`
      - `GHP_ALLOWED_REDIRECT_URIS` — MUST include the exact runtight callback.
        Find it with: `curl -s https://<runtight>/api/mcp-servers/registry | jq`
        or hardcode `https://<runtight-host>/api/mcp-servers/oauth/callback`.
      - `GHP_HOSTED_BASE_URL=https://<your-public-url>`
      - `NODE_ENV=production` (Railway) or `development` (Tailscale)
- [ ] runtight dev instance running, with a test user account in a test app.
- [ ] Access to the runtight database to inspect `McpUserAuth` (psql or Prisma Studio).

## 1. Pre-flight the hosted instance

```bash
# Health
curl "$GHP_URL/healthz"
# → ok

# OAuth discovery (should be real metadata, not 501 stubs)
curl "$GHP_URL/.well-known/oauth-protected-resource" | jq
curl "$GHP_URL/.well-known/oauth-authorization-server" | jq

# No-auth MCP request should 401 with WWW-Authenticate pointing at PRM
curl -i -X POST "$GHP_URL/mcp" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  | grep -i www-authenticate
```

All three must succeed before proceeding.

## 2. Register the server in runtight

Sign in to runtight as your test user, then either use the UI
(Integrations → Add MCP server) or call the API directly:

```bash
# Get a runtight session cookie first (runtight uses Firebase session cookies,
# see server/api/auth/session.post.ts). Easiest path: browser DevTools → copy
# __session cookie → export as RUNTIGHT_COOKIE.

curl -X POST "https://$RUNTIGHT_HOST/api/mcp-servers" \
  -H "Cookie: __session=$RUNTIGHT_COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "GHP",
    "slug": "ghp",
    "description": "GitHub Projects management via ghp",
    "level": "account",
    "connectionUrl": "'"$GHP_URL"'/mcp",
    "transportType": "streamable-http",
    "authType": "per_user"
  }'
```

Capture the returned `id` — call it `$SERVER_ID`.

Expected: 200 OK (runtight's handler doesn't explicitly set 201),
`McpServer` row in runtight's database with `level: 'account'`,
`authType: 'per_user'`, `transportType: 'streamable-http'`, and both
`toolWhitelist` and `toolBlacklist` empty (so step 5's `add_comment`
will be allowed through).

## 3. Start the OAuth flow

```bash
curl -X POST "https://$RUNTIGHT_HOST/api/mcp-servers/$SERVER_ID/oauth/start" \
  -H "Cookie: __session=$RUNTIGHT_COOKIE"
# → { "authorizationUrl": "https://<ghp>/oauth/authorize?..." }
```

Open the `authorizationUrl` in a browser. You should see:

1. Brief redirect through our `/oauth/authorize`.
2. GitHub's consent page for the OAuth App you registered — listing the
   scopes `read:project`, `project`, `repo`.
3. Click **Authorize**.
4. Redirect to our `/oauth/callback`, then to runtight's
   `/api/mcp-servers/oauth/callback`, then back into runtight's UI
   showing "Connected as @your-github-login".

Check status:

```bash
curl "https://$RUNTIGHT_HOST/api/mcp-servers/$SERVER_ID/oauth/status" \
  -H "Cookie: __session=$RUNTIGHT_COOKIE"
# → { "status": "connected" }
```

The `McpUserAuthStatus` enum values are `pending | connected | expired
| revoked`. A fresh successful flow ends at `connected`. `expired`
happens when GitHub rejects the token at tool-call time (see step 8),
and `revoked` only comes from the explicit disconnect flow (step 9).

Database check:

```sql
SELECT "serverId", "accountId", status,
       (LENGTH("accessTokenEncrypted") > 0) AS has_token
FROM "McpUserAuth"
WHERE "serverId" = '<SERVER_ID>';
```

Expected: one row, `status = 'connected'`, `has_token = true`.

## 4. Invoke a read tool from chat

Open an AI conversation in runtight. Prompt:

> List my open GitHub issues using the GHP MCP.

Expected:

- Claude emits a `tool_use` block calling `mcp__ghp__get_my_work`.
- Runtight routes to the hosted GHP via `executeExternalToolCall` in
  `server/utils/ai/mcp-client-manager.ts`.
- Hosted GHP receives `Authorization: Bearer <your-github-token>` and
  returns issues from `bretwardjames/ghp` (or whatever `GHP_REPO` is).
- Chat renders a list including at least one current open issue.

Observability checks during the call:

- **Hosted GHP logs:** one `POST /mcp` 200 response per chat turn.
- **Token secrecy check.** Grab the first 8 chars of the GitHub token
  from the `McpUserAuth.accessTokenEncrypted` decryption (or, easier,
  from your GitHub settings where you stored it) and grep the hosted
  logs for it:
  ```bash
  railway logs --service ghp-mcp-hosted | grep -c "$TOKEN_PREFIX"
  # must be 0 — any non-zero result means a token value leaked into logs
  ```
  Also confirm no literal `Authorization:` header values appear:
  ```bash
  railway logs --service ghp-mcp-hosted | grep -E '^[^#]*Bearer '
  # must return nothing
  ```
- **runtight logs:** `discoverExternalTools` trace + one
  `executeExternalToolCall` trace with `tool: "mcp__ghp__get_my_work"`.

## 5. Invoke a write tool from chat

Pick an existing issue in the repo (note the number). Prompt:

> Add a comment on issue #<N> in bretwardjames/ghp saying "hosted mcp
> e2e smoke test".

Expected:

- Claude calls `mcp__ghp__add_comment`.
- Hosted GHP invokes GraphQL `addComment` using your GitHub token.
- A real comment appears on the chosen issue under your GitHub user.
- Chat replies confirming the comment was posted.

After verifying, delete the test comment from the GitHub UI so it
doesn't clutter the issue.

Note: `create_issue` is currently **not** exposed on hosted (see the
"Known gaps" section below for why). Use `add_comment`, `move_issue`,
`update_issue`, or `assign_issue` for write-tool verification.

## 6. Verify local-only tools are absent

Prompt:

> Create a worktree for issue 123.

Expected: Claude should NOT have `mcp__ghp__create_worktree` in the
available tool list (capability filter excludes it in hosted mode).
It will either decline, ask for clarification, or use a different
tool. Confirm by inspecting the tool list offered to Claude — the
runtight log trace shows `discoverExternalTools` results per turn.

## 7. Multi-tenant cross-contamination test

Critical for any shared hosting. Two different runtight users connecting
to the same hosted GHP instance must never see each other's tokens.

1. Create a second test user in the same runtight app.
2. Repeat steps 3-4 for the second user using a DIFFERENT GitHub account.
3. Inspect `McpUserAuth`:

   ```sql
   SELECT "accountId",
          (LENGTH("accessTokenEncrypted") > 0) AS has_token
   FROM "McpUserAuth"
   WHERE "serverId" = '<SERVER_ID>';
   ```

   Expected: two rows, distinct `accountId`s, both with tokens.

4. Fire chat calls from both users concurrently (open two browser
   windows). Have user A ask "list my issues" and user B ask "list
   mine" at the same time.
5. Verify each user sees only their own GitHub account's issues.

Two browser tabs tabbing between each other will serialize at the
human level, which is not a real concurrency test. Supplement with a
programmatic probe that races two bearers at once against the hosted
`/mcp` endpoint directly:

```bash
# Decrypt both tokens into $TOKEN_A / $TOKEN_B (Prisma Studio works,
# or add a temporary /debug/decrypt route gated behind an admin flag).
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"race","version":"1"}}}'
CALL='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_my_work","arguments":{}}}'

curl -s -X POST "$GHP_URL/mcp" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$INIT" > /dev/null
curl -s -X POST "$GHP_URL/mcp" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$CALL" > a.json &

curl -s -X POST "$GHP_URL/mcp" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$INIT" > /dev/null
curl -s -X POST "$GHP_URL/mcp" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$CALL" > b.json &

wait

# Assert the two responses report different GitHub logins.
grep -E "assignee|login|author" a.json b.json
```

If any user sees the other's data — or if the two responses show the
same login — this is a critical multi-tenancy bug. File immediately
and roll back the deploy.

## 8. Token revocation check

1. Visit https://github.com/settings/applications → find the GHP OAuth App
   → **Revoke**.
2. Back in runtight chat, ask "list my issues" again.
3. Expected: the hosted GHP's call to GitHub returns 401; runtight
   catches the 401 in `mcp-client-manager.ts` and flips the
   `McpUserAuth` row to `status: 'expired'` (NOT `'revoked'` —
   `'revoked'` is reserved for the explicit disconnect in step 9).
4. Verify:
   ```sql
   SELECT status FROM "McpUserAuth"
   WHERE "serverId" = '<SERVER_ID>' AND "accountId" = '<your-account-id>';
   -- → expired
   ```
5. The runtight UI surfaces a "reauthenticate" state via the status
   endpoint.

Edge case: runtight's expiry-flip filter is
`where: { status: 'connected' }`. If the row was already `'expired'`
(e.g. a previous failed call this session), the update is a no-op
and the DB value stays `'expired'`. This is correct behaviour, not a
bug — flag if the DB stays at `'connected'` after a confirmed 401.

## 9. Disconnect flow

```bash
curl -X POST "https://$RUNTIGHT_HOST/api/mcp-servers/$SERVER_ID/oauth/disconnect" \
  -H "Cookie: __session=$RUNTIGHT_COOKIE"
# → { "success": true }
```

Confirm `McpUserAuth.status` flipped to `revoked` and
`accessTokenEncrypted` is null.

## Sign-off checklist

All must be true before marking epic #276 as Done:

- [ ] `/healthz` + `.well-known` + 401 `WWW-Authenticate` shape correct
- [ ] runtight server registration returns 200 and DB row
- [ ] `/oauth/start` returns a usable `authorizationUrl`
- [ ] End-to-end consent redirect lands back in runtight UI with "Connected"
- [ ] `McpUserAuth.status = 'connected'` with encrypted token stored
- [ ] Read tool (`get_my_work`) returns real data through chat
- [ ] Write tool (`add_comment`) posts a comment on a real GitHub issue
- [ ] Hosted server logs grep clean for token prefix + literal Bearer values
- [ ] Local-only tools (`create_worktree`, `merge_pr`, etc.) absent from
      available tools list
- [ ] Two concurrent users, distinct tokens, no cross-contamination (browser + programmatic probe)
- [ ] GitHub-side token revocation flips `McpUserAuth.status` to `expired`
- [ ] `/oauth/disconnect` flips `McpUserAuth.status` to `revoked`

Once all pass, close epic #276.

## Known gaps

These are called out so the first real user isn't surprised:

- **No token refresh.** GitHub OAuth Apps don't issue refresh tokens.
  When a user's token expires or is revoked, they must re-run the
  OAuth flow. GitHub Apps (not OAuth Apps) support refresh; switching
  is a future ticket.
- **Single repo per hosted instance.** `GHP_REPO` locks every session
  to one repo. Multi-repo per instance is out of scope for v1 —
  deploy multiple instances if needed, or wait for the follow-up
  ticket.
- **In-memory OAuth state store.** Horizontal scaling needs Redis.
  `StateStore<T>` in `src/oauth/state-store.ts` has the right
  interface for swap-in; not blocking until real traffic arrives.
- **`create_issue` still `local-only`.** `add-issue.ts` in
  `@bretwardjames/ghp-mcp` dispatches user-configurable hooks via
  `executeHooksForEvent` and is therefore gated off on hosted until
  a mode-aware guard lands. See the comment on `add-issue.ts:meta`.
