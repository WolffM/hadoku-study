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
- `src/routes/sets.ts` - set + fact CRUD, publish/unpublish
- `src/variants.ts` - the ONE implementation of fact -> questions
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

D1, bound as `STUDY_DB`. Migrations live in
`hadoku_site/workers/study-api/migrations/` and are applied by CI before the
deploy — study-api is in the `apply_migrations` list in `deploy-workers.yml`.

Tables: `sets`, `facts`, `variant_ratings`, `user_variant_ratings`, `attempts`,
`set_progress`. (`cards` still exists, holding the pre-0003 rows the backfill
was derived from. 0004 drops it once production has confirmed the migration.)

**A fact is the unit of storage, not a question.** `facts.slots` is a JSON
object of named values — what is true. `facts.questions` is a JSON array of
declarations: which slot is the ANSWER, which are shown, how it reads.

**Variants are derived on read and never stored.** `expandFact` in
`variants.ts` is the only implementation, and it lives here rather than in the
client on purpose: a variant's key is what ratings hang off, and a key computed
in two places is a key that eventually disagrees with itself — silently, with
no error, splitting one question's history in two. `GET /sets/{id}` returns
variants fully resolved and the client renders what it is handed.

The response carries BOTH `questions` (as authored) and `variants` (as
resolved). Only the first is content: exporting from `variants` alone would
bake this build's fallback phrasings in as though someone had written them.

**A fact keeps its id across a save.** Saving replaces a set's facts wholesale,
so `resolveFactIds` hands each incoming fact back the id it arrived with when
that id already belongs to the set. Drop the ids and every rating and attempt
hanging off them is orphaned with no error anywhere.

`set_progress` is a resume BOOKMARK, not a scheduling record — one row per
reader, overwritten on every grade, deleted when a pass completes. `attempts`
is what it could never be: append-only, one row per answer, with the rating
before and after so a change to the drift formula can be replayed over history
rather than orphaning it. Both key on VARIANT ids (`factId:variantKey`), not
fact ids: two questions over one fact are two separate things to get right.

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
