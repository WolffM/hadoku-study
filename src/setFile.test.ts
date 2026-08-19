/**
 * The importer is deliberately forgiving, and forgiving code fails quietly.
 *
 * Every branch here corresponds to something a real person will paste: a file
 * they exported, the raw envelope `curl` writes, a column out of a
 * spreadsheet, an array someone's script produced. Getting one wrong does not
 * throw — it silently drops cards — so each shape is pinned.
 */

import { describe, expect, it } from 'vitest'
import {
  SetFileError,
  parseDelimited,
  parseImport,
  serializeSetFile,
  setFileName,
  toSetFile
} from './setFile'
import type { StudySetDetail } from './api/types'

const set: StudySetDetail = {
  id: 'qvv7k2mfjxtd',
  title: 'Russian — animals',
  description: 'First 40 nouns',
  published: true,
  cardCount: 2,
  isOwner: true,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
  cards: [
    { id: 'card-one', front: 'кот', back: 'cat' },
    { id: 'card-two', front: 'собака', back: 'dog' }
  ]
}

describe('export', () => {
  it('writes the content and drops the server-owned fields', () => {
    const file = toSetFile(set)
    expect(file.title).toBe('Russian — animals')
    expect(file.published).toBe(true)
    expect(file.cards).toEqual([
      { front: 'кот', back: 'cat' },
      { front: 'собака', back: 'dog' }
    ])
    expect(file).not.toHaveProperty('id')
    expect(file).not.toHaveProperty('isOwner')
    expect(file).not.toHaveProperty('cardCount')
  })

  it('round-trips through its own importer', () => {
    const parsed = parseImport(serializeSetFile(set))
    expect(parsed.title).toBe('Russian — animals')
    expect(parsed.description).toBe('First 40 nouns')
    expect(parsed.cards).toHaveLength(2)
  })

  it('names the file after the set without letting the title escape it', () => {
    expect(setFileName('Russian — animals')).toBe('russian-animals.json')
    expect(setFileName('../../etc/passwd')).toBe('etc-passwd.json')
    expect(setFileName('日本語')).toBe('study-set.json')
  })
})

describe('import accepts what people actually have', () => {
  it('a bare set file', () => {
    const parsed = parseImport('{"title":"T","cards":[{"front":"a","back":"b"}]}')
    expect(parsed.title).toBe('T')
    expect(parsed.cards).toEqual([{ front: 'a', back: 'b' }])
  })

  it('the wrapped envelope curl writes straight off the API', () => {
    const envelope = JSON.stringify({ success: true, data: { set } })
    const parsed = parseImport(envelope)
    expect(parsed.title).toBe('Russian — animals')
    expect(parsed.cards).toHaveLength(2)
  })

  it('a bare array of cards, with no title to take', () => {
    const parsed = parseImport('[{"front":"a","back":"b"}]')
    expect(parsed.title).toBeUndefined()
    expect(parsed.cards).toEqual([{ front: 'a', back: 'b' }])
  })

  it('a tab-separated paste out of a spreadsheet', () => {
    const parsed = parseImport('кот\tcat\nсобака\tdog')
    expect(parsed.cards).toEqual([
      { front: 'кот', back: 'cat' },
      { front: 'собака', back: 'dog' }
    ])
  })

  it('a comma-separated list, keeping later commas with the back', () => {
    expect(parseDelimited('cat, the animal')).toEqual([{ front: 'cat', back: 'the animal' }])
  })
})

describe('import refuses what it cannot read, rather than importing nothing', () => {
  const rejects = (text: string) => {
    expect(() => parseImport(text)).toThrow(SetFileError)
  }

  it('empty input', () => rejects('   '))
  it('malformed JSON', () => rejects('{"title": "T", cards: ['))
  it('JSON with no cards', () => rejects('{"title":"T"}'))
  it('an empty JSON array', () => rejects('[]'))

  it('reports malformed JSON as JSON, not as an empty card list', () => {
    // The fallback path would otherwise swallow this and say "no cards found",
    // sending whoever pasted it looking for the wrong problem.
    expect(() => parseImport('{"title": "T", cards: [')).toThrow(/could not be parsed/i)
  })
})
