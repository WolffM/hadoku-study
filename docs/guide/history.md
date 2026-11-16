# Study: history

## A scaffold, then a rewrite (August 2026)

The repo's first commit (`78ba692`, 2026-08-17) scaffolded the app from
the platform's standard micro-frontend template, and was also its biggest
commit at the time: 7,166 lines. The next day it became an actual
flashcard app: sets, publishing and the drill loop (`50bf0fb`,
2026-08-18). Over the following days it gained a portable file format
with an OpenAPI spec (`66da0f6`, 2026-08-19), and a second way to play a
set, the points board (`bfcedcb`, 2026-08-20).

Three days after that, in a 32-minute span on 2026-08-23, the data model
itself was rebuilt. A **fact** (one true thing, stored once as named
slots) replaced the original card, which had fused a fact and the question
asked of it into one row (`86c7a9c`, 20:04). A difficulty rating that
drifts from how a question is actually answered followed at 20:26
(`cd16ad6`). The one-file import/export path, plus the agent-facing brief
and linter, landed at 20:36 (`88693de`). Splitting fact from question is
what let a rating belong to a single slot — "the year" can be harder to
recall than "the place" — rather than to a whole card.

## The ownership incident (August 2026)

On 2026-08-25, handing a set to another user accepted a raw `userId` in
the request body and stored it unlooked-up, on the reasoning that a userId
is not a credential and so storing one is safe. It was given a display
name rather than an id, and the set went unowned for two days
because nothing had resolved the value against the registry. The fix,
two days later (`68d9cb7`, 2026-08-27), changed the endpoint to take a
display **name**, resolve it against the key registry, and store the
userId that lookup returns. The input schema was made strict specifically
so that an old client sending the previous `userId` field is rejected
outright, rather than silently falling through to self-claim the set.

## /wisdom (November 2026)

Nearly three months after launch, the same bundle grew a second, unrelated
route: a map of the world's ethical traditions with one hand-picked
passage shown at a time (`5472787`, "feat(wisdom): /wisdom — a map of the
world's ethical traditions", 2026-11-10). Research dossiers for all 31
traditions on the map landed the same day (`e7611f7`) — the reading list
the passages are chosen from, not the passages themselves. It shares this
app's bundle and build but calls no API: everything it shows is a static,
hand-picked pool.

## Trivia

The rewrite that split a fact from its question, the difficulty formula,
and the file-and-agent tooling were not three separate efforts — all three
landed within thirty-two minutes of each other on the same evening
(`86c7a9c`, `cd16ad6`, `88693de`, all 2026-08-23) — more in
[trivia.md](trivia.md).
