# Wisdom research

The study behind [hadoku.me/wisdom](https://hadoku.me/wisdom). Three workstreams,
and this directory is the middle one:

1. **The page** — `src/wisdom/` (the map, the card) and `src/styles/wisdom.css`.
2. **Research** — `research/traditions/<id>.md`, one dossier per tradition: what
   it teaches, its primary texts and which translations are public domain,
   verified candidate passages, and the bridges it makes to other traditions.
3. **Reading and choosing** — moving a passage from a dossier into
   `src/wisdom/pool.ts` once it has been read in context and judged worth
   showing. Only this step changes what the site displays.

## The pipeline

```
traditions.ts         the map: every tradition, studied or not (31 stars)
research/traditions/  candidates, with sources — the reading list
src/wisdom/pool.ts    what /wisdom shows — chosen by hand, nothing else
```

A tradition's star lights up the moment its first passage lands in `pool.ts`.
There is no other switch.

## Choosing a passage

1. Read it **in context** — the chapter, not just the excerpt. The dossiers link
   the page each passage was copied from.
2. Copy the text **verbatim** from the named translation. Prefer public domain
   (the page is public); each dossier lists the copyright status of its
   translations.
3. Add an entry to `POOL` in `src/wisdom/pool.ts`:
   ```ts
   {
     id: 'dhammapada-5',          // stable — shared links use it; never rename
     tradition: 'buddhism',       // an id from traditions.ts
     source: 'Dhammapada 1.5',
     translation: 'F. Max Müller (1881)',
     text: 'For hatred does not cease by hatred at any time: hatred ceases by love…',
     note: 'Optional: my own reflection, shown under the passage.',
     bridges: ['john-3-19']       // other pool ids it speaks to
   }
   ```
   Separate verses or paragraphs with a blank line (`\n\n`).
4. Change the dossier's frontmatter `status` as you go: `researched` →
   `reading` → `curated`.
5. Push to `main`. `pnpm test` checks that the tradition exists, ids are unique,
   and every bridge points at a real entry.

## Dossier rules

- Every candidate passage is copied from a page that was actually fetched, with
  its URL. Anything from memory is fenced under **Unverified**.
- Each dossier has a **Beware** list of famous misattributions (fake Buddha,
  fake Rumi, the "Chief Seattle" speech) — check new finds against it.
- For living Indigenous traditions, prefer proverbs and publicly shared
  teachings over ceremonial material; each such dossier notes its protocol
  concerns.
