# hadoku-study

A flashcard app. Text-only. Live at [hadoku.me/study](https://hadoku.me/study).

This file was the build brief; it is now the map. The decisions below are
settled — the reasoning is kept because it is what stops them being relitigated,
not because any of it is still open.

## What it is

- A set is **owned by a user** and **private by default**.
- A set can be **published**, after which any user (including signed-out) can
  view and study it. Publishing is a per-set flag, not a separate copy — so an
  edit to a published set is live at once, and there is no draft/live pair to
  reconcile.
- Studying is **honor-system**: the card flips, the user self-grades
  "got it" / "missed it". No text entry, no scoring authority.
- A pass is a plain walk through the set. A missed card returns to the back of
  the queue and comes round again; the pass ends when the queue empties.

Out of scope, do not build, do not design around: v2 is typed answers judged by
an LLM; v3 is a competitive quiz with ELO. Mentioned only so you don't paint
them out — which is why `set_progress.results` stores a result STRING
(`got` / `missed`) rather than a boolean in a column called `correct`. Widening
a string union is not a migration; dropping a boolean column is.

## The value is in the drill loop

The data model is trivial on purpose. Almost all of the work is in the loop
feeling fast on a phone, and the following are load-bearing, not decoration:

- **The whole set is prefetched on entry.** `GET /study/api/sets/:id` returns
  every card, so nothing touches the network between flips.
- **Both card faces share one CSS grid cell**, so the card is as tall as its
  taller face _before_ you flip it. Sizing to the visible face would jump the
  grade buttons out from under a thumb already moving toward them.
- **The bookmark is written to the device synchronously on every grade**, and to
  the server on a debounce — flushed on `visibilitychange` and `pagehide` with
  `keepalive`. Locking the screen mid-session is the common case on a phone, not
  the edge case, and iOS never fires `beforeunload`/`unload`.
- **Swipe right/left grades, tap flips**; `touch-action: pan-y` leaves vertical
  scrolling to the browser so a drag never fights the page. Keyboard: space
  flips, arrows grade, escape leaves.
- Results record the **first** outcome per card, so "23 of 40 on the first try"
  means something.

## Architecture

**UI micro-frontend + `study-api` Cloudflare Worker + D1.**

Chosen against the alternative (tunnel + local disk, the shape conjure and
pygmalion use) for two reasons: flashcards are small structured records with no
local-compute reason, and a tunnel app is offline whenever the host box is.
Studying on a phone must not depend on hokon being awake.

D1 headroom is not a concern — a million cards is roughly 200 MB against a
10 GB/database ceiling. Do not add a caching layer for size reasons.

| Piece                           | Where                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| UI (`@wolffm/study`)            | `src/` in this repo                                                  |
| Worker (`@wolffm/study-worker`) | `worker/` in this repo                                               |
| Host worker + wrangler config   | `../hadoku_site/workers/study-api/`                                  |
| D1 schema                       | `../hadoku_site/workers/study-api/migrations/`                       |
| D1 database                     | `study-db`, `37e0e374-11d7-4c9e-9737-8e70170badf4`, bound `STUDY_DB` |

### Identity

Rows bind to the **registry `userId`** that edge-router injects as `X-User-Id`,
never to a raw key. A key can rotate; the userId does not.

`X-Hadoku-Tier` is also injected and is trustworthy — edge-router strips any
client-supplied value and re-stamps the real one under the `X-Edge-Auth` seal.

The `/study/api/*` route in `edge-router/src/index.ts` must keep
`injectUserId: true`. It shipped without it (the route atlas claimed it, the
handler did not), which meant no request carried an identity at all and nothing
could be owned. Fixed 2026-08-18.

### Tiers

- **friend+** to create or modify a set.
- **public** to read a _published_ set.
- A private set is visible only to its owner, and is reported as **absent** —
  a stranger gets the same 404 whether or not the id is real.

Gate with `tierAtLeast` from `@wolffm/worker-utils`. Never compare tiers with
`===` — the ladder is `public < friend < service < wife < admin`, and an
equality check silently excludes everyone above the tier you named. That exact
bug has shipped twice in this ecosystem.

Note the gate is per-METHOD and lives in each handler, not in a `requireMinTier`
mounted on a path: `/sets/:id` is public to GET when the set is published and
friend+-and-owner to PATCH. One path, two policies — which a path-level
middleware cannot express, and which mounting one anyway would resolve by making
a shared set require an account.

Progress is gated on **identity, not tier**: it is private data about a set the
caller can already read. Signed-out readers keep their place on the device.

## A set is one file, and that is load-bearing

Sets move between the app, a script and an agent as a single JSON document, and
the format is not a second schema to keep in sync — it is a SUBSET of what
`GET /sets/:id` already returns:

```json
{
  "title": "...",
  "description": "...",
  "published": true,
  "cards": [{ "front": "...", "back": "..." }]
}
```

The round trip works because zod **strips** unknown keys rather than rejecting
them, so an exported set — `id`, `isOwner`, `cardCount`, per-card `id` and all —
parses as a create or replace body untouched. That is a zod DEFAULT, not a
decision anyone wrote in the schema, so a single `.strict()` added for tidiness
would break every import with a validation error and no other signal.
`worker/src/schemas.test.ts` exists to be that signal. Do not delete it, and do
not make the input schemas strict.

`PUT /sets/:id` writes a whole file back — title, description and every card in
one D1 batch. It exists because the editor previously saved as PATCH → card PUT
→ re-GET: three round trips, and a window in which a set had the new title and
the old deck. Cards are still replaceable on their own via `PUT /sets/:id/cards`
for callers that only have a deck.

`published` is the one field a PUT treats as "leave alone" when omitted, because
it is access control on the row rather than content. A hand-written file that
never mentions publication must not be able to silently unshare a set. Export
always writes it, so a true round trip is still lossless.

## The OpenAPI spec is the agent interface

Served at `/study/api/openapi.json`, generated from the same zod schemas the
handlers validate against, so it cannot drift from the implementation. It is
the reason there is no MCP server here: an MCP for one app would be a second
auth path and a second lifecycle wrapping the same eleven endpoints, and the
fleet-level version of that idea would be built on these specs anyway.

Two things about it are asserted in `worker/src/spec.test.ts` because both
shipped broken and stayed broken for months — a wrong spec breaks nobody's
build, it breaks the next caller who trusts it:

- **`servers[].url` carries the ORIGIN only.** Every path already includes the
  `/study/api` prefix the worker mounts on, so a server URL that repeats it
  makes generated clients request `/study/api/study/api/...` and 404 on their
  first call. Fixed 2026-08-19.
- **`securitySchemes` is declared**, and every operation carries a `security`
  list. Without it the spec describes an API that appears to 403 for no stated
  reason. `OPTIONAL_AUTH` starts with an empty requirement object — OpenAPI for
  "reachable with no credentials" — which is what marks published sets readable
  signed-out. Keep the two schemes as separate list entries: a list is OR, while
  two keys in one object is AND, and merging them would tell every generated
  client to send both headers on every call.

## Hard constraints

- **Externalize the singletons.** React, `@wolffm/themes`,
  `@wolffm/task-ui-components`, `@wolffm/logger/client`, `@wolffm/prefs-client`
  **and `zod`** come from the parent page's import map, and every one is listed
  in `rollupOptions.external`. Inlining a singleton gives the page a second copy
  the first never talks to — this took the whole site's theming down on
  2026-08-05 and typechecks, lints, builds and tests clean every time. zod is
  not a singleton but is in the map, and externalizing it took the bundle from
  131 kB to 33 kB. `pnpm run check:mf-externals` in hadoku_site is the gate.
- **Canonical session keys.** `hadoku_session_id` and `hadoku_user_type` in
  localStorage. Do not invent `studySessionId`.
- **Colors come from tokens only.** No hex, no `text-white` on a filled
  background, no `var(--color-x, #fallback)`. `pnpm run lint:css`.
- **No `.env` files.** Local dev secrets go through `.devvault.json`.
- **CI must not say `runs-on: ubuntu-latest`.** Use
  `${{ fromJSON(vars.CI_RUNNER || '["self-hosted","hadoku-builder"]') }}`.
- **This repo is PUBLIC.** Any job triggered by `pull_request` that lands on a
  self-hosted runner must carry an `author_association` guard — see `ci.yml`,
  which picks a different runner rather than skipping, because a skipped
  required check never reports and leaves the PR unmergeable forever.
- **The CI job is named `check`** because that is this repo's required status
  context in `../hadoku_site/scripts/admin/repo-policy-manifest.json`.

## Workflow

Work in a worktree, never the main checkout. Commit, don't stash — `refs/stash`
is repo-global and will swallow other agents' files.

`pnpm check` is the gate, and it covers the worker's typecheck, tests and build
as well as the UI's. Run it the way CI does before pushing, not the way your shell is
warmed up:

```bash
rm -rf node_modules && pnpm install --frozen-lockfile && pnpm check
```

`@wolffm` package bugs are **never** worked around. Diagnose, write fix
instructions, wait for the publish.

## Shipping a change

Push to `main`. `publish.yml` bumps and publishes whichever packages actually
changed, then dispatches `packages_updated` to hadoku_site, which rebuilds the
bundle under `public/mf/study/` and redeploys. Workers pull `--latest` at deploy
time independently, so a worker never ships a stale bundle.

Two things that are **not** automatic:

- **D1 migrations.** Add `NNNN_name.sql` to
  `../hadoku_site/workers/study-api/migrations/` and apply it:
  `pnpm --filter study-api exec wrangler d1 migrations apply study-db --remote`.
- **A new `[[d1_databases]]` / secret binding**, which needs a
  `wrangler deploy` of `study-api` and, for secrets,
  `python3 scripts/administration.py cloudflare-secrets study-api`.

Debugging: `/health-check` skill. Quick orient —
`curl https://hadoku.me/study/api/health` reports D1 reachability, not just that
the worker booted.
