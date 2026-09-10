import { labelFor } from '@wolffm/catalogue'

/**
 * THE APP'S ID — the one identifier this repo states about itself. The display
 * NAME is looked up from it, so the two can never disagree. Must match the `id`
 * in hadoku_site's spec/categories.json.
 */
export const APP_ID = 'study'

/**
 * The display name, resolved at CONFIG TIME (this runs in node).
 *
 * Shared by vite.config.ts and vitest.config.ts. Both need it: `define` is a
 * build-time substitution, so a test run that does not declare it hits a bare
 * ReferenceError and the component renders NOTHING — which surfaces as an
 * unrelated-looking "unable to find element" failure, not as a missing constant.
 * That is exactly how this was found.
 */
export const APP_NAME = labelFor(APP_ID) ?? APP_ID
