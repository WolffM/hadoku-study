/**
 * Every check here is a mistake made while building the Reformation set, by
 * someone who had just written the model. None of them are hypothetical.
 *
 * The API rejects a malformed file; it cannot reject a well-formed one that is
 * simply bad. A question whose prompt contains its own answer parses, imports
 * and plays — it is just worthless.
 */

import { describe, expect, it } from 'vitest'
import type { FactInput } from '../api/types'
import { LEAK_THRESHOLD, boardAdvice, leakage, lintFact, lintSet } from './lint'

const errors = (fact: FactInput) =>
  lintFact(fact, 0)
    .filter(f => f.severity === 'error')
    .map(f => f.message)
const warnings = (fact: FactInput) =>
  lintFact(fact, 0)
    .filter(f => f.severity === 'warning')
    .map(f => f.message)

describe('a question that gives away its own answer', () => {
  it('catches the real one, which was a paraphrase and not a substring', () => {
    // Written on 2026-08-24 while merging the two Hus facts. Scored 86%.
    const fact: FactInput = {
      slots: {
        who: 'Jan Hus',
        what: 'burned at the Council of Constance despite a promise of safe conduct'
      },
      questions: [
        {
          ask: 'what',
          prompt:
            'What happened to Jan Hus at the Council of Constance, despite a promise of safe conduct?'
        }
      ]
    }
    expect(errors(fact)[0]).toContain('gives away its own answer')
  })

  it('catches a circular definition, which reads fine until you try to answer it', () => {
    // Written in phase 3. Scored 57%.
    const fact: FactInput = {
      slots: {
        term: 'Anfechtung',
        why: 'the terror his whole theology of justification by faith was built to answer'
      },
      questions: [
        {
          ask: 'why',
          prompt: 'What was Luther’s doctrine of justification by faith built to answer?'
        }
      ]
    }
    expect(errors(fact)[0]).toContain('gives away its own answer')
  })

  it('leaves an honest question alone', () => {
    const fact: FactInput = {
      slots: { context: 'the Diet of Worms', when: '1521' },
      questions: [{ ask: 'when', prompt: 'In what year did Luther refuse to recant?' }]
    }
    expect(errors(fact)).toEqual([])
  })

  it('does not flag a question that merely shares a proper noun', () => {
    const fact: FactInput = {
      slots: { where: 'Constance', what: 'the council that ended the three-pope schism' },
      questions: [{ ask: 'where', prompt: 'Which lakeside city hosted the council of 1414–1418?' }]
    }
    expect(errors(fact)).toEqual([])
  })

  it('scores a verbatim restatement at the top and an unrelated one at the bottom', () => {
    expect(leakage('Who was burned at Constance?', 'burned at Constance')).toBe(1)
    expect(leakage('In what year?', 'Martin Luther')).toBe(0)
    expect(LEAK_THRESHOLD).toBeGreaterThan(0.29) // the worst innocent case measured
    expect(LEAK_THRESHOLD).toBeLessThan(0.57) // the mildest real leak measured
  })
})

describe('a question that shows what it has already said', () => {
  it('catches the context printed twice', () => {
    // The production bug: an authored prompt containing the quote, with the
    // quote also rendered beside it as a context chip.
    const fact: FactInput = {
      slots: {
        quote: '“Here I stand, I can do no other. God help me.”',
        who: 'Martin Luther'
      },
      questions: [
        {
          ask: 'who',
          given: ['quote'],
          prompt: '“Here I stand, I can do no other. God help me.” — who said it?'
        }
      ]
    }
    expect(warnings(fact)[0]).toContain('printing twice')
    expect(warnings(fact)[0]).toContain('"given": []')
  })

  it('leaves genuine context alone', () => {
    const fact: FactInput = {
      slots: { what: 'Luther refused to recant his writings', when: '1521' },
      questions: [{ ask: 'when', given: ['what'], prompt: 'In what year?' }]
    }
    expect(warnings(fact)).toEqual([])
  })
})

describe('a question that will silently vanish', () => {
  it('catches a declaration asking a slot the fact does not have', () => {
    // The failure with no symptom: the server skips it, and a question you
    // wrote simply never appears anywhere.
    const fact: FactInput = {
      slots: { who: 'Johann Tetzel', what: 'sold indulgences' },
      questions: [{ ask: 'why', prompt: 'Why does Tetzel matter?' }]
    }
    expect(errors(fact)[0]).toContain('silently vanish')
  })

  it('catches two declarations that resolve to the same question', () => {
    const fact: FactInput = {
      slots: { a: '1', b: '2' },
      questions: [
        { ask: 'a', prompt: 'first' },
        { ask: 'a', prompt: 'second' }
      ]
    }
    expect(warnings(fact)[0]).toContain('only the first is kept')
  })
})

describe('the softer advice', () => {
  it('warns about an unphraseable slot with no prompt', () => {
    const fact: FactInput = {
      slots: { screenshot: 'queensdale.jpg', map: 'Queensdale' },
      questions: [{ ask: 'map', given: ['screenshot'] }]
    }
    expect(warnings(fact)[0]).toContain('not a slot we can phrase')
  })

  it('says nothing about a known slot with no prompt', () => {
    const fact: FactInput = {
      slots: { what: 'something happened', when: '1521' },
      questions: [{ ask: 'when', given: ['what'] }]
    }
    expect(warnings(fact)).toEqual([])
  })

  it('warns that an undeclared fact becomes one question per slot', () => {
    const fact: FactInput = { slots: { who: 'a', what: 'b', where: 'c', when: 'd' } }
    expect(warnings(fact)[0]).toContain('asked 4 ways')
  })

  it('reports a half-typed fact once and stops', () => {
    const fact: FactInput = { slots: { who: 'Luther', what: '' } }
    expect(errors(fact)).toEqual(['needs at least two filled slots — one to ask, one to show'])
  })
})

describe('the whole set', () => {
  const asking = (id: string, ask: string): FactInput => ({
    id,
    slots: { context: `c${id}`, [ask]: `${ask} ${id}` },
    questions: [{ ask, prompt: `Question about ${id}?` }]
  })

  it('counts what is there and which columns it could offer', () => {
    // A column is an ARCHETYPE. These three facts ask different slots and
    // declare no archetype, so they are one implicit column — which is the
    // whole point: they used to read as two columns over three facts.
    const report = lintSet([asking('a', 'when'), asking('b', 'when'), asking('c', 'who')])
    expect(report.facts).toBe(3)
    expect(report.questions).toBe(3)
    expect(report.columns).toEqual([{ slot: '', facts: 3 }])
  })

  it('counts a column per declared archetype', () => {
    const archetypes = [
      { name: 'dates', label: 'Name that year', ask: ['when'] },
      { name: 'people', label: 'Who was it', ask: ['who'] }
    ]
    const report = lintSet(
      [
        { ...asking('a', 'when'), archetype: 'dates' },
        { ...asking('b', 'when'), archetype: 'dates' },
        { ...asking('c', 'who'), archetype: 'people' }
      ],
      archetypes
    )
    expect(report.columns).toEqual([
      { slot: 'dates', facts: 2 },
      { slot: 'people', facts: 1 }
    ])
  })

  it('reports a fact pointing at an archetype nobody declared', () => {
    const report = lintSet([{ ...asking('a', 'when'), archetype: 'ghost' }], [])
    // No archetypes declared at all means nothing to check against — the set
    // is simply pre-archetype. The check needs a declaration to disagree with.
    expect(report.findings.some(f => f.message.includes('No archetype called'))).toBe(false)

    const declared = lintSet(
      [{ ...asking('a', 'when'), archetype: 'ghost' }],
      [{ name: 'dates', label: 'Dates', ask: ['when'] }]
    )
    expect(declared.findings.some(f => f.severity === 'error' && f.message.includes('ghost'))).toBe(
      true
    )
  })

  it('reports a fact that cannot answer its own column', () => {
    const report = lintSet(
      [{ ...asking('a', 'when'), archetype: 'scripture' }],
      [{ name: 'scripture', label: 'Biblical references', ask: ['citation'] }]
    )
    expect(
      report.findings.some(f => f.severity === 'error' && f.message.includes('cannot answer'))
    ).toBe(true)
  })

  it('warns about a question the archetype will not generate', () => {
    const report = lintSet(
      [{ ...asking('a', 'when'), archetype: 'dates' }],
      [{ name: 'dates', label: 'Dates', ask: ['who'] }]
    )
    expect(
      report.findings.some(f => f.severity === 'warning' && f.message.includes('not asked by'))
    ).toBe(true)
  })

  it('numbers findings by position, the only handle a new fact has', () => {
    const bad: FactInput = { slots: { a: '1' } }
    const report = lintSet([asking('a', 'when'), bad])
    expect(report.findings[0].factIndex).toBe(1)
  })

  it('says when a set cannot fill a board, and why', () => {
    const noArchetypes = [asking('a', 'when'), asking('b', 'when')]
    expect(boardAdvice(lintSet(noArchetypes))).toContain('declares no archetypes')

    const archetypes = ['a', 'b', 'c', 'd'].map(name => ({
      name,
      label: name,
      ask: ['when']
    }))
    const thin = archetypes.map((a, i) => ({ ...asking(`f${i}`, 'when'), archetype: a.name }))
    expect(boardAdvice(lintSet(thin, archetypes))).toContain('deep enough')
  })

  it('says nothing when a full board can be dealt', () => {
    // Four archetypes of five facts each. It used to be four SLOTS of five,
    // which is the same set of facts and a very different board.
    const archetypes = ['dates', 'people', 'places', 'reasons'].map(name => ({
      name,
      label: name,
      ask: ['when']
    }))
    const plenty = archetypes.flatMap(archetype =>
      Array.from({ length: 5 }, (_, i) => ({
        ...asking(`${archetype.name}${i}`, 'when'),
        archetype: archetype.name
      }))
    )
    expect(boardAdvice(lintSet(plenty, archetypes))).toBeNull()
  })
})

describe('asking one fact both ways round', () => {
  const pair = [{ name: 'term', label: 'Vocabulary', ask: ['term', 'definition'] }]
  const both: FactInput = {
    slots: { term: 'Anfechtung', definition: 'crushing spiritual despair' },
    archetype: 'term',
    questions: [
      { ask: 'term', prompt: 'What is the German word for it?' },
      { ask: 'definition', prompt: 'What does Anfechtung mean?' }
    ]
  }

  it('warns, because it drills one piece of knowledge twice', () => {
    const report = lintSet([both], pair)
    expect(
      report.findings.some(f => f.severity === 'warning' && f.message.includes('both ways round'))
    ).toBe(true)
  })

  it('says nothing when the fact picks a direction', () => {
    const one = { ...both, questions: [both.questions![0]] }
    const report = lintSet([one], pair)
    expect(report.findings.some(f => f.message.includes('both ways round'))).toBe(false)
  })

  it('leaves a three-slot archetype alone — those are attributes, not a pair', () => {
    // who/where/when of one event are three different things to know. Only a
    // TWO-slot archetype is a relation that can be read backwards.
    const trio = [{ name: 'event', label: 'Events', ask: ['who', 'where', 'when'] }]
    const fact: FactInput = {
      slots: { who: 'Luther', where: 'Worms', when: '1521' },
      archetype: 'event',
      questions: [{ ask: 'who' }, { ask: 'where' }, { ask: 'when' }]
    }
    expect(lintSet([fact], trio).findings.some(f => f.message.includes('both ways round'))).toBe(
      false
    )
  })
})
