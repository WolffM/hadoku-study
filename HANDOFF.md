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

Almost all of the work is in the loop feeling fast on a phone, and the
following are load-bearing, not decoration:

- **The whole set is prefetched on entry.** `GET /study/api/sets/:id` returns
  every fact, already expanded into every question it can be asked as, so
  nothing touches the network between flips.
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
- Results record the **first** outcome per question, so "23 of 40 on the first
  try" means something.

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

## A fact is the unit of storage, not a question

A v1 card fused two things a study set actually has: **the thing that is true**,
and **the question you ask about it**. One row was both — which is why a set
could not ask "who met Charles V at Worms in 1521?" and "in what year did
Luther meet Charles V at Worms?" without storing Worms and 1521 twice, and why
there was nowhere to hang a rating that meant anything: a rating on a
front/back pair cannot say that the year is harder to recall than the place.

0003 splits them.

- **`facts.slots`** is a JSON object of named values — what is true.
  `{"who": "...", "what": "...", "where": "Worms", "when": "1521"}`.
- **`facts.questions`** is a JSON array of declarations: which slot is the
  ANSWER (`ask`), which are shown (`given`, defaulting to all the others), and
  how it reads (`prompt`).
- **A variant** is one resolved question. `factId:variantKey` is its id.
- **Front and back are a RENDER**, not a shape anything is stored in.

Two consequences that pay for the whole change: dropping givens is a difficulty
ladder nobody has to declare (`when<what,where,who>` and `when<where>` are
different keys and rate independently), and "never ask two questions about the
same fact on one board" stops being a rule anyone enforces — it is one claim
per fact, in one line.

### Variants are derived in the worker, on read, and nowhere else

There is no variants table and no shared client copy of the expansion. A
variant's key is what ratings hang off, and a key computed in two places is a
key that eventually disagrees with itself — silently, no error, splitting one
question's history into two rows that never converge. `expandFact` in
`worker/src/variants.ts` is the only implementation; the client renders what
the API hands it and builds no keys of its own.

The response carries **both** `questions` (as authored) and `variants` (as
resolved). Only the first is content. Exporting from `variants` alone would
bake this build's fallback phrasings in as though a person had written them, so
every round trip would quietly freeze a template into the set.

`expandFact` is deliberately tolerant: a declaration whose `ask` slot was
renamed is skipped, and a `given` naming a missing slot just loses that entry.
A fact rendering fewer questions beats one rendering none.

### A fact keeps its id across a save, or its ratings die

Saving replaces a set's facts **wholesale** — one DELETE, then INSERTs. In v1
that was free, because nothing outside the set referred to a card by id. It is
not free now: ratings and attempts hang off `fact_id`, so re-minting ids on
every save would discard a set's entire play history each time its owner fixed
a typo. Not wrong — **gone**, with no error anywhere.

So an exported file carries each fact's `id`, and `resolveFactIds` hands it
back when it already belongs to that set. An id from another set is refused
(otherwise a hand-edited file could adopt someone else's history) and a
duplicate within one payload is re-minted. `sets.factIds.test.ts` is the only
thing standing between "fixed a typo" and "lost a month of data".

Slot names are restricted to `[A-Za-z0-9_-]` for the same family of reason: a
key is `ask<given,given>`, so a slot name containing a comma or an angle
bracket would produce a key that reads back as a different question.

### The editor holds one row model and draws it two ways

A row always holds a whole `FactInput`. A two-slot flashcard gets a pair of
text inputs, because a deck of two hundred of them would be miserable any other
way; anything richer, or anything the author expands, gets `FactEditor` with
slots and questions visible. **The split is presentation, never storage** — an
earlier version kept two row SHAPES and passed rich facts through untouched,
which was safe but meant the editor could show you a fact it could not let you
change. A fact two inputs cannot hold is always expanded regardless of the
toggle, so the toggle can never hide something it cannot show.

## Difficulty drifts, and there is no player rating

Every question carries a rating in two scopes, and both move on every answer.

**There is no player rating**, deliberately. What we want to learn is how hard
a QUESTION is, not how good you are. So elo's opponent is swapped: the
adversary is **the field** — the mean rating of the set — and a question "wins"
the match when you miss it. That gives cards ranked against each other while
keeping the property that makes elo self-correcting.

```
E  = 1 / (1 + 10 ** ((poolMean - R) / 400))   // chance this card beats the field
S  = missed ? 1 : 0
K  = 40 / (1 + plays / 8)                     // 40 when new, ~12 by 20 plays
M  = min(3, 1 + 0.5 * (run - 1))              // consecutive identical outcomes

R' = clamp(round(R + K * M * (S - E)), 600, 1800)
```

Three knobs, each earning its place. **K** is confidence — twenty plays of
evidence are not overturned by one. **M** is the streak, and it counts the
attempt that extends it (scoring at the previous run length would lag by one,
so a two-attempt streak would never get a multiplier at all). **E** is the
field: missing a question already rated brutal confirms what we knew and moves
almost nothing, while _nailing_ it is a genuine surprise and drops it hard.

`rating.ts` is pure and its six worked examples are pinned in `rating.test.ts`.
Three of the numbers in the original plan were wrong when written by hand,
which is why they are computed rather than asserted from memory.

### Global seeds; local takes over, per question

- **Global** starts at the question's `seedTier` (tiers 1–5 map to 1000–1400)
  and moves on every signed-in reader's answer.
- **Local** starts at whatever **global** says the first time YOU attempt that
  question, and after that nothing overwrites it.

Per QUESTION, not per set, and that is better than the original plan's
"copy everything on first engagement": a question you have never seen still
starts from whatever global has since learned about it, instead of being frozen
at what global said the day you first opened the set.

**Nothing is materialised.** A question with no rating row is not missing a
value — it sits at a real estimate, computed on read. That is what lets a set
be played without first writing a row for every question in it, and it is why
`GET /sets/{id}/ratings` performs no writes.

The pool mean is computed **per scope**: local ratings are measured against
your field, global against everyone's. Measuring a local rating against the
global mean would drag all of your ratings toward a population you are not part
of, which is the opposite of what a personal rating is for. It is also held
FIXED across a batch, so an answer's effect does not depend on the order the
others happened to arrive in.

### A board is dealt from the content, not tagged into existence

**A column is an asked SLOT.** "Name that year" is every question whose answer
is a `when`; "Who was it?" is every `who`. Nothing is tagged for the board and
there is no per-fact category — the `attrs.board` namespace that used to hold
one was removed once nothing read it, because a schema describing a field with
no reader is how a dead feature keeps looking alive.

**A row is a RANK**, decided by ordering a column's questions against each
other at deal time. `seedTier` seeds a rating and is never read again once a
question has one. That is the whole reason a board responds to play: a question
you have started getting right slides down the board on its own.

Two consequences:

- **A board is DEALT once and never re-sorted.** Ratings are fetched on entry,
  held for the session, and deliberately not refreshed from the answers being
  recorded. Re-ranking mid-game would slide tiles out from under a thumb
  already moving toward one, and the point of a rating is where it puts a
  question _next_ time.
- **Rows shrink before columns.** Four angles of attack matter more than a full
  ladder, so a thin set renders 4×2 rather than 2×5.

### Why the fill is a matching and not a greedy pass

**One fact may be asked only once per board.** Under the old per-fact
categories that was free — every question about a fact shared a column, so it
could only appear once anyway. Asking by slot scatters one fact's questions
across four columns, and "where did Luther meet Charles V" now genuinely can
collide with "who did Luther meet at Worms".

That makes filling the grid an assignment problem: a fact taken by one column
is unavailable to every other, so picking each column's best independently can
strand a column whose few options have all been claimed. The classic fix is
backtracking with a retry budget. `generate.ts` uses **maximum bipartite
matching** (Kuhn's) instead — shorter, always finds a full board when one
exists, and has no budget to tune. Cells state a _preference_ (the question
they would ideally hold, spread across the column's range) and the matching
honours it where it can.

`model.test.ts` pins the case that separates the two: two columns, two rows,
one fact that could fill either. A greedy pass lets the first column take both
of its options and strands the second; matching makes it give one back.

**At least one column is explain-it**, when the set has one. A board of names
and years is a quiz you can win without understanding anything. The guarantee
displaces the _weakest_ otherwise-chosen column, so it costs as little coverage
as possible.

A set of plain flashcards yields **no** columns and is not offered as a board:
its only slots are `prompt` and `answer`, and a column headed "Answer" is the
whole deck with a number on it.

### Every answer reaches the ledger, or waits for one that does

`recordAttempt` in `src/state/attempts.ts` is the single path both games call.
A mode that forgot to record would look completely healthy — it plays, it
grades, it just teaches the system nothing — so a new game gets recording by
construction rather than by remembering.

A failed POST is queued in localStorage and flushed on the **same request** as
the next answer, oldest first, so a streak that spans an offline patch is still
a streak. The queue is cleared _before_ the send precisely so a failure
re-queues the batch once rather than duplicating the held copies. It never
throws: the caller is a grade handler mid-game.

**Signed-out readers write nothing.** No identity means no row to attribute an
attempt to and no way to tell one anonymous reader from a thousand, so letting
them move global ratings would be letting an unbounded, unattributable
population vote. Their board still ranks — by `seedTier`, which is exactly how
it ranked before ratings existed.

## Handing a set to an agent, and checking what comes back

**Copy JSON** puts the file on the clipboard behind a brief
(`src/agentBrief.ts`). Every rule in that brief exists because leaving it out
produced a specific kind of bad output — and most were learned by making the
mistake here, with full knowledge of the model.

**The API cannot catch a bad set, only a malformed one.** A question whose
prompt contains its own answer parses, imports and plays; it is just worthless.
So `src/model/lint.ts` runs over whatever comes back, in the editor, before it
is saved. Every check in it is a mistake that actually happened while building
the Reformation set:

- **The prompt gives away its answer.** Measured as a ratio, not a substring,
  because the leak that happens is a paraphrase: _"What happened to Hus at
  Constance, despite a promise of safe conduct?"_ answered by _"burned at
  Constance despite a promise of safe conduct"_. No exact match, no question
  left. The threshold sits at 50%: the two real leaks scored 86% and 57%, the
  worst innocent one 29%.
- **The prompt already said what its `given` shows**, so the same sentence
  prints twice — once large as the question, once small as context. This one
  reached production.
- **A declaration asks a slot the fact does not have.** The server skips it, so
  a question you wrote simply never appears. No error, one fewer question.
- Two declarations resolving to the same question; a fact with fewer than two
  filled slots; an unphraseable slot with no prompt.

It is pure and client-side, and it can be, because none of it needs a variant
key: an answer is `slots[ask]` and the context is `given ?? every other slot`,
both of which are in the file.

`boardAdvice` is deliberately separate from the findings — a set can be
perfectly good and simply not be a board.

## Where a reader actually sees a rating

**Once, at the end of a sitting**, and once on the set page. Everywhere else a
rating is invisible machinery deciding what you get asked — putting a number on
a board tile would turn a quiz into a dashboard.

`POST /attempts` returns a `RatingChange` (a `Rating` plus `globalDelta` and
`localDelta`) where `GET /ratings` returns a plain `Rating`. Two schemas rather
than one with an always-zero delta on reads, which would be a field every
caller has to know not to trust. The deltas are ACCUMULATED across a request,
because a flushed outbox can name the same question twice and a recap showing
only the last move would understate it.

### The recap keeps the FIRST outcome and the LATEST rating

`state/session.ts` is pure, and both rules in it exist because the obvious
version is wrong:

- The drill **re-queues a missed question until you get it**, so the last
  outcome of every question in a completed pass is "got". A recap built from
  the last outcome would report a clean sweep of every pass you fought through.
- A question missed twice and then got has **moved three times**; the honest
  report is where it ended up and how far it travelled, so the delta
  accumulates and the rating is the latest.

A movement is recorded even when nothing reached the server — signed out, or
offline. The recap's job is to say what you got wrong, which is true either
way; it just stays quiet about ratings that did not move.

### The standing panel answers two questions from one dataset

**Hardest for you** is your highest local ratings among questions you have
actually answered. That is what a local rating IS, distilled — re-deriving it
from the attempt ledger would be computing an answer the rating already holds.

**Not where you put them** is for the owner: questions whose GLOBAL rating has
drifted more than `DRIFT_THRESHOLD` from the tier the author chose. The one
number an author can act on — not the rating, which means nothing alone, but
the disagreement. The threshold exists because ratings wander by a few points
constantly, and reporting that as news trains people to ignore the panel.

It renders nothing until something has been played. An empty panel promising
insight later is worse than no panel.

**The editor deliberately shows no ratings.** It was planned and dropped: the
editor holds question DECLARATIONS, and mapping one to its rating means
deriving a variant key, which is server-only by design. The standing panel
reads resolved variants instead, which already carry both the key and the seed
tier — so the same information arrives without a second key implementation.

## Ownership can be GIVEN, never taken

`owner_user_id` is written on create and moved by exactly one route:
`POST /sets/{id}/owner`. The asymmetry is the whole design.

- **The current owner** may hand a set to any userId.
- **An admin** may move any set — the escape hatch for one assigned to a userId
  nobody holds a key for, which is otherwise unreachable through the API.
- **Anyone else** gets the same 404 a non-existent set gets, so probing ids
  tells you nothing. There is no claim, no adopt, no takeover.

A **userId is not a credential.** It is the registry's stable per-user UUID
(`crypto.randomUUID()` in edge-router's registry), and knowing one grants
nothing at all. That is why naming a recipient by userId is safe to accept,
safe to log and safe to publish in the spec — the security lives in the owner
check, not in the id being secret. Anyone reasoning about this endpoint should
start there, because the instinct is to treat the id as sensitive and then
build the wrong protections around it.

The platform already settled this. `GET /session/keys/by-repo` hands out
`userId` + name + tier at **service** tier, deliberately not admin, with the
reasoning spelled out in `key-admin.ts`: the response carries "nothing
bearer-shaped", so service is the right ceiling. Two ways to find one:

- `GET /session/whoami` with your own key — your own id.
- `GET /session/keys/by-repo?repo=owner/name` — the identities behind a repo.
  Admin's `GET /session/admin/keys` is the whole inventory.

The UUID SHAPE is validated for a different reason: a typo strands the set with
an owner nobody can authenticate as. Admin can rescue it; better not to need
rescuing.

**Nothing else moves with ownership.** Facts keep their ids, and ratings,
attempts and saved progress are all keyed on the READER — so transferring a set
neither carries anyone's history to the new owner nor takes it from the old
one. `loadSetById` is the only loader in `db.ts` that ignores who is asking; it
is admin-only and kept as its own function rather than a flag on
`loadSetForWrite`, because a boolean that turns an access check off is a
boolean somebody eventually passes by accident.

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

## Authoring: one output, many inputs

**Writing a file lives on the server.** `GET /sets/{id}/file` is the only
implementation, and the editor's Export button fetches it rather than
serializing the set it already holds in memory. A client copy would eventually
disagree with the server's, and the symptom would be a UI export that behaves
differently from a scripted one for reasons nobody could see.

It is the one route in this worker that answers **unwrapped**. Everything else
uses `{success, data}`, and that is still right — but a document a person
copies should not arrive inside an envelope they have to unwrap first.

**Reading stays on the client**, because it is genuinely different work.
`parseImport` takes a server file, a raw API response, a bare array, a
spreadsheet paste, or a v1 export from before facts existed. Tolerant in,
canonical out.

### The brief that rides with the JSON

The JSON alone is not a brief. `src/agentBrief.ts` is the paragraph that goes
with it, and every line of it exists because leaving it out produces a specific
kind of bad output: an agent that guesses at the slot vocabulary, invents its
own phrasing conventions, or — the expensive one — **drops the fact ids**,
which silently discards every rating the set has earned.

### The editor holds one row model and draws it two ways

A row always holds a whole `FactInput`. A two-slot flashcard gets the pair of
text inputs, because a deck of two hundred of them would be miserable any other
way; anything richer, or anything the author expands, gets `FactEditor` with
slots and questions visible. **The split is presentation, never storage** — an
earlier version kept two row SHAPES and passed rich facts through untouched,
which was safe but meant the editor could show you a fact it could not let you
change. A fact two inputs cannot hold is always expanded regardless of the
toggle, so the toggle can never hide something it cannot show.

Two edits in `model/factEdits.ts` are quietly destructive if they get it wrong,
and both are tested for it:

- **Renaming a slot** has to carry through every declaration that names it, or
  the question stops resolving and disappears from the set — no error, one
  fewer question.
- **Removing a slot** has to take the questions that asked it, or the set
  carries declarations that render nothing.

`model/slots.ts` mirrors the worker's `KNOWN_SLOTS`, and that duplication is
deliberate where the variant-key duplication was not. Drift here is cheap and
visible: a placeholder says "optional" for a slot the server cannot phrase, and
the author writes a prompt they did not strictly need. Nothing is stored wrong.
Compare `variantKey`, which is server-only precisely because a disagreement
there splits a question's history in two with no symptom at all.

## Games, and the room left for more of them

A set is played by a **game**. The drill and the board are both games, and
neither is special-cased anywhere: `src/games/registry.ts` lists them, and the
set page walks that list, asks each one whether this set can be played, and
renders a button for the ones that say yes. Adding a mode is a directory under
`src/games/` and one registry entry — no edits to the set page, the router, or
the API schema.

A game's `id` is three things at once, deliberately: its key in a card's
`attrs` bag, its value in the `?play=` URL param, and its identity in the
registry. One name means there is nowhere for the three to drift apart.

### Facts carry a bag, not a column per game

`facts` has two columns for this, doing different jobs:

- **`detail`** is a real column because it is CROSS-CUTTING — an explanation
  after the answer is wanted by the drill, the board, and every quiz mode
  sketched so far. A field every mode uses belongs in the schema, typed and in
  the spec, not buried in a bag.
- **`attrs`** is a JSON object NAMESPACED BY GAME: `{"board": {"category":
"Places"}}`. A new game adds a key rather than a column.

The namespace is the point. Two games that both want `category` would collide
in a flat bag, and resolving that later is exactly the migration this column
exists to avoid.

`difficulty` used to live in the board namespace and **moved out** in 0003, to
the question's `seedTier`. The line is worth learning: a tier seeds a RATING,
and ratings belong to every mode, so it was never board-specific. A column
label genuinely is. When something in a game's namespace turns out to be wanted
by every game, it belongs in the schema — and `BoardAttrsSchema` is `strict`
precisely so a file still carrying the old `difficulty` fails loudly instead of
importing cleanly with every board tier silently gone.

Known namespaces are still **fully typed** in zod and published in the spec, so
an agent generating a board reads a real schema rather than an opaque object.
Unknown namespaces **round-trip untouched** — through the API, the file format,
and the editor — so a game can be prototyped entirely in the client before the
server knows it exists. Three consequences worth keeping:

- The editor preserves other games' namespaces when it saves. Editing a fact in
  one mode must not quietly delete another mode's data.
- Each game reads its own namespace through its own reader and validates as it
  goes, because the bag passes anything through: a `board` key may be any shape
  at all by the time it reaches the client. A question that cannot be read is
  simply not a clue, and must never take the board down.
- `attrs` is size-capped in the schema (`MAX_ATTRS_LENGTH`). Passing unknown
  keys through unvalidated is what makes a cap necessary — without one the
  column is an unbounded blob store any friend-tier caller can fill.

### Playability is derived, never stored

A set whose facts carry `attrs.board` can be played as a board; one whose facts
do not is a plain deck. There is no `mode` column on `sets`, because that would
be a second answer to a question the content already answers, free to drift out
of step with it. A deck that gets tagged later starts qualifying on its own,
with no migration and no flag to keep in sync.

The asymmetry runs one way and is deliberate: **every board is already a deck**,
because a clue is a question with an answer. A deck becomes a board only once
someone has done the authoring. Half-tagged sets are therefore a normal
in-between state — untagged questions stay in the deck, sit off the grid, and
the editor reports what is still missing rather than enforcing a silent
threshold.

### The board is built phone-first

Not a polish pass. Measured on a 390x844 viewport: 25 tiles at 73x48 (past the
44px tap minimum), the whole board inside 341px, no sideways scroll.

- **A tile shows only its points.** That is what a real board does and what lets
  25 targets fit a phone; the category names carry the meaning once, along the
  top.
- **The clue opens as a full-screen sheet**, not an inline panel, which on a
  phone would put the answer below the fold.
- **Actions are pinned to the bottom of the sheet**, so revealing the answer
  grows the content ABOVE them and the buttons never move under a thumb already
  travelling toward them. Same rule as the flip card, same reason.

## Who logs what

edge-router already writes one telemetry row per request — method, path,
status, duration, backend, caller tier, masked key, geo — and since 2026-08-21
that covers successful `/<app>/api/` calls too, matched by path SHAPE rather
than the hand-maintained allowlist that had silently excluded fourteen apps
including this one. Query it at `/health/api/logs/query?path=/study/api`.

So this app logs only what the edge CANNOT see, and duplicating the edge's row
is waste:

- **The worker** (`worker/src/telemetry.ts`) logs failure CAUSES — the edge
  sees `500`, not the D1 error that names the problem — and business events
  (`set.created`, `set.replaced`, …) carrying a deck summary of counts, never
  content.
- **The UI** logs the API failure paths, which previously vanished entirely,
  plus `study.board.completed` — the one action no HTTP log can ever observe,
  because the game runs client-side once the set is fetched.

Use the logger's own helpers (`component`, `apiRequest`, `apiResponse`,
`preference`), not hand-rolled `info('[study] …')` strings: the helpers stamp
the event type the telemetry schema expects. Note `apiResponse` escalates every
non-2xx to ERROR, which is wrong for the 404 a private set is SUPPOSED to
return — it is called on the success path only.

Browser logs still reach the console alone: nothing calls
`configureLogger({ telemetrySink })`, and wiring one needs a browser-writable
ingest that monitoring-api deliberately does not offer (its only friend-tier
write is the game beacon, scope-limited on purpose). Open decision, not an
oversight.

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
  background, no `var(--color-x, #fallback)`. `pnpm run lint:css`. And never an
  ACCENT as text on a plain surface (`color: var(--color-primary)` on a card or
  the page) — it lands unvalidated and misses AA in most themes. Pair a filled
  surface `bg-<f>` with `text-on-<f>`, a tint `bg-<f>-bg` with `text-on-<f>-bg`.
  Both mistakes shipped on the board and set page on 2026-08-21.
- **D1 binds at most 100 parameters per statement**, NOT SQLite's 999. The
  difference is invisible until a set crosses the line and every write of it
  500s. `INSERT_CHUNK` in `routes/sets.ts` therefore DERIVES from
  `D1_MAX_BOUND_PARAMS / CARD_COLUMNS`, and `sets.chunking.test.ts` pins the
  arithmetic — the original constant claimed 999, chunked at 50 rows, and broke
  every set over 20 cards from launch until the first 25-clue board found it.
  Adding a column silently lowers the ceiling, so do not hand-pick this number.
- **No `.env` files.** Local dev secrets go through `.devvault.json`.
- **CI must not say `runs-on: ubuntu-latest`.** Use
  `${{ fromJSON(vars.CI_RUNNER || '["self-hosted","hadoku-builder"]') }}`.
- **This repo is PUBLIC.** Any job triggered by `pull_request` that lands on a
  self-hosted runner must carry an `author_association` guard — see `ci.yml`,
  which picks a different runner rather than skipping, because a skipped
  required check never reports and leaves the PR unmergeable forever.
- **The CI job is named `check`** because that is this repo's required status
  context in `../hadoku_site/scripts/admin/repo-policy-manifest.json`.

## Deploying a change to the response shape

One commit in hadoku_site carries both halves of a study release: the lockfile
bump that rebuilds the UI bundle, and the `workers/study-api/package.json` bump
that triggers the worker deploy. They run **in parallel**, so for a minute or
two the new UI is served against the old worker, or the reverse.

That is free for a change that only ADDS fields. It is not free for one that
renames them — v2 phase 1 renamed `cards` to `facts`, and during that window a
page load would have found `set.facts` undefined. Nobody was looking at 03:00,
so it cost nothing, but the window is structural and will be there next time.

If you rename or remove a response field again, either read it tolerantly on
the client for one release (`set.facts ?? []`), or ship the additive half
first and the removal a release later.

**Migrations are applied by CI, before the deploy.** study-api joined the
`apply_migrations` list in `deploy-workers.yml` when 0003 landed; it was the
last D1-backed worker doing it by hand, and the hand step is exactly what makes
the ordering go wrong. The workflow lists pending migrations, asserts
`d1_migrations` has at least its baseline of rows (so a reset tracking table
aborts loudly instead of replaying history), applies, and only then deploys.
Bump `min_applied_migrations` when you add one.

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
