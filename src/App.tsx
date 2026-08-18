import { useRef, type RefObject } from 'react'
import { AppHeader, LoadingSkeleton } from '@wolffm/task-ui-components'
import { HadokuThemeRoot, useHadokuTheme } from '@wolffm/themes'
import type { StudyProps } from './entry'

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
      <AppInner containerRef={containerRef} />
    </HadokuThemeRoot>
  )
}

function AppInner({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const { isDarkTheme, isThemeReady, isInitialThemeLoad } = useHadokuTheme()

  // Gate the first paint so the theme is applied before anything renders.
  if (isInitialThemeLoad && !isThemeReady) {
    return <LoadingSkeleton isDarkTheme={isDarkTheme} />
  }

  return (
    <main
      ref={containerRef}
      className="study-container"
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
    >
      <div className="study">
        {/*
          The ecosystem header. It renders the theme picker AND the settings gear
          itself — neither is a prop, so every app gets the same controls.

          Your app's own preferences go in `children`, where they appear inside
          the settings popout beneath the four canonical rows (access tier,
          display name, content visibility, access key). That slot is
          unconstrained; what it cannot do is change the rows above it.
        */}
        <AppHeader title="Study" />

        <section className="study__content">
          <p>Your app goes here.</p>
        </section>
      </div>
    </main>
  )
}
