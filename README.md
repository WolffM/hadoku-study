# @wolffm/study

Study sets you write, publish and play. Live at
[hadoku.me/study](https://hadoku.me/study).

A set holds **facts**, not cards. A fact is one thing that is true, as named
slots; the API expands each into the **questions** you can ask of it. Front and
back are how a question is drawn, not how anything is stored — which is why 22
facts in the Reformation set ask 62 different questions.

Every question carries a rating that drifts as it is played, and a board is
**dealt** from that rating rather than authored.

`HANDOFF.md` is the map — architecture, the access model, the drift formula,
and why each of them is the way it is. Read it before changing anything in
`src/state/`, `src/games/` or the worker.

## Layout

| Path         | What                                                            |
| ------------ | --------------------------------------------------------------- |
| `src/`       | the micro-frontend (`@wolffm/study`)                            |
| `src/games/` | one directory per playable mode, plus the registry              |
| `src/model/` | facts, questions, and the content linter                        |
| `worker/`    | the API (`@wolffm/study-worker`), running on D1 at `/study/api` |

The host worker and the D1 migrations live in the parent repo, under
`../hadoku_site/workers/study-api/`. Migrations are applied by CI before the
deploy — study-api is in the `apply_migrations` list in `deploy-workers.yml`.

## A set is a single file

`GET /study/api/sets/:id/file` returns the whole set as a bare document — no
success envelope, no derived fields — and it is a valid `PUT` body exactly as
it comes. That round trip is asserted in `worker/src/factRows.test.ts` rather
than trusted.

```json
{
  "formatVersion": 2,
  "title": "The Reformation",
  "published": true,
  "facts": [
    {
      "id": "worms",
      "slots": {
        "quote": "“Here I stand, I can do no other. God help me.”",
        "who": "Martin Luther",
        "what": "refused to recant his writings before the emperor",
        "where": "the Diet of Worms",
        "when": "1521"
      },
      "detail": "The famous sentence may be a later addition; the speech is genuine.",
      "questions": [
        {
          "ask": "who",
          "given": [],
          "seedTier": 1,
          "prompt": "“Here I stand, I can do no other. God help me.” — who said it?"
        },
        {
          "ask": "when",
          "given": [],
          "seedTier": 2,
          "prompt": "In what year did Luther refuse to recant before the emperor?"
        }
      ]
    }
  ]
}
```

- **`ask`** names the slot that is the ANSWER.
- **`given`** is what gets DRAWN beside the prompt. A written prompt is usually
  a complete question, so it usually wants `"given": []` — otherwise the same
  sentence prints twice, once as the question and once as context. Omitting
  `given` entirely means every other slot.
- **`prompt`** is how the question reads. Write one.
- **`questions`** omitted means "ask each slot in turn, giving all the others".
- **`seedTier`** (1–5) only SEEDS difficulty; play moves it from there.
- **`detail`** is revealed after the answer — the why, never the answer.

Only `title` and `facts` are required. On `PUT`, an omitted `published` leaves
visibility **alone**: a file describes a set's content, so a hand-written one
that never mentions publication must not be able to unshare a set.

**Send each fact back with the `id` it was exported with.** Ratings and attempt
history hang off it, and saving replaces a set's facts wholesale — a file that
drops the ids discards everything the set has learned, with no error anywhere.

A response also carries a `variants` array per fact: each declared question,
resolved, with a stable `key`. Those keys are derived on the server and nowhere
else, because a key computed in two places eventually disagrees with itself.
Read them; never build one.

## Handing a set to an agent

Open the set and press **Copy JSON**. That puts the file on your clipboard with
a short brief in front of it — the slot vocabulary, what `given` actually does,
and the rule about keeping fact ids. The brief lives in `src/agentBrief.ts`;
every paragraph in it is there because leaving it out produced a specific kind
of bad output. **Export file** is the same content with no brief, as a
download.

Paste what comes back into the editor's **Import a file** (or **Paste a list**).
The editor runs `src/model/lint.ts` over it and lists what it finds:

- a question whose prompt **gives away its own answer** — the mistake that
  reads fine and is worthless
- a question that shows context it **already said**, printing it twice
- a declaration asking a slot the fact does not have, which the server skips,
  so the question you wrote **silently never appears**
- two declarations that resolve to the same question
- whether the set can fill a board, and which columns are too shallow

None of that is enforced by the API — a well-formed bad set imports perfectly
well. The linter is the difference between finding out now and finding out
while playing.

To do the same without the UI:

```bash
API=https://hadoku.me/study/api
curl -s $API/sets/$ID/file > set.json     # no key needed for a published set
# ... hand set.json to an agent, get it back ...
curl -sX PUT -H "X-User-Key: $KEY" --json @set.json $API/sets/$ID
```

## Driving it from a script

The spec is at
[`/study/api/openapi.json`](https://hadoku.me/study/api/openapi.json), generated
from the same zod schemas the handlers validate against, so it cannot drift from
the implementation. Point a client generator at it.

Authenticate with `X-User-Key: <your hadoku key>`. edge-router resolves it to a
registry user and re-stamps the request; sets bind to that userId, never to the
key, so rotating a key keeps your sets. Reading a _published_ set needs no key.

```bash
KEY=...   # friend tier or above, needed for every write
API=https://hadoku.me/study/api

# browse what is public — no key
curl -s $API/sets/published | jq '.data.sets[] | {id, title, factCount}'

# the whole set, wrapped, with every question resolved
curl -sH "X-User-Key: $KEY" $API/sets/$ID | jq .data.set

# the portable file, bare
curl -sH "X-User-Key: $KEY" $API/sets/$ID/file > set.json

# import as a NEW set — add '"published": true' to share it on create.
# ids are ignored here: a create has no set for them to belong to.
curl -sH "X-User-Key: $KEY" --json @set.json $API/sets

# write it back over the SAME set: metadata and every fact, one D1 transaction
curl -sX PUT -H "X-User-Key: $KEY" --json @set.json $API/sets/$ID
```

`PATCH /sets/:id` is the partial alternative — rename, re-describe, or flip
`published` without touching content.

Ratings live behind two more routes, both gated on identity rather than tier:
`GET /sets/:id/ratings` says how every question stands, and
`POST /sets/:id/attempts` records answers and returns what they moved.

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
redeploys. D1 migrations apply automatically, before the worker deploys.

The UI and the worker deploy **in parallel** from one commit, so a change that
renames a response field has a minute or two where the new UI meets the old API.
`HANDOFF.md` § "Deploying a change to the response shape" has the rule.
