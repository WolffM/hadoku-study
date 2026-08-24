/**
 * A set has to survive leaving and coming back.
 *
 * Two properties, and both have teeth. The export has to parse as an import
 * with nothing edited — that is the whole reason a set is one file. And a v1
 * export, written before facts existed, has to land as the same content
 * migration 0003 made of the v1 rows, because plenty of those files exist on
 * disk and refusing them would strand sets that convert perfectly.
 */

import { describe, expect, it } from 'vitest'
import {
  SET_FILE_VERSION,
  SetFileError,
  factsFromCards,
  parseDelimited,
  parseImport,
  serializeSetFile,
  setFileName,
  toSetFile
} from './setFile'
import { authored, clue, detailSet, flashcard } from './testing/fixtures'

const roundTrip = (set: Parameters<typeof toSetFile>[0]) =>
  parseImport(JSON.stringify(toSetFile(set)))

describe('exporting', () => {
  it('writes the format marker and the schema pointer', () => {
    const file = toSetFile(detailSet([flashcard('a')]))
    expect(file.formatVersion).toBe(SET_FILE_VERSION)
    expect(String(file.$schema)).toContain('openapi.json')
  })

  it('never writes the derived variants', () => {
    // They are recomputed from slots and questions on every read. A copy in
    // the file would be an authoritative-looking second answer, wrong the
    // moment a slot is edited.
    const file = toSetFile(detailSet([authored('a')])) as { facts: Record<string, unknown>[] }
    expect(file.facts[0]).not.toHaveProperty('variants')
    expect(file.facts[0].slots).toBeDefined()
    expect(file.facts[0].questions).toBeDefined()
  })

  it('writes each fact’s id, which is what carries its rating history', () => {
    const file = toSetFile(detailSet([flashcard('keep-me')])) as {
      facts: Record<string, unknown>[]
    }
    expect(file.facts[0].id).toBe('keep-me')
  })

  it('omits what a fact has nothing to say about', () => {
    const file = toSetFile(detailSet([flashcard('a')])) as { facts: Record<string, unknown>[] }
    expect(file.facts[0]).not.toHaveProperty('detail')
    expect(file.facts[0]).not.toHaveProperty('attrs')
  })

  it('ends with a newline, so the file is a well-formed text file', () => {
    expect(serializeSetFile(detailSet([flashcard('a')]))).toMatch(/\n$/)
  })
})

describe('a round trip loses nothing', () => {
  it('keeps slots, questions and ids', () => {
    const parsed = roundTrip(detailSet([authored('a')], { title: 'The Reformation' }))
    expect(parsed.title).toBe('The Reformation')
    expect(parsed.facts[0].id).toBe('a')
    expect(parsed.facts[0].slots.when).toBe('1521')
    expect(parsed.facts[0].questions?.map(q => q.ask)).toEqual(['when', 'where'])
  })

  it('keeps a board category, so a board does not degrade to a deck', () => {
    const parsed = roundTrip(detailSet([clue('a', 'Places', 4)]))
    expect(parsed.facts[0].attrs?.board).toEqual({ category: 'Places' })
    expect(parsed.facts[0].questions?.[0].seedTier).toBe(4)
  })

  it('keeps a namespace this bundle has never heard of', () => {
    const set = detailSet([{ ...flashcard('a'), attrs: { nameThatMap: { region: 'Maguuma' } } }])
    expect(roundTrip(set).facts[0].attrs?.nameThatMap).toEqual({ region: 'Maguuma' })
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
    const body = { success: true, data: { set: toSetFile(detailSet([flashcard('a')])) } }
    expect(parseImport(JSON.stringify(body)).facts).toHaveLength(1)
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
