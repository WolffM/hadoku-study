import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Dev only — the built bundle is mounted by hadoku_site, which serves
  // /study/api from the same origin. Without this, `pnpm dev` cannot reach the
  // API at all and every view renders its error state, which makes the harness
  // useless for anything but static layout. Reads of published sets work
  // signed-out; writes need a session the dev server does not have.
  server: {
    proxy: {
      '/study/api': {
        target: 'https://hadoku.me',
        changeOrigin: true
      }
    }
  },
  build: {
    lib: {
      entry: 'src/entry.tsx',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      // Externalize peer dependencies (parent provides them via import map)
      // Provided by the parent page's import map (hadoku_site
      // src/layouts/Base.astro). Every one of these is a SINGLETON: React and
      // the theme context match on module identity, and the logger and prefs
      // client each hold their own cache. Inlining one gives the page a second
      // copy the first never talks to — which is how two apps threw
      // "No <HadokuThemeRoot> above this component" on 2026-08-05 with the
      // provider plainly mounted.
      // Enforced fleet-wide by hadoku_site's `pnpm run check:mf-externals`.
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@wolffm/themes',
        '@wolffm/task-ui-components',
        '@wolffm/logger/client',
        '@wolffm/prefs-client',
        '@wolffm/prefs-client/react',
        // zod is in the parent's import map too (esm.sh/zod@4), because
        // @wolffm/themes depends on it directly. It arrives here through
        // @wolffm/prefs-client's schema API, which takes a zod schema as a
        // VALUE — so an inlined copy would not throw, it would just ship ~100 kB
        // of a module the page has already loaded. The rule is mechanical:
        // anything in the import map that you import is external, whether or
        // not it is a singleton.
        'zod'
      ],
      output: {
        assetFileNames: 'style.css'
      }
    },
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: false
  }
})
