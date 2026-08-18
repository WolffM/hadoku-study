/**
 * Stylelint config — catches `var(--name)` references to custom properties
 * that aren't defined anywhere. @wolffm/themes is the source of truth for
 * color/spacing/radius/etc tokens; this gate prevents typos like
 * `--color-acccent` from silently falling back to unset across themes.
 *
 * If this app declares its own non-theme vars (--scrim-*, image overlays,
 * etc.) add the file that declares them to importFrom.
 */
module.exports = {
  plugins: ['stylelint-value-no-unknown-custom-properties'],
  rules: {
    'csstools/value-no-unknown-custom-properties': [
      true,
      {
        importFrom: [
          require.resolve('@wolffm/themes/style.css'),
          // Declares --flip-card-commitment, the swipe-progress variable the
          // pointer handler writes per-frame (see src/components/FlipCard.tsx).
          require.resolve('./src/styles/index.css'),
        ],
      },
    ],
  },
}
