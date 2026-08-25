/**
 * Checking a set for the mistakes that pass validation.
 *
 * The API rejects a malformed file. It cannot reject a well-formed one that is
 * simply bad — a question whose prompt contains its own answer parses fine,
 * imports fine, and is worthless. Every check here is a mistake actually made
 * while building this set, by someone who had written the model: they are not
 * hypothetical, they are the ones that happen.
 *
 * Pure and client-side, and it can be, because none of it needs a variant key.
 * A question's answer is `slots[ask]`, its context is `given ?? every other
 * slot`, and both are in the file. The editor runs this on whatever an agent
 * hands back, so a bad batch is visible before it is saved rather than after
 * it is played.
 */

import type { FactInput, QuestionInput } from '../api/types'
import { KNOWN_SLOTS } from './slots'

export type Severity = 'error' | 'warning'

export interface Finding {
  severity: Severity
  /** Which fact, by position in the file — the only handle a hand-written or
   *  agent-written file reliably has, since ids are optional on new facts. */
  factIndex: number
  message: string
}

/** Words worth comparing. Short ones are noise — "the", "was", "into". */
const significant = (text: string): string[] => {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
  return cleaned.split(/\s+/).filter(word => word.length > 3)
}

/**
 * How much of the answer is already sitting in the question.
 *
 * A ratio rather than a substring test, because the leak that actually happens
 * is a paraphrase: "What happened to Hus at Constance, despite a promise of
 * safe conduct?" answered by "burned at Constance despite a promise of safe
 * conduct". No exact match, and no question left to answer.
 */
export function leakage(prompt: string, answer: string): number {
  const wanted = new Set(significant(answer))
  if (wanted.size === 0) return 0
  const haystack = ` ${prompt.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `
  let found = 0
  for (const word of wanted) if (haystack.includes(` ${word} `)) found += 1
  return found / wanted.size
}

/** Past this, the question has given itself away. Tuned on the real set: the
 *  two genuine leaks scored 86% and 57%, and the worst innocent one 29%. */
export const LEAK_THRESHOLD = 0.5

/** The slots a question shows beside its prompt. Mirrors the server's default
 *  of "every other slot" when `given` is omitted. */
const shownSlots = (fact: FactInput, question: QuestionInput): string[] => {
  const others = Object.keys(fact.slots).filter(name => name !== question.ask)
  return question.given ? question.given.filter(name => others.includes(name)) : others
}

/** A question's identity, for spotting two that resolve to the same thing.
 *  Mirrors the server's variant key in SHAPE only — this never leaves the
 *  browser and nothing is stored against it. */
const identity = (question: QuestionInput, shown: string[]): string =>
  `${question.ask}<${[...shown].sort().join(',')}>`

export function lintFact(fact: FactInput, factIndex: number): Finding[] {
  const found: Finding[] = []
  const add = (severity: Severity, message: string) => found.push({ severity, factIndex, message })

  const filled = Object.entries(fact.slots).filter(([, value]) => value.trim() !== '')
  if (filled.length < 2) {
    add('error', 'needs at least two filled slots — one to ask, one to show')
    return found
  }

  const questions = fact.questions ?? null
  if (questions === null || questions.length === 0) {
    // Legal, and sometimes right. Worth saying because the result is often a
    // surprise: a four-slot fact silently becomes four questions.
    add(
      'warning',
      `declares no questions, so it will be asked ${filled.length} ways — one per slot, with no written prompts`
    )
    return found
  }

  const seen = new Set<string>()
  questions.forEach((question, at) => {
    const label = `question ${at + 1} (asks "${question.ask}")`

    const answer = fact.slots[question.ask]
    if (answer === undefined || answer.trim() === '') {
      // The failure with no symptom: the server skips a declaration whose
      // asked slot is missing, so the question simply never appears.
      add('error', `${label} asks a slot this fact does not have — it will silently vanish`)
      return
    }

    const shown = shownSlots(fact, question)
    const key = identity(question, shown)
    if (seen.has(key)) {
      add('warning', `${label} duplicates an earlier question exactly — only the first is kept`)
      return
    }
    seen.add(key)

    const prompt = question.prompt?.trim() ?? ''
    if (prompt === '' && !(KNOWN_SLOTS as readonly string[]).includes(question.ask)) {
      add(
        'warning',
        `${label} has no prompt, and "${question.ask}" is not a slot we can phrase — it will read "What is the ${question.ask}?"`
      )
    }

    if (prompt !== '') {
      const leaked = leakage(prompt, answer)
      if (leaked >= LEAK_THRESHOLD) {
        add(
          'error',
          `${label} gives away its own answer — ${Math.round(leaked * 100)}% of it is already in the prompt`
        )
      }

      // The context is drawn BESIDE the prompt. A self-contained prompt plus
      // its givens prints the same sentence twice, once large and once small.
      const echoed = shown.filter(name => leakage(prompt, fact.slots[name] ?? '') >= 0.8)
      if (echoed.length > 0) {
        add(
          'warning',
          `${label} already says what "${echoed.join('", "')}" holds, but shows ${echoed.length === 1 ? 'it' : 'them'} alongside too — set "given": [] to stop it printing twice`
        )
      }
    }
  })

  return found
}

export interface SetReport {
  findings: Finding[]
  facts: number
  questions: number
  /** Distinct facts behind each asked slot — how many board columns the set
   *  can offer, and how deep each one goes. */
  columns: { slot: string; facts: number }[]
}

/** Columns a full board wants, and rows per column. Mirrors the board's own
 *  defaults; used here only to phrase the advice. */
const BOARD_COLUMNS = 4
const BOARD_ROWS = 5

export function lintSet(facts: FactInput[]): SetReport {
  const findings = facts.flatMap((fact, index) => lintFact(fact, index))

  const bySlot = new Map<string, Set<string>>()
  let questions = 0
  facts.forEach((fact, index) => {
    const asked = fact.questions?.length
      ? [...new Set(fact.questions.map(question => question.ask))]
      : Object.keys(fact.slots)
    questions += fact.questions?.length ?? Object.keys(fact.slots).length
    for (const ask of asked) {
      if (!(ask in fact.slots)) continue
      const holder = bySlot.get(ask) ?? new Set<string>()
      holder.add(fact.id ?? `#${index}`)
      bySlot.set(ask, holder)
    }
  })

  const columns = [...bySlot.entries()]
    .map(([slot, ids]) => ({ slot, facts: ids.size }))
    .sort((a, b) => b.facts - a.facts || a.slot.localeCompare(b.slot))

  return { findings, facts: facts.length, questions, columns }
}

/**
 * Whether this set can fill a board, phrased for a person.
 *
 * Null when it can. Kept separate from the findings because it is not a
 * mistake — a set can be perfectly good and simply not be a board.
 */
export function boardAdvice(report: SetReport): string | null {
  const deep = report.columns.filter(column => column.facts >= BOARD_ROWS)
  if (deep.length >= BOARD_COLUMNS) return null
  if (report.columns.length < 2) {
    return 'This set asks only one kind of question, so it cannot be played as a board. Give facts a spread of slots — who, what, where, when, why.'
  }
  return `${deep.length} of ${BOARD_COLUMNS} columns are deep enough for a full board. A column needs ${BOARD_ROWS} different facts that can answer it, and no fact is asked twice on one board.`
}
