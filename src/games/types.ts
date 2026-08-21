/**
 * What a game is, from the app's point of view.
 *
 * The set page does not know about boards. It walks {@link GAMES}, asks each
 * one whether this set can be played, and renders a button for the ones that
 * say yes. Adding a mode means adding a directory and one registry entry —
 * no edits to the set page, the router, or the schema.
 *
 * A game's `id` is three things at once, deliberately: its key in a card's
 * `attrs` bag, its value in the `?play=` URL param, and its identity here.
 * One name means there is nowhere for the three to drift apart.
 */

import type { ComponentType } from 'react'
import type { StudyClient } from '../api/client'
import type { StudySetDetail } from '../api/types'

/** Handed to every game. Take what you need and ignore the rest — a game that
 *  keeps no server-side state simply never touches `client`. */
export interface GameProps {
  set: StudySetDetail
  client: StudyClient
  /** Whether the server can hold this reader's progress. Signed-out readers
   *  keep theirs on the device. */
  syncEnabled: boolean
  shuffle: boolean
  onExit: () => void
}

export interface GameAvailability {
  playable: boolean
  /** A short line under the button — what you are about to play. Omitted when
   *  there is nothing worth saying. */
  summary?: string
  /** Why it cannot be played, when that is worth telling the author. */
  blocked?: string
}

export interface GameDefinition {
  /** Stable id: the `attrs` namespace, the `?play=` value, the registry key. */
  id: string
  /** Button text on the set page. */
  label: string
  /**
   * One line on what this mode actually does, shown under the label.
   *
   * Static, and owned by the game: the set page offers a CHOICE between modes,
   * and a choice between two bare verbs makes the reader guess what they are
   * picking. `availability().summary` is the dynamic counterpart — this
   * describes the mode, that describes this set in it.
   */
  blurb: string
  /**
   * Optional at-a-glance picture of this set in this mode.
   *
   * Here so a game can show its own shape without the set page learning what
   * any of them look like — the board draws its grid, and a mode with nothing
   * useful to draw simply omits it.
   */
  Preview?: ComponentType<{ set: StudySetDetail }>
  /** Whether this set can be played, decided from the CARDS. Derived every
   *  time rather than stored, so a set that gets tagged later starts
   *  qualifying on its own with no migration and no flag to keep in sync. */
  availability: (set: StudySetDetail) => GameAvailability
  Component: ComponentType<GameProps>
}
