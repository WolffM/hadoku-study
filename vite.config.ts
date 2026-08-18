import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
        '@wolffm/prefs-client/react'
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
