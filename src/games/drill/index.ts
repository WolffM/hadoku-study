/**
 * The drill's registry entry.
 *
 * The plain walk through a deck is a game like any other, and registering it
 * here rather than special-casing it in the set page is what keeps that page
 * from knowing about modes at all. It is listed first, so it stays the default
 * thing to do with a set.
 *
 * Its availability rule is the simplest one there is: every card has a front
 * and a back, so any set with cards can be drilled. That is also why every
 * board is playable as a deck — the asymmetry between the modes lives entirely
 * in these functions.
 */

import type { GameDefinition } from '../types'
import { Drill } from '../../views/Drill'

export const drillGame: GameDefinition = {
  id: 'drill',
  label: 'Study',
  availability: set =>
    set.cards.length > 0
      ? { playable: true }
      : { playable: false, blocked: 'This set has no cards yet.' },
  Component: Drill
}
