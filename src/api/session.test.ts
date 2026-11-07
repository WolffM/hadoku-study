/**
 * The tier ladder, and the two reads built on it (`canAuthor`, `hasIdentity`).
 *
 * `member` was missing from `TIER_RANK`/`Tier` until 2026-11-06
 * (hadoku_site#523): `tierAtLeast(tier, min)` ranks a name it does not know as
 * -1, so a floor this build had never heard of would have admitted nothing —
 * fail-closed here, but the same gap elsewhere in the fleet failed open
 * instead (hadoku-bomberman 7ff9276). `canAuthor`'s floor is `friend`, above
 * member either way, so nothing a member could do changes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canAuthor, getUserTier, hasIdentity, tierAtLeast, TIER_RANK } from './session'

// friend and everything above it, derived from the ladder rather than
// hand-typed — a tier added above friend is covered by both describe blocks
// below with no edit to either.
const FRIEND_AND_UP = Object.keys(TIER_RANK).filter(t => TIER_RANK[t] >= TIER_RANK.friend)

/** The node test environment has no localStorage. A Map is enough to be one. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear()
    }
  })
  return store
}

let store: Map<string, string>

beforeEach(() => {
  store = installStorage()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

function setTier(tier: string) {
  store.set('hadoku_user_type', tier)
}

describe('TIER_RANK', () => {
  // Pinned literally, not derived — FRIEND_AND_UP above reads tiers FROM this
  // object, so a tier quietly dropped from it would make that loop stop
  // testing that tier rather than fail. This is what actually catches that.
  it('is the complete platform ladder', () => {
    expect(TIER_RANK).toEqual({
      public: 0,
      member: 1,
      friend: 2,
      service: 3,
      wife: 4,
      admin: 5
    })
  })
})

describe('tierAtLeast', () => {
  it('ranks public < member < friend < service < wife < admin', () => {
    expect(tierAtLeast('member', 'public')).toBe(true)
    expect(tierAtLeast('public', 'member')).toBe(false)
    expect(tierAtLeast('friend', 'member')).toBe(true)
    expect(tierAtLeast('member', 'friend')).toBe(false)
    expect(tierAtLeast('service', 'member')).toBe(true)
  })

  it('admits a tier at or above the floor', () => {
    expect(tierAtLeast('member', 'member')).toBe(true)
    expect(tierAtLeast('admin', 'member')).toBe(true)
  })

  it('never lets a name the ladder does not know clear any floor', () => {
    expect(tierAtLeast('superuser', 'member')).toBe(false)
    expect(tierAtLeast(null, 'member')).toBe(false)
    expect(tierAtLeast(undefined, 'member')).toBe(false)
  })
})

describe('canAuthor — friend and up only', () => {
  it('is false for a member, exactly as for public', () => {
    setTier('member')
    expect(canAuthor()).toBe(false)
  })

  it('is true for friend and everything above it', () => {
    for (const tier of FRIEND_AND_UP) {
      setTier(tier)
      expect(canAuthor()).toBe(true)
    }
  })

  it('is false signed out', () => {
    expect(getUserTier()).toBeNull()
    expect(canAuthor()).toBe(false)
  })
})

describe('hasIdentity — any signed-in tier', () => {
  it('is true for a member: a member has a registry userId', () => {
    setTier('member')
    expect(hasIdentity()).toBe(true)
  })

  it('is true for every tier above public', () => {
    for (const tier of FRIEND_AND_UP) {
      setTier(tier)
      expect(hasIdentity()).toBe(true)
    }
  })

  it('is false for public and signed out', () => {
    setTier('public')
    expect(hasIdentity()).toBe(false)
    store.clear()
    expect(hasIdentity()).toBe(false)
  })
})
