/**
 * This app's own preferences.
 *
 * Theme is NOT here — that is platform-global and owned by `<HadokuThemeRoot>`
 * under the shared 'portfolio' appId. These use study's own appId, so they
 * cannot collide with another app's settings, and they follow the user across
 * devices through prefs-api.
 */

import { z } from 'zod'
import { createPrefsClient } from '@wolffm/prefs-client'

export const StudyPrefsSchema = z.object({
  /**
   * Shuffle a set before drilling it.
   *
   * Off by default: card order is usually the author's, and a language deck
   * that builds on itself is worse scrambled. It is a preference rather than a
   * per-drill toggle because whichever way someone likes to study, they like it
   * every time.
   */
  shuffle: z.boolean().optional()
})

export type StudyPrefs = z.infer<typeof StudyPrefsSchema>

export const studyPrefs = createPrefsClient({
  appId: 'study',
  schema: StudyPrefsSchema,
  defaults: { shuffle: false }
})
