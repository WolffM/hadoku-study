/**
 * The drill's registry entry.
 *
 * The plain walk through a deck is a game like any other, and registering it
 * here rather than special-casing it in the set page is what keeps that page
 * from knowing about modes at all. It is listed first, so it stays the default
 * thing to do with a set.
 *
 * Its availability rule is the simplest one there is: every question has a
 * prompt and an answer, so any set with facts can be drilled. That is also why
 * every board is playable as a deck — the asymmetry between the modes lives
 * entirely in these functions.
 */

import type { GameDefinition } from '../types'
import { Drill } from '../../views/Drill'

export const drillGame: GameDefinition = {
  id: 'drill',
  label: 'Study',
  availability: set => {
    if (set.facts.length === 0) return { playable: false, blocked: 'This set has no facts yet.' }
    return { playable: true }
  },
  Component: Drill
}
