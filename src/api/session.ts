/**
 * Who the browser thinks it is.
 *
 * The CANONICAL platform keys, and only those: `hadoku_session_id` and
 * `hadoku_user_type` in localStorage, written by hadoku_site's mf-loader. An
 * app-local `studySessionId` would be a second answer to a question the
 * platform already answers, and the two would drift.
 *
 * Nothing here is a security boundary. The real gate is edge-router resolving
 * the caller's cookie to a key and stamping `X-Hadoku-Tier` / `X-User-Id`
 * under a provenance seal the browser cannot forge. This module only decides
 * which controls to RENDER — a user who lies to it sees a Create button and
 * gets a 403 from the worker.
 */

export type Tier = 'public' | 'friend' | 'service' | 'wife' | 'admin'

/**
 * `public < friend < service < wife < admin`.
 *
 * Compared by RANK, never by equality. `userType === 'friend'` locks out every
 * tier above friend, which is the bug that has shipped twice in this
 * ecosystem — here it would hide the editor from admins.
 *
 * An unknown tier (an older bundle meeting a newer tier name) ranks -1 and is
 * admitted nowhere. That is fail-closed on purpose.
 */
const TIER_RANK: Record<string, number> = {
  public: 0,
  friend: 1,
  service: 2,
  wife: 3,
  admin: 4
}

export function tierAtLeast(tier: string | null | undefined, min: Tier): boolean {
  if (!tier) return false
  const rank = TIER_RANK[tier] ?? -1
  return rank >= TIER_RANK[min]
}

export function getUserTier(): Tier | null {
  try {
    return (localStorage.getItem('hadoku_user_type') as Tier | null) ?? null
  } catch {
    // Private-mode Safari throws on localStorage access. Signed-out is the
    // correct fallback: it hides authoring controls and leaves reading intact.
    return null
  }
}

export function getSessionId(): string | null {
  try {
    return localStorage.getItem('hadoku_session_id')
  } catch {
    return null
  }
}

/** Friend and up may create or modify sets. */
export function canAuthor(): boolean {
  return tierAtLeast(getUserTier(), 'friend')
}

/**
 * Whether the server can hold this reader's progress.
 *
 * Any tier with a session has a registry identity behind it, so this is the
 * same question as "is anyone signed in" — progress is gated on identity, not
 * on tier, because it is private data about a set the reader can already see.
 */
export function hasIdentity(): boolean {
  const tier = getUserTier()
  return tier !== null && tier !== 'public'
}
