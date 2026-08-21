/**
 * Every playable mode, in the order the set page offers them.
 *
 * The one place that knows the full list. To add a game: write a directory
 * under `src/games/`, export a {@link GameDefinition}, and add it here. The
 * set page, the router and the API schema all stay untouched — a new mode
 * stores whatever it needs under its own key in a card's `attrs` bag, which
 * the server passes through without needing to know the shape.
 */

import type { GameDefinition } from './types'
import { boardGame } from './board'
import { drillGame } from './drill'

export const GAMES: GameDefinition[] = [drillGame, boardGame]

export const findGame = (id: string | null): GameDefinition | null =>
  GAMES.find(game => game.id === id) ?? null

export type { GameAvailability, GameDefinition, GameProps } from './types'
