# Study: contributing

## Running it locally

```bash
pnpm install
pnpm dev      # vite dev server against index.html
pnpm test     # vitest, UI and worker
pnpm check    # lint + stylelint + typecheck + test + build, UI AND worker
```

Run it the way CI does before pushing, not the way your shell happens to be
warmed up:

```bash
rm -rf node_modules && pnpm install --frozen-lockfile && pnpm check
```

To see the second route on the same bundle locally: `pnpm dev`, then open
`/?basename=/wisdom`.

## Architecture

**UI micro-frontend + a Cloudflare Worker + D1**, chosen instead of a
locally-hosted tunnel app (the shape some sibling apps use). A flashcard is
a small structured record with no local-compute reason, and studying on a
phone must not depend on a tunnel host being awake.

| Path                   | What it is                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                 | The UI (`@wolffm/study`): views, games (`src/games/`), the wisdom map (`src/wisdom/`), the fact/question model and its linter (`src/model/`), state (`src/state/`). |
| `src/games/`           | One directory per playable mode plus the registry (`src/games/registry.ts`) — adding a mode is a new directory and one registry entry, no edits elsewhere.          |
| `worker/`              | The API (`@wolffm/study-worker`), on D1, at `/study/api`.                                                                                                           |
| `worker/src/rating.ts` | The pure difficulty-drift formula ([features.md#ratings-that-drift](features.md#ratings-that-drift)).                                                               |
| `research/`            | The wisdom dossiers: one per tradition, with sourced candidate passages, read before anything is promoted into `src/wisdom/pool.ts`.                                |

The worker's deploy config and D1 migrations live in the parent platform
site's repo, not here; this repo owns the worker's code and the UI only.
`study-api` is on the `apply_migrations` list in the parent's
`deploy-workers.yml`, so CI applies pending migrations before each deploy
rather than leaving them for someone to run by hand.

`/wisdom` is a second route on this same bundle, not a second app: the
parent site's registry has a `wisdom` entry pointing at this repo's
`/mf/study/` bundle with `basename: '/wisdom'`, and `App.tsx` branches on
that basename — nothing else tells the two routes apart.

### Identity and tiers

Rows bind to the registry `userId` the edge injects as `X-User-Id`, never
to a raw key, so a rotated key keeps a set. Tier and identity are checked
separately in `worker/src/auth.ts`, deliberately: a public caller has no
business writing regardless of identity, while a friend-tier request that
somehow arrives with no `X-User-Id` means the route in front of this
worker is misconfigured, not that the caller lacks permission.
`tierAtLeast` is used throughout, never a `===` tier comparison — tiers
are ordered and always compared with `tierAtLeast`, since an equality
check silently locks out every tier above the one named. Creating or
modifying a set specifically needs friend tier and up: `resolveWriter`
calls `tierAtLeast(auth, 'friend')` before touching anything
(`worker/src/auth.ts`).

## Tests and gates

`pnpm check` is the gate CI runs and this repo's required status check; it
covers the worker's typecheck, tests and build as well as the UI's. CI then
posts every test's outcome (each package's vitest JSON report,
`reports/vitest.json`) to the fleet test store with `report-tests`, red runs
included. Beyond the obvious unit tests, two are worth knowing about going
in.
`worker/src/factRows.test.ts` round-trips a real set export through a real
import and asserts nothing changed. `worker/src/rating.test.ts` pins the
drift formula's worked examples as numbers, not assertions from memory —
three of the original hand-written ones were wrong.

## How it deploys

Push to `main`. CI publishes whichever of this repo's packages actually
changed and notifies the parent platform site, which rebuilds the UI
bundle and redeploys; D1 migrations apply automatically, before the
worker's own deploy. The UI and the worker deploy in parallel from one
commit, so a change that renames a response field has a window where the
new UI meets the old worker, or the reverse. That window is safe for a
field that's only added; it is not safe for one that's renamed or removed
without a tolerant read on the client first.

## Trivia

A changed response shape is deployed in two independent halves that race
each other, the UI bundle and the worker. That race is why a straight
field rename, rather than an additive change, gets its own warning in the
project's internal handoff notes instead of being left to be relearned.
