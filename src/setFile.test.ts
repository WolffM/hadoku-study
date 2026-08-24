/**
 * Reading a set from wherever it came from.
 *
 * WRITING a file lives on the server now, and its round-trip property is
 * asserted there — one implementation, one place. What is left here is the
 * genuinely different half: being tolerant on the way IN. What people have on
 * the clipboard is a server file, a raw API response, a spreadsheet column, or
 * a v1 export from before facts existed, and all of those have to land.
 */

import { describe, expect, it } from 'vitest'
import { SetFileError, factsFromCards, parseDelimited, parseImport, setFileName } from './setFile'

/**
 * What `GET /sets/{id}/file` actually emits, copied in shape from the worker's
 * own tests. A fixture rather than a call, because the point of this file is
 * what happens to a document once it is on someone's clipboard.
 */
const serverFile = {
  $schema: 'https://hadoku.me/study/api/openapi.json#/components/schemas/CreateSetInput',
  formatVersion: 2,
  title: 'The Reformation',
  description: 'Luther to Augsburg',
  published: true,
  facts: [
    {
      id: 'worms',
      slots: {
        who: 'Martin Luther and Emperor Charles V',
        what: 'Luther refused to recant his writings',
        where: 'the Diet of Worms',
        when: '1521'
      },
      questions: [{ ask: 'when', given: ['where'], prompt: 'What year?', seedTier: 2 }],
      detail: 'A later embellishment.',
      attrs: { board: { category: 'Places' } }
    },
    { id: 'plain', slots: { prompt: 'кот', answer: 'cat' } }
  ]
}

describe('reading what the server emits', () => {
  const parsed = parseImport(JSON.stringify(serverFile))

  it('keeps the metadata', () => {
    expect(parsed.title).toBe('The Reformation')
    expect(parsed.description).toBe('Luther to Augsburg')
    expect(parsed.facts).toHaveLength(2)
  })

  it('keeps every fact’s id, which is what carries its rating history', () => {
    expect(parsed.facts.map(fact => fact.id)).toEqual(['worms', 'plain'])
  })

  it('keeps slots, questions and the game bag', () => {
    expect(parsed.facts[0].slots.when).toBe('1521')
    expect(parsed.facts[0].questions).toEqual([
      { ask: 'when', given: ['where'], prompt: 'What year?', seedTier: 2 }
    ])
    expect(parsed.facts[0].attrs?.board).toEqual({ category: 'Places' })
    expect(parsed.facts[0].detail).toBe('A later embellishment.')
  })

  it('leaves a fact that declares nothing declaring nothing', () => {
    expect(parsed.facts[1].questions).toBeUndefined()
  })

  it('ignores the metadata keys rather than choking on them', () => {
    expect(parsed).not.toHaveProperty('formatVersion')
  })

  it('keeps a namespace this bundle has never heard of', () => {
    const exotic = {
      ...serverFile,
      facts: [{ id: 'x', slots: { a: '1', b: '2' }, attrs: { nameThatMap: { region: 'Maguuma' } } }]
    }
    expect(parseImport(JSON.stringify(exotic)).facts[0].attrs?.nameThatMap).toEqual({
      region: 'Maguuma'
    })
  })
})

describe('reading a v1 file, from before facts existed', () => {
  const v1 = {
    version: 1,
    title: 'Reformation Jeopardy',
    cards: [
      {
        front: 'Where did Luther refuse to recant?',
        back: 'Worms',
        detail: '1521.',
        attrs: { board: { category: 'Places', difficulty: 4 } }
      },
      { front: 'кот', back: 'cat' }
    ]
  }

  it('turns each card into a two-slot fact', () => {
    const parsed = parseImport(JSON.stringify(v1))
    expect(parsed.title).toBe('Reformation Jeopardy')
    expect(parsed.facts).toHaveLength(2)
    expect(parsed.facts[1].slots).toEqual({ prompt: 'кот', answer: 'cat' })
  })

  it('declares the one question the card was, not the reverse as well', () => {
    // The default expansion would also generate prompt-from-answer, quietly
    // doubling everybody's deck on import.
    const parsed = parseImport(JSON.stringify(v1))
    expect(parsed.facts[1].questions).toEqual([{ ask: 'answer', given: ['prompt'], seedTier: 3 }])
  })

  it('moves the board difficulty to the question’s seed tier', () => {
    // The server REJECTS a stray `difficulty` in the board namespace, so a file
    // that kept it there would fail the whole import.
    const parsed = parseImport(JSON.stringify(v1))
    expect(parsed.facts[0].questions?.[0].seedTier).toBe(4)
    expect(parsed.facts[0].attrs?.board).toEqual({ category: 'Places' })
  })

  it('drops a board namespace that held nothing but a difficulty', () => {
    const [fact] = factsFromCards([{ front: 'a', back: 'b', attrs: { board: { difficulty: 2 } } }])
    expect(fact.attrs).toBeUndefined()
    expect(fact.questions?.[0].seedTier).toBe(2)
  })

  it('keeps other games’ namespaces while moving the board’s', () => {
    const [fact] = factsFromCards([
      {
        front: 'a',
        back: 'b',
        attrs: { board: { category: 'P', difficulty: 5 }, nameThatMap: { region: 'x' } }
      }
    ])
    expect(fact.attrs).toEqual({ board: { category: 'P' }, nameThatMap: { region: 'x' } })
  })

  it('carries the detail across', () => {
    expect(parseImport(JSON.stringify(v1)).facts[0].detail).toBe('1521.')
  })
})

describe('reading whatever is on the clipboard', () => {
  it('unwraps a raw API response', () => {
    // `curl <url> > set.json` writes the whole envelope, and telling someone
    // their own export is the wrong shape is a pointless obstacle.
    const body = { success: true, data: { set: serverFile } }
    expect(parseImport(JSON.stringify(body)).facts).toHaveLength(2)
  })

  it('accepts a bare array of facts', () => {
    const text = JSON.stringify([{ slots: { prompt: 'a', answer: 'b' } }])
    expect(parseImport(text).facts).toHaveLength(1)
  })

  it('accepts a bare array of v1 cards', () => {
    const text = JSON.stringify([{ front: 'a', back: 'b' }])
    expect(parseImport(text).facts[0].slots).toEqual({ prompt: 'a', answer: 'b' })
  })

  it('reads a spreadsheet paste, tab first', () => {
    const facts = parseDelimited('кот\tcat\nсобака\tdog')
    expect(facts.map(f => f.slots.answer)).toEqual(['cat', 'dog'])
  })

  it('keeps everything after the first comma with the answer', () => {
    expect(parseDelimited('кот, the animal')[0].slots.answer).toBe('the animal')
  })

  it('drops a fact with fewer than two slots rather than storing a stub', () => {
    const text = JSON.stringify({ title: 'T', facts: [{ slots: { only: 'one' } }] })
    expect(() => parseImport(text)).toThrow(SetFileError)
  })

  it('says something useful when there is nothing to read', () => {
    expect(() => parseImport('   ')).toThrow(SetFileError)
    expect(() => parseImport('{"title":"T"}')).toThrow(SetFileError)
    expect(() => parseImport('{ not json')).toThrow(SetFileError)
  })
})

describe('the download filename', () => {
  it('slugs the title', () => {
    expect(setFileName('Reformation Jeopardy!')).toBe('reformation-jeopardy.json')
  })

  it('falls back when a title slugs to nothing', () => {
    expect(setFileName('!!!')).toBe('study-set.json')
  })
})
