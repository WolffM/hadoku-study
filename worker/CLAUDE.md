# Study Worker

This is a Cloudflare Worker package that exports factory functions for hadoku_site.

## Architecture

This package is consumed by a thin host worker in `hadoku_site/workers/study-api/`.

```
@wolffm/study-worker (this package)
  └── Exports: createFetchHandler(), types

There is no `createScheduledHandler`: nothing about a flashcard set expires,
falls due or needs sweeping, so this worker has no cron trigger. Adding one back
means adding a `[triggers]` block to the host's wrangler.toml at the same time —
an exported handler with no trigger bound is dead code that reads as a feature.

hadoku_site/workers/study-api (host worker)
  └── Imports this package and delegates requests
```

## Key Files

- `src/index.ts` - Main exports (factory functions)
- `src/types.ts` - Environment interface (AppEnv)
- `src/schemas.ts` - Zod schemas for OpenAPI
- `src/db.ts` - D1 helpers, id generation, and the visibility rules
- `src/auth.ts` - who may read, who may write
- `src/routes/health.ts` - Health check endpoint (probes D1)
- `src/routes/sets.ts` - set + card CRUD, publish/unpublish
- `src/routes/progress.ts` - a reader's saved place in a set

## Access model, in one place

Two independent facts gate a write, and they fail separately:

- **Tier** — friend+, always through `tierAtLeast`, never `userType === 'friend'`.
  The ladder is `public < friend < service < wife < admin`, so an equality check
  silently excludes every tier above the one named.
- **Identity** — the registry `userId` that edge-router injects as `X-User-Id`.
  Rows bind to it, never to a raw key, because a key can rotate and the userId
  does not.

Reading is different: a PUBLISHED set is public, and a private set is filtered
out by SQL rather than by a tier check — so a stranger gets the same 404 whether
the id is real or not. That is why the gate lives in each handler and not in a
`requireMinTier` mounted on the path: `/sets/:id` is public to GET and friend+
to PATCH, and a path-level middleware cannot express one path with two policies.

## Database

D1, bound as `STUDY_DB`. Three tables — `sets`, `cards`, `set_progress` — with
migrations in `hadoku_site/workers/study-api/migrations/`.

`set_progress` is a resume BOOKMARK, not a scheduling record: v1 is a plain pass
over a set, so there is no interval or due date. Its `results` column stores a
JSON map of cardId to a result STRING (`got` / `missed`) rather than a boolean,
because v2 judges typed answers with an LLM and will need a third verdict —
widening a string union is not a migration, dropping a `correct BOOLEAN` column
is.

## Development

```bash
# Install dependencies
pnpm install

# Build package
pnpm build

# Run linting
pnpm lint

# Type check
pnpm typecheck
```

## Publishing

Package publishes automatically on push to main via GitHub Actions.

The workflow:

1. Builds the package
2. Bumps version if needed
3. Publishes to GitHub Packages
4. Notifies hadoku_site to update dependencies

## Preferences

User/device preferences are shared infrastructure — do NOT build a prefs store
in this worker. The platform prefs-api (D1-backed, at `hadoku.me/prefs/api/v1/*`)
is consumed by UI apps via `@wolffm/prefs-client`. This worker needs nothing.

## Adding New Routes

1. Create a new file in `src/routes/`
2. Use `OpenAPIHono` and `createRoute` for OpenAPI spec
3. Add schemas to `src/schemas.ts`
4. Mount the routes in `src/index.ts`

## Response Format

This package uses the **wrapped response format**:

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: 'Error Type', message: 'Details' }
```

Use `okWrapped()` and `createdWrapped()` helpers from `@wolffm/worker-utils`.

## Authentication

This worker uses `createEdgeAuth()` (from `@wolffm/worker-utils`) — edge-router stamps `X-Edge-Auth` + `X-Hadoku-Tier` on every proxied request, and this middleware reads them. The worker itself holds NO key arrays — the legacy `createHadokuAuth()` pattern was removed in the Step 4 auth-channel-consolidation rollout.

- `authContext.userType` is `'admin'`, `'service'`, `'friend'`, or `'public'`
- Direct `*.workers.dev` callers (no edge stamp) degrade to `'public'`
- Gate routes with `requireMinTier('<lowest tier that should get in>')` — higher tiers are admitted by rank, never listed. Inside a handler use `tierAtLeast(auth, 'admin')`, never `auth.userType === 'admin'`. See the [tier rule](../../workers/shared/CLAUDE.md#tier-rule--requiremintier-is-the-only-gate).

## Environment Variables

Set as CF Worker secrets (pushed via `python3 scripts/administration.py cloudflare-secrets <worker-name>`):

| Variable           | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `EDGE_AUTH_SECRET` | Shared edge-auth provenance token validated by `createEdgeAuth()` |
| `STUDY_API_KEY`    | Service-specific outbound auth (only if this worker calls others) |

## Deployment

After publishing, the host worker in hadoku_site will automatically:

1. Update to the latest version via `update-packages.yml`
2. Deploy to Cloudflare via `deploy-workers.yml`

## Vault — what your service-tier key can and can't do

This repo's vault key lives in `.devvault.local.json` at the repo root (gitignored, mode 0600). `dev-vault.mjs` reads it automatically. Per-key ACL is enforced as of 2026-05-04.

CAN do (no operator needed):

- `GET /api/secrets/status` — sealed/unlocked check
- `GET /api/secrets/get/:key` — fetch a value declared in this repo's `.devvault.json`
  (other repos' secrets return 403 — your key is scoped to THIS repo)
- `GET /api/secrets/acl/me` — see what your key is granted
- Verify with: `node ../hadoku_site/scripts/secrets/dev-vault.mjs --check`

CANNOT do (returns `403` — by design):

- Read secrets NOT in this repo's `.devvault.json`
- `POST /api/secrets/admin/set-many` — adding/changing secrets
- `POST /api/secrets/admin/lock` — sealing the vault
- `GET /api/secrets/list` — enumerating every secret name
- `GET /api/secrets/audit` — dead-key report

If your code reads a new `process.env.X` that isn't in `.devvault.json` yet:

1. Add the mapping to `.devvault.json` (commit-safe, no values).
2. Tomorrow's 08:00Z `secrets:devvault-acl-sync` cron auto-grants the new entries to your repo's key. If you need it NOW: ask the operator to run `python3 scripts/administration.py key-acl-sync --repo ../<this-repo> --key <uuid> [--prune]`.
3. Re-run your dev command.

Operator-only operations (set / lock / audit / grant) use `HADOKU_ADMIN_KEY`. Don't try to escalate: service tier can't write, and there is no key list to add yourself to — auth resolves from the edge-router key registry, which only an admin can write.

Lost or rotating your key? Operator: `python3 scripts/administration.py key-generate --tier service --repo ../<repo> --name <your-name>-<repo>` then drop the new UUID in `.devvault.local.json`.
