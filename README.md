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

| Path      | What                                                            |
| --------- | --------------------------------------------------------------- |
| `src/`    | the micro-frontend (`@wolffm/study`)                            |
| `worker/` | the API (`@wolffm/study-worker`), running on D1 at `/study/api` |

The host worker and the D1 migrations live in the parent repo, under
`../hadoku_site/workers/study-api/`.

## Development

```bash
pnpm install
pnpm dev      # vite dev server against index.html
pnpm check    # lint + stylelint + typecheck + build, UI AND worker
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
