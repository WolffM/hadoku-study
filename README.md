# @wolffm/study

**Guide:** [overview](docs/guide/index.md) · [features](docs/guide/features.md) · [contributing](docs/guide/contributing.md) · [history](docs/guide/history.md) · [trivia](docs/guide/trivia.md)

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

This repo's layout and architecture are in
[contributing.md](docs/guide/contributing.md#architecture). The host worker
and the D1 migrations live in the parent repo, under
`../hadoku_site/workers/study-api/`. `/wisdom`, a second route served from
this same bundle, is covered in [features.md](docs/guide/features.md#wisdom);
to add a passage to it, read `research/README.md`.

## A set is a single file

`GET /study/api/sets/:id/file` returns the whole set as a bare document — no
success envelope, no derived fields — and it is a valid `PUT` body exactly as
it comes (see [features.md](docs/guide/features.md#a-set-is-a-file) for why).
The field reference:

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

Only `title` and `facts` are required; everything else `PUT` and the UI's
**Copy JSON** / **Import a file** round trip are explained in
[features.md](docs/guide/features.md#a-set-is-a-file) and
[features.md](docs/guide/features.md#handing-a-set-to-an-agent).

## Handing a set to an agent

To do the same without the UI — see
[features.md](docs/guide/features.md#handing-a-set-to-an-agent) for what
**Copy JSON** and the import linter do:

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

```bash
# hand a set to someone else. Owner only, or admin — you can GIVE a set away,
# you cannot take one. A userId is an opaque identifier, not a credential and
# not necessarily a UUID:
#   GET /session/whoami                        -> your own
#   GET /session/keys/by-repo?repo=owner/name  -> a repo's identities (service tier)
curl -sX POST -H "X-User-Key: $KEY" --json '{"userId":"hadoku"}' \
  $API/sets/$ID/owner

# with an admin key, omit the id to claim a set for yourself outright
curl -sX POST -H "X-User-Key: $ADMIN_KEY" --json '{}' $API/sets/$ID/owner
```

Ratings live behind two more routes, both gated on identity rather than tier:
`GET /sets/:id/ratings` says how every question stands, and
`POST /sets/:id/attempts` records answers and returns what they moved.

## Development

Running it locally, tests and gates, and how it deploys are in
[contributing.md](docs/guide/contributing.md).

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

See [contributing.md](docs/guide/contributing.md#how-it-deploys); for the
UI/worker race on a renamed response field, `HANDOFF.md` §
"Deploying a change to the response shape" has the rule.
