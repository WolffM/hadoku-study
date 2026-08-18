/**
 * EXAMPLE: app-specific preferences.
 *
 * Copy this file to src/prefs/<yourApp>Prefs.ts when your app has settings of
 * its own (filters, layout toggles, feature flags, ...). Unlike theme — which
 * is platform-global and lives under the shared 'portfolio' appId (see
 * themePrefs.ts) — app-specific prefs use THIS app's own appId so they don't
 * collide with other apps.
 *
 * Consume it in a component with the React hook:
 *
 *   import { usePrefs } from '@wolffm/prefs-client/react'
 *   import { appPrefs } from '../prefs/exampleAppPrefs'
 *
 *   function Settings() {
 *     const { prefs, save, loading } = usePrefs(appPrefs)
 *     if (loading || !prefs) return null
 *     return (
 *       <input
 *         type="checkbox"
 *         checked={prefs.compactView ?? false}
 *         onChange={e => void save({ compactView: e.target.checked }, { scope: 'device' })}
 *       />
 *     )
 *   }
 *
 * Delete this file if your app has no settings beyond theme.
 */
import { z } from 'zod'
import { createPrefsClient } from '@wolffm/prefs-client'

export const AppPrefsSchema = z.object({
  compactView: z.boolean().optional()
})

export type AppPrefs = z.infer<typeof AppPrefsSchema>

// Replace 'study' with this app's id (matches @wolffm/<app-id>, [a-z0-9-]+).
export const appPrefs = createPrefsClient({
  appId: 'study',
  schema: AppPrefsSchema,
  defaults: { compactView: false }
})
