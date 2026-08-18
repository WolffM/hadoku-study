# Handoff: hadoku-study

Build a flashcard app. This repo is a scaffold — the wiring into the platform is
already done and pushed; what's missing is the product.

## Read first

- `../hadoku_site/CLAUDE.md` — platform rules. Not optional.
- `../hadoku_site/docs/child-apps/CHECKLIST_study.md` — generated, app-specific.
- `node_modules/@wolffm/themes/THEME_USAGE_GUIDE.md` — before writing any styles.

## What it is

Flashcard sets you create and drill. **Text-only for v1** — no images, no audio.

- A set is **owned by a user** and **private by default**.
- A set can be **published**, after which any user (including signed-out) can
  view and study it. Publishing is a per-set flag, not a separate copy.
- Studying is **honor-system**: the card flips, the user self-grades
  "got it" / "missed it". No text entry, no scoring authority.

Out of scope, do not build, do not design around: v2 is typed answers judged by
an LLM; v3 is a competitive quiz with ELO. Mentioned only so you don't paint
them out — a `grade` that is currently a boolean should not be a boolean-shaped
column name.

## The actual work is the UI

The data model here is nearly trivial. **Almost all the value is in the drill
loop feeling fast and good on a phone.** Budget your effort accordingly:

- Mobile-first, thumb-reachable controls. Swipe to grade is the obvious idiom;
  make sure a keyboard path exists too (space to flip, arrows to grade).
- The flip must be instant. Prefetch the whole set on entry — a set is a few kB
  of text, so there is no excuse for a network round trip between cards.
- No layout shift on flip. Size the card to the taller face.
- It must survive a lock screen and a rotate mid-session without losing place.

## Architecture (decided — do not relitigate)

**UI micro-frontend + `study-api` Cloudflare Worker + D1.**

This was chosen against the alternative (tunnel + local disk, the shape conjure
and pygmalion use) for two reasons: flashcards are small structured records with
no local-compute reason, and a tunnel app is offline whenever the host box is.
Studying on a phone must not depend on hokon being awake.

D1 headroom is not a concern — the account is on Workers Paid (1 TB total,
10 GB/database) and currently uses ~1 GB across 12 databases. A million cards is
roughly 200 MB. Do not add a caching layer for size reasons.

### The D1 database does not exist yet

`../hadoku_site/workers/study-api/wrangler.toml` ships with the `[[d1_databases]]`
block **commented out**, because a scaffold cannot invent a `database_id`. You
create it:

```bash
cd ../hadoku_site
pnpm --filter study-api exec wrangler d1 create study-db
```

then uncomment the block with the returned id and binding `STUDY_DB`, and add a
`migrations/` directory. The worker currently deploys as a stub that answers
`503 {"error":"Not deployed yet"}` on every path — verified live at
`hadoku.me/study/api/health`, so the route binding and edge wiring are already
confirmed working. Replacing that stub is your job; the header comment in
`src/index.ts` shows the shape it expects.

### Identity

Rows bind to the **registry `userId`** that edge-router injects as `X-User-Id`,
never to a raw key. This is settled platform-wide (task and jobplatform were
migrated to it). A key can rotate; the userId does not.

`X-Hadoku-Tier` is also injected and is trustworthy — edge-router strips any
client-supplied value and re-stamps the real one under the `X-Edge-Auth` seal.

### Tiers

- **friend+** to create or modify a set.
- **public** to read a *published* set.
- A private set is visible only to its owner.

Gate with `requireMinTier` / `tierAtLeast` from `@wolffm/worker-utils`. Never
compare tiers with `===` — the ladder is
`public < friend < service < wife < admin`, and an equality check silently
excludes everyone above the tier you named. That exact bug has shipped twice in
this ecosystem.

### Preview policy

`/study` is already registered as `'default'` in
`../hadoku_site/spec/preview-policy.ts` — a shared public set is meant to unfurl.
Private sets are protected by the gate, not by preview silence. No change needed.

## Hard constraints

- **Externalize the singletons.** React, `@wolffm/themes`,
  `@wolffm/task-ui-components`, `@wolffm/logger/client` and
  `@wolffm/prefs-client` come from the parent page's import map. Your lib build
  must list them in `rollupOptions.external`. Inlining one gives the page a
  second copy the first never talks to — this took the whole site's theming down
  on 2026-08-05 and typechecks, lints, builds and tests clean every time.
  `pnpm run check:mf-externals` in hadoku_site is the gate.
- **Canonical session keys.** `hadoku_session_id` and `hadoku_user_type` in
  localStorage. Do not invent `studySessionId`.
- **Colors come from tokens only.** No hex, no `text-white` on a filled
  background, no `var(--color-x, #fallback)`. `pnpm run lint:css`.
- **No `.env` files.** Local dev secrets go through `.devvault.json`.
- **CI must not say `runs-on: ubuntu-latest`.** Use
  `${{ fromJSON(vars.CI_RUNNER || '["self-hosted","hadoku-builder"]') }}`.
- **This repo is PUBLIC.** Any job triggered by `pull_request` that lands on a
  self-hosted runner must carry an author guard, or a fork PR runs
  attacker-controlled code on a machine on the home LAN:
  ```yaml
  if: >-
    github.event_name != 'pull_request' ||
    contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'),
             github.event.pull_request.author_association)
  ```
  Guard on `author_association`, never on "is this a fork" — the latter also
  blocks your own collaborators. And never *skip* the job on a guard: a skipped
  required check never reports and leaves the PR unmergeable forever.
- **Name your CI job `check`.** `hadoku-study` is seeded with `check` as its
  required status context in
  `../hadoku_site/scripts/admin/repo-policy-manifest.json`. A different name
  means branch protection requires a check that never runs.

## Workflow

Work in a worktree, never the main checkout. Commit, don't stash — `refs/stash`
is repo-global and will swallow other agents' files.

`@wolffm` package bugs are **never** worked around. Diagnose, write fix
instructions, wait for the publish.

## This app is scaffolded DARK — `hadoku.me/study` returns 404, on purpose

There is no `/study` route and no MF registry entry yet, and **that is the
correct state**. A UI app has no bundle until its package publishes, and
`public/mf/study/` is filled at DEPLOY time from the installed package — so
registering the route early emits a page whose script tags point at files
`dist/` does not contain. `verify-dist-links` catches that and reds the Pages
deploy, and because the registry is built at deploy time, one red Pages run
blocks **every app in the fleet**. That is not hypothetical: it happened on
2026-08-18 when this app was scaffolded, and cost four deploys over 42 minutes.

So do not "fix" the 404 by adding the route. Going live is one command in
hadoku_site, run **after** `@wolffm/study` has published:

```bash
cd ../hadoku_site
pnpm install && pnpm run update-study-bundle
node scripts/build/hydrate-child-app.mjs --go-live study
pnpm run build && node scripts/build/verify-dist-links.mjs ./dist   # prove it
```

`--go-live` flips the registry entry, adds the route, and registers the
published packages together, and refuses to run while the bundle is missing.

## Done means

- `pnpm check` green. That job name is this repo's REQUIRED status context —
  branch protection is already on and requires it.
- Run it the way CI does before pushing, not the way your shell is warmed up:
  `rm -rf node_modules && pnpm install --frozen-lockfile && pnpm check`.
- The app mounts at `hadoku.me/study` via `mount(el)` / `unmount(el)` from
  `entry.tsx` — **after** the go-live step above.
- `@wolffm/study-worker` has never published. Until the `worker/` tree changes
  and publishes it, it is deliberately absent from hadoku_site's
  DEFAULT_PACKAGES; `--go-live` adds whichever packages actually resolve on the
  registry. Do not add it by hand — a package that 404s reds Update Packages on
  every release.
- A published set is readable signed-out, on a phone, and a private set 404s to
  a stranger. Check both by hand — the tier ladder is the thing most likely to
  be subtly wrong.
