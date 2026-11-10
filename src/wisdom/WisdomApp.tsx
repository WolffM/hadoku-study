import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { AppHeader, LoadingSkeleton } from '@wolffm/task-ui-components'
import { useHadokuTheme } from '@wolffm/themes'
import { POOL, type Wisdom } from './pool'
import { TRADITIONS, traditionById, type Tradition } from './traditions'
import { litTraditions, pickElsewhere, pickFrom } from './pick'
import { WisdomMap } from './WisdomMap'

/**
 * /wisdom — the same bundle as /study, mounted at a second route (App.tsx
 * branches on `basename`). Everything it shows is static: the pool is a file in
 * this repo, so there is no API, no loading state and nothing to fail.
 */

const PARAM = 'w'

function fromUrl(): Wisdom | undefined {
  const id = new URLSearchParams(window.location.search).get(PARAM)
  return POOL.find(w => w.id === id)
}

/**
 * The URL always names the passage on screen, so it can be copied and shared.
 * `replaceState`, not `pushState`: a reader drawing ten passages should not
 * need ten presses of Back to leave the page.
 */
function toUrl(entry: Wisdom): void {
  const url = new URL(window.location.href)
  url.searchParams.set(PARAM, entry.id)
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

export function WisdomApp({
  containerRef,
  appName
}: {
  containerRef: RefObject<HTMLElement | null>
  appName?: string
}) {
  const { isDarkTheme, isThemeReady, isInitialThemeLoad } = useHadokuTheme()
  const lit = useMemo(() => litTraditions(POOL), [])
  const [entry, setEntry] = useState<Wisdom | undefined>(
    () => fromUrl() ?? pickElsewhere(POOL, null)
  )
  const [peeking, setPeeking] = useState<Tradition | null>(null)

  useEffect(() => {
    if (entry) toUrl(entry)
  }, [entry])

  const elsewhere = useCallback(() => {
    setPeeking(null)
    setEntry(cur => pickElsewhere(POOL, cur ?? null) ?? cur)
  }, [])

  const choose = useCallback(
    (t: Tradition) => {
      if (!lit.has(t.id)) {
        setPeeking(p => (p?.id === t.id ? null : t))
        return
      }
      setPeeking(null)
      setEntry(cur => pickFrom(POOL, t.id, cur ?? null) ?? cur)
    },
    [lit]
  )

  const goTo = useCallback((id: string) => {
    const next = POOL.find(w => w.id === id)
    if (next) {
      setPeeking(null)
      setEntry(next)
    }
  }, [])

  if (isInitialThemeLoad && !isThemeReady) {
    return <LoadingSkeleton isDarkTheme={isDarkTheme} />
  }

  const tradition = entry ? traditionById(entry.tradition) : undefined
  const moreHere = entry ? POOL.filter(w => w.tradition === entry.tradition).length > 1 : false
  // With one tradition lit, "another tradition" has nowhere to go — say so
  // rather than offer a button that does nothing.
  const elsewhereExists = lit.size > 1

  return (
    <main
      ref={containerRef}
      className="study-container wisdom-container"
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
    >
      <div className="wisdom">
        <AppHeader title={appName ?? 'Wisdom'} />

        <section className="wisdom__stage">
          <WisdomMap
            lit={lit}
            active={entry?.tradition ?? null}
            peeking={peeking?.id ?? null}
            onPickTradition={choose}
            onPickElsewhere={elsewhere}
          />
          <p className="wisdom__journey" aria-live="polite">
            {peeking ? (
              <>
                <strong>{peeking.name}</strong> — {peeking.blurb}. Not yet studied.
              </>
            ) : (
              <>
                {lit.size} of {TRADITIONS.length} traditions lit ·{' '}
                {elsewhereExists ? 'tap the light for another' : 'the rest are still to be studied'}
              </>
            )}
          </p>
        </section>

        {entry && tradition && (
          // Keyed by entry so each new passage fades in rather than swapping text in place.
          <article key={entry.id} className="wisdom-card" aria-live="polite">
            <header className="wisdom-card__tradition">
              <span className="wisdom-card__name">{tradition.name}</span>
              <span className="wisdom-card__blurb">{tradition.blurb}</span>
            </header>

            <blockquote className="wisdom-card__text">
              {entry.text.split(/\n\s*\n/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </blockquote>

            <p className="wisdom-card__source">
              {entry.source}
              {entry.translation && (
                <span className="wisdom-card__translation"> · {entry.translation}</span>
              )}
            </p>

            {entry.note && <p className="wisdom-card__note">{entry.note}</p>}

            {entry.bridges && entry.bridges.length > 0 && (
              <nav className="wisdom-card__bridges" aria-label="Bridges to other traditions">
                <span className="wisdom-card__bridges-label">Bridges</span>
                {entry.bridges.map(id => {
                  const target = POOL.find(w => w.id === id)
                  if (!target) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => goTo(id)}
                    >
                      {traditionById(target.tradition)?.name ?? target.tradition} — {target.source}
                    </button>
                  )
                })}
              </nav>
            )}

            {(elsewhereExists || moreHere) && (
              <div className="wisdom-card__actions">
                {elsewhereExists && (
                  <button type="button" className="btn btn--primary" onClick={elsewhere}>
                    Another tradition
                  </button>
                )}
                {moreHere && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => choose(tradition)}
                  >
                    More from {tradition.name}
                  </button>
                )}
              </div>
            )}
          </article>
        )}
      </div>
    </main>
  )
}
