---
title: Study
summary: >-
  Flashcards built from facts rather than hand-written cards, playable at
  [hadoku.me/study](https://hadoku.me/study) by anyone, with creating and
  publishing a set reserved for friend tier and up.
features:
  - name: The drill
    summary: 'Flip, swipe to grade, honor system — fast enough to play one-handed on a phone.'
    anchor: the-drill
  - name: The board
    summary: "A Jeopardy-style grid dealt from a set's own questions, ranked by how hard each one has turned out to be."
    anchor: the-board
  - name: A set is a file
    summary: 'Export, edit anywhere, re-import — the same JSON a PUT accepts.'
    anchor: a-set-is-a-file
  - name: Handing a set to an agent
    summary: 'Copy JSON with a brief attached, get a set back, and a linter catches what the API would silently accept anyway.'
    anchor: handing-a-set-to-an-agent
  - name: Ratings that drift
    summary: "No player rating, only a question's: it gets harder when people nail it, easier when they miss it."
    anchor: ratings-that-drift
  - name: Publishing and ownership
    summary: 'A set is private until published; creating or editing one needs an account.'
    tier: friend
    anchor: publishing-and-ownership
  - name: /wisdom
    summary: "A second, fully static route on the same bundle: one hand-picked passage at a time from the world's ethical traditions."
    anchor: wisdom
trivia:
  - "The whole app began as a scaffold copied from the platform's own app template, in one 7,166-line commit (`78ba692`, 2026-08-17)."
  - 'A card used to be one row holding both a fact and the question asked of it; splitting them into separate facts and questions, so a rating could belong to one slot rather than a whole card, was itself a 2,593-insertion, 945-deletion rewrite six days later (`86c7a9c`, 2026-08-23).'
  - 'The drifting-difficulty formula swaps elo''s usual opponent for "the field": a question''s rating moves against the mean of every other question in the set, not against a player (`cd16ad6`).'
  - 'Its longest commit subject is a warning about its own alerting: "ci: continue-on-error on alert-close tidy-up so it can''t page @here over a green update (P6.7)" (`9d02e21`).'
---

# Study

Study turns a set of facts into flashcards, without ever storing a
front/back pair: a fact is one true thing, stored once as named slots, and
each **question** is a declaration of which slot is the answer and which
others are shown beside it. The same fact can be asked a dozen different
ways without repeating any of its data — one set of 22 facts asks 62
different questions.

![Study's home screen, signed out: one published set, "Reformation Jeopardy," listed under Published](images/home.webp)

Play a set as [the drill](features.md#the-drill), a plain pass through the
queue, or, once enough of its facts are tagged for it, as
[the board](features.md#the-board), a points grid. Every answer moves that
question's own difficulty rating, which is what decides where it lands on
the board and how often it resurfaces in the drill — there is deliberately
no rating of the player.

- [Features](features.md): what each mode does, and who may use it.
- [Contributing](contributing.md): running it locally, the architecture, the
  checks it must pass.
- [History](history.md): the rewrite that split a card into a fact and a
  question, and the route that grew on the same bundle.
- [Trivia](trivia.md)

## Trivia

The app's first commit is also its biggest: a 7,166-line scaffold copied
from the platform's own template
([history](history.md#a-scaffold-then-a-rewrite-august-2026)).
