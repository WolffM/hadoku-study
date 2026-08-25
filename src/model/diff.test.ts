/**
 * A PUT replaces a set's content wholesale, so "here is the new version" and
 * "delete eleven facts" look identical on the wire. These tests are about the
 * one case that is invisible in the JSON and expensive in production: a fact
 * returned intact but stripped of its id, which is a delete and a re-insert
 * wearing an edit's clothes.
 */

import { describe, expect, it } from 'vitest'
import type { FactInput } from '../api/types'
import { ORPHAN_THRESHOLD, diffSet, questionCount, similarity } from './diff'
import { asks, authored, flashcard } from '../testing/fixtures'

const current = (facts: Parameters<typeof diffSet>[0]['facts']) => ({
  title: 'The Reformation',
  description: 'Luther to Augsburg',
  facts
})

const asInput = (fact: { id: string; slots: Record<string, string> }): FactInput => ({
  id: fact.id,
  slots: { ...fact.slots },
  questions: [{ ask: Object.keys(fact.slots)[1], prompt: 'q' }]
})

describe('an upload that changes nothing', () => {
  it('says so', () => {
    const set = current([asks('a', 'when'), asks('b', 'who')])
    const same = set.facts.map(f => ({
      id: f.id,
      slots: f.slots,
      questions: f.questions ?? undefined,
      detail: f.detail,
      attrs: f.attrs
    }))
    const diff = diffSet(set, { title: set.title, description: set.description, facts: same })
    expect(diff.empty).toBe(true)
    expect(diff.counts).toEqual({ unchanged: 2, changed: 0, added: 0, removed: 0 })
  })
})

describe('a fact that lost its id', () => {
  it('is reported as an orphan, not as new content', () => {
    // The expensive mistake: identical words, no id. On the wire it is a
    // delete and an insert, and every rating the question earned is gone.
    const before = asks('worms', 'when')
    const set = current([before])
    const stripped: FactInput = { slots: { ...before.slots }, questions: [{ ask: 'when' }] }

    const diff = diffSet(set, { facts: [stripped] })
    expect(diff.orphaned).toBe(1)
    const added = diff.facts.find(c => c.kind === 'added')
    expect(added?.kind === 'added' && added.orphanOf?.id).toBe('worms')
    // And the original still shows as leaving, because it is.
    expect(diff.counts.removed).toBe(1)
  })

  it('is still caught when the slots were renamed around it', () => {
    // Compared by VALUE, so a rename cannot hide the loss.
    const before = asks('worms', 'when')
    const renamed: FactInput = {
      slots: { setting: before.slots.context, year: before.slots.when },
      questions: [{ ask: 'year', prompt: 'q' }]
    }
    expect(diffSet(current([before]), { facts: [renamed] }).orphaned).toBe(1)
  })

  it('does not cry orphan over two facts that merely share a detail', () => {
    // Two facts about Worms share a where and a when without being one fact.
    const before = { ...asks('a', 'when'), slots: { where: 'Worms', when: '1521', who: 'Luther' } }
    const genuinelyNew: FactInput = {
      slots: { where: 'Worms', what: 'the Edict outlawed him', why: 'the empire followed Rome' },
      questions: [{ ask: 'what', prompt: 'q' }]
    }
    const diff = diffSet(current([before]), { facts: [asInput(before), genuinelyNew] })
    expect(diff.orphaned).toBe(0)
    expect(diff.counts.added).toBe(1)
  })

  it('never claims one removed fact as the source of two arrivals', () => {
    const before = asks('a', 'when')
    const twin: FactInput = { slots: { ...before.slots }, questions: [{ ask: 'when' }] }
    const diff = diffSet(current([before]), { facts: [twin, { ...twin }] })
    expect(diff.orphaned).toBe(1)
    expect(diff.counts.added).toBe(2)
  })

  it('scores an intact copy at 1 and unrelated content at 0', () => {
    expect(similarity({ a: 'Worms', b: '1521' }, { x: 'worms', y: ' 1521 ' })).toBe(1)
    expect(similarity({ a: 'Worms' }, { a: 'Constance' })).toBe(0)
    expect(ORPHAN_THRESHOLD).toBeGreaterThan(0.5)
  })
})

describe('a fact that genuinely changed', () => {
  it('names what moved inside it', () => {
    const before = authored('a')
    const after: FactInput = {
      id: 'a',
      slots: { ...before.slots, why: 'it split the church', what: 'reworded' },
      questions: [{ ask: 'when' }, { ask: 'where' }, { ask: 'why' }],
      detail: 'new detail'
    }
    const diff = diffSet(current([before]), { facts: [after] })
    const changed = diff.facts.find(c => c.kind === 'changed')
    expect(changed?.kind).toBe('changed')
    const notes = changed?.kind === 'changed' ? changed.notes.join(' | ') : ''
    expect(notes).toContain('slots added: why')
    expect(notes).toContain('slots edited: what')
    expect(notes).toContain('asked 2 ways → 3')
    expect(notes).toContain('detail changed')
  })

  it('notices a reword that leaves the count alone', () => {
    const before = asks('a', 'when')
    const after: FactInput = {
      id: 'a',
      slots: { ...before.slots },
      questions: [{ ask: 'when', prompt: 'a much better question' }]
    }
    const changed = diffSet(current([before]), { facts: [after] }).facts[0]
    expect(changed.kind === 'changed' && changed.notes).toContain('questions reworded')
  })

  it('notices a slot being dropped', () => {
    const before = authored('a')
    const after: FactInput = { id: 'a', slots: { who: before.slots.who, what: before.slots.what } }
    const changed = diffSet(current([before]), { facts: [after] }).facts[0]
    expect(changed.kind === 'changed' && changed.notes.join(' ')).toContain('slots removed')
  })
})

describe('the shape of the whole upload', () => {
  it('counts questions on both sides, so a shrink is visible', () => {
    const set = current([authored('a'), authored('b')])
    const diff = diffSet(set, { facts: [{ id: 'a', slots: { x: '1', y: '2' } }] })
    expect(diff.questionsBefore).toBe(4)
    expect(diff.questionsAfter).toBe(2)
    expect(diff.counts.removed).toBe(1)
  })

  it('reports metadata changes separately from content', () => {
    const set = current([asks('a', 'when')])
    const diff = diffSet(set, {
      title: 'Renamed',
      description: null,
      facts: [asInput(asks('a', 'when'))]
    })
    expect(diff.title).toEqual({ before: 'The Reformation', after: 'Renamed' })
    expect(diff.description).toEqual({ before: 'Luther to Augsburg', after: null })
    expect(diff.empty).toBe(false)
  })

  it('leaves metadata alone when the file does not mention it', () => {
    const set = current([asks('a', 'when')])
    const diff = diffSet(set, { facts: [asInput(asks('a', 'when'))] })
    expect(diff.title).toBeNull()
    expect(diff.description).toBeNull()
  })

  it('treats an unknown id as a new fact rather than an edit', () => {
    // A hand-edited file naming another set's id must not silently adopt it.
    const diff = diffSet(current([asks('mine', 'when')]), {
      facts: [{ id: 'someone-elses', slots: { a: '1', b: '2' } }]
    })
    expect(diff.counts.added).toBe(1)
    expect(diff.counts.removed).toBe(1)
  })

  it('counts an undeclared fact as one question per slot', () => {
    expect(questionCount({ slots: { a: '1', b: '2', c: '3' } })).toBe(3)
    expect(questionCount({ slots: { a: '1', b: '2' }, questions: [{ ask: 'a' }] })).toBe(1)
  })

  it('handles an upload that empties the set', () => {
    const diff = diffSet(current([flashcard('a'), flashcard('b')]), { facts: [] })
    expect(diff.counts.removed).toBe(2)
    expect(diff.questionsAfter).toBe(0)
    expect(diff.empty).toBe(false)
  })
})
