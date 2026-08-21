import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { logger } from '@wolffm/logger/client'
import { AppHeader, LoadingSkeleton } from '@wolffm/task-ui-components'
import { HadokuThemeRoot, useHadokuTheme } from '@wolffm/themes'
import { usePrefs } from '@wolffm/prefs-client/react'
import type { StudyProps } from './entry'
import { createClient } from './api/client'
import { canAuthor as canAuthorNow, hasIdentity } from './api/session'
import { studyPrefs } from './prefs/studyPrefs'
import { useRoute } from './state/useRoute'
import { Gallery } from './views/Gallery'
import { SetPage } from './views/SetPage'
import { Editor } from './views/Editor'

/** Where the API lives when the registry does not say otherwise. Same-origin
 *  through edge-router, which is what makes cookie auth work at all. */
const DEFAULT_API_BASE = '/study/api'

/**
 * Provider boundary.
 *
 * Theming belongs to the platform, not to your app. `<HadokuThemeRoot>` owns the
 * theme state, its persistence (session + local + cross-device prefs) and the
 * theme picker; do NOT add a local `hooks/useTheme.ts`, `prefs/themePrefs.ts` or
 * `app/themeConfig.tsx`. Every app used to carry copies of those three, they
 * drifted apart, and the differences were real bugs — one persisted the theme
 * across a browser restart and the rest silently lost it.
 *
 * `containerRef` is created here and passed down because the provider needs it
 * (to mirror `data-theme` onto your mount subtree) while the element it points
 * at is rendered below.
 */
export default function App(props: StudyProps = {}) {
  const containerRef = useRef<HTMLElement>(null)
  return (
    <HadokuThemeRoot theme={props.theme} containerRef={containerRef}>
      <AppInner containerRef={containerRef} apiBaseUrl={props.apiBaseUrl} />
    </HadokuThemeRoot>
  )
}

function AppInner({
  containerRef,
  apiBaseUrl
}: {
  containerRef: RefObject<HTMLElement | null>
  apiBaseUrl?: string
}) {
  const { isDarkTheme, isThemeReady, isInitialThemeLoad } = useHadokuTheme()

  const client = useMemo(() => createClient(apiBaseUrl ?? DEFAULT_API_BASE), [apiBaseUrl])
  const [route, navigate] = useRoute()
  const [creating, setCreating] = useState(false)

  // Read once per mount rather than per render: the tier cannot change without
  // a page load, and re-reading localStorage in a render path is noise.
  const canAuthor = useMemo(canAuthorNow, [])
  const syncEnabled = useMemo(hasIdentity, [])

  const { prefs, save } = usePrefs(studyPrefs)
  const shuffle = prefs?.shuffle ?? false

  const openSet = useCallback((setId: string) => navigate({ setId, playing: null }), [navigate])
  const goHome = useCallback(() => {
    setCreating(false)
    navigate({ setId: null, playing: null })
  }, [navigate])

  // Gate the first paint so the theme is applied before anything renders.
  if (isInitialThemeLoad && !isThemeReady) {
    return <LoadingSkeleton isDarkTheme={isDarkTheme} />
  }

  // Playing takes the whole screen, whichever game it is. The header's controls
  // are worth their space everywhere else, but a phone mid-game should spend
  // every pixel on the content and on the buttons under a thumb.
  const fullscreen = route.setId !== null && route.playing !== null

  return (
    <main
      ref={containerRef}
      className="study-container"
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
      data-fullscreen={fullscreen ? 'true' : 'false'}
    >
      <div className="study">
        {!fullscreen && (
          <AppHeader title="Study">
            <label className="pref-row">
              <input
                type="checkbox"
                checked={shuffle}
                onChange={e => {
                  // `preference()` is the logger's own helper for this, so a
                  // settings change is a typed event rather than a log line
                  // shaped like one.
                  logger.preference('shuffle', e.target.checked)
                  void save({ shuffle: e.target.checked })
                }}
              />
              <span>Shuffle cards when studying</span>
            </label>
          </AppHeader>
        )}

        <section className="study__content">
          {creating ? (
            <Editor
              client={client}
              existing={null}
              onSaved={set => {
                setCreating(false)
                openSet(set.id)
              }}
              onCancel={() => setCreating(false)}
            />
          ) : route.setId !== null ? (
            <SetPage
              client={client}
              setId={route.setId}
              playing={route.playing}
              syncEnabled={syncEnabled}
              shuffle={shuffle}
              onPlay={gameId => navigate({ setId: route.setId, playing: gameId })}
              onLeavePlay={() => navigate({ setId: route.setId, playing: null })}
              onBack={goHome}
              onDeleted={goHome}
            />
          ) : (
            <Gallery
              client={client}
              canAuthor={canAuthor}
              onOpen={openSet}
              onCreate={() => setCreating(true)}
            />
          )}
        </section>
      </div>
    </main>
  )
}
