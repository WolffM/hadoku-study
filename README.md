# @wolffm/study

Flashcard sets you create, publish, and drill. Live at
[hadoku.me/study](https://hadoku.me/study).

Text-only. A set is owned by a user and private by default; publishing it is a
per-set flag that lets anyone — signed in or not — read and study the same rows.
Studying is honor-system: the card flips and you self-grade.

`HANDOFF.md` is the map — architecture, the access model, and why the drill loop
is built the way it is. Read it before changing anything in `src/state/` or the
worker.

## Layout

| Path         | What                                                            |
| ------------ | --------------------------------------------------------------- |
| `src/`       | the micro-frontend (`@wolffm/study`)                            |
| `src/games/` | one directory per playable mode, plus the registry              |
| `worker/`    | the API (`@wolffm/study-worker`), running on D1 at `/study/api` |

The host worker and the D1 migrations live in the parent repo, under
`../hadoku_site/workers/study-api/`.

## A set is a single file

`GET /study/api/sets/:id` returns the whole set, cards included, and the write
endpoints strip fields they do not own instead of rejecting them — so what you
export is a valid import body with nothing edited out. That is the property
that makes a set portable, and `worker/src/schemas.test.ts` asserts it rather
than trusting it.

```json
{
  "title": "Russian — animals",
  "description": "First 40 nouns",
  "published": true,
  "cards": [{ "front": "кот", "back": "cat" }]
}
```

Only `title` and `cards` are required. On `PUT`, an omitted `published` leaves
visibility **alone**: a file describes a set's content, so a hand-written one
that never mentions publication must not be able to unshare a set.

A card may also carry `detail` — the explanation shown after the answer — and
`attrs`, a bag of per-game attributes keyed by game id. That is how the same
file describes a flashcard deck and a Jeopardy-style board:

```json
{
  "front": "The lakeside city whose great council burned a Czech reformer.",
  "back": "Constance",
  "detail": "The Council of 1414–1418, which elected Martin V and executed Jan Hus.",
  "attrs": { "board": { "category": "Places", "difficulty": 3 } }
}
```

Known games are typed and published in the spec; unknown namespaces are
preserved as-is, so a new mode needs no schema change and no deploy to start
storing its data. Every board is already a deck — drop the attrs and it still
studies — while a deck becomes a board only once its cards carry
`attrs.board`.

In the app, **Export file** is on every set you can read — including someone
else's published set — and the editor's **Import a file** takes the same
document back, plus a raw API response, a bare JSON array of cards, or a
tab/comma-separated paste out of a spreadsheet.

## Driving it from a script or an agent

The spec is at
[`/study/api/openapi.json`](https://hadoku.me/study/api/openapi.json) and is
generated from the same zod schemas the handlers validate against, so it cannot
drift from the implementation. Point a client generator at it.

Authenticate with `X-User-Key: <your hadoku key>`. edge-router resolves it to a
registry user and re-stamps the request; sets bind to that userId, never to the
key, so rotating a key keeps your sets. Reading a _published_ set needs no key
at all.

```bash
KEY=...   # friend tier or above, needed for every write
API=https://hadoku.me/study/api

# browse what is public — no key
curl -s $API/sets/published | jq '.data.sets[] | {id, title, cardCount}'

# export
curl -sH "X-User-Key: $KEY" $API/sets/$ID | jq .data.set > set.json

# import as a NEW set — add '"published": true' to share it on create
curl -sH "X-User-Key: $KEY" --json @set.json $API/sets

# write an edited file back over the SAME set: metadata and every card, one
# request, one D1 transaction
curl -sX PUT -H "X-User-Key: $KEY" --json @set.json $API/sets/$ID
```

`PATCH /sets/:id` is the partial alternative — rename, re-describe, or flip
`published` without touching cards.

## Development

```bash
pnpm install
pnpm dev      # vite dev server against index.html
pnpm test     # vitest, UI and worker
pnpm check    # lint + stylelint + typecheck + test + build, UI AND worker
```

`pnpm check` is the gate CI runs, and `check` is this repo's required status
context. Run it the way CI does before pushing, not the way your shell is warmed
up:

```bash
rm -rf node_modules && pnpm install --frozen-lockfile && pnpm check
```

### Logging

Use the platform logger rather than `console.log` — it is routed and redacted,
and its output is only visible in dev or to an admin.

```typescript
import { logger } from '@wolffm/logger/client'

logger.info('Message', { key: 'value' })
logger.error('Error occurred', error)
```

## Integration

This app mounts into [hadoku_site](https://github.com/WolffM/hadoku_site), which
supplies React, the theme system and the prefs client through the page's import
map. Everything in that map is externalized here — see `vite.config.ts`, and the
"Hard constraints" section of `HANDOFF.md` for what happens when it is not.

```typescript
export interface StudyProps {
  /** Theme name, passed by the host (e.g. 'ocean-dark'). */
  theme?: string
  /** API base, injected from the MF registry. Defaults to '/study/api'. */
  apiBaseUrl?: string
}

import { mount, unmount } from '@wolffm/study'

mount(document.getElementById('app-root'), { theme: 'ocean-dark' })
unmount(document.getElementById('app-root'))
```

### Theming

Colors come from `@wolffm/themes` tokens, never hex:

```css
background-color: var(--color-bg);
color: var(--color-text);
border-color: var(--color-border);
```

**Do not set `data-theme` by hand.** `<HadokuThemeRoot>` owns the theme, its
persistence and the picker, and mirrors the attribute onto the mount subtree
itself — an app that also writes it fights the provider. Pass it a
`containerRef` and let it do the work; `src/App.tsx` shows the shape.

## Deployment

Push to `main`. CI bumps and publishes whichever packages actually changed, then
notifies the parent site, which rebuilds the bundle under `public/mf/study/` and
redeploys.

Two things are **not** automatic — D1 migrations, and any new binding or secret
on the worker. `HANDOFF.md` § "Shipping a change" has the commands.
