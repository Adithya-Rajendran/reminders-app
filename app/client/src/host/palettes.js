// User-selectable theme presets ("palettes"). Mechanism mirrors host/theme.js's
// [data-theme] attribute, NOT host/accents.js's inline-style overrides: each
// preset is a `[data-palette="<key>"]` token-override block in styles.css (a
// dark base + a `[data-palette="<key>"][data-theme="light"]` companion for
// light mode) — see the "Theme presets" section near the top of styles.css.
// Wave 1/2 tokenized nearly everything a preset needs to touch (surfaces,
// lines, text, status, glows, radii, glass, fonts), so a preset can faithfully
// restore a prior visual identity instead of being a shallow accent recolor.
//
// The current "Paper Planner" copper look is the DEFAULT and carries NO
// data-palette attribute — same "unmarked value is the base state" shape as
// [data-theme="dark"] being implicit. That means a fresh install with no
// stored preference needs no extra CSS lookup or attribute at all.

export const PALETTES = [
  // First = default. No CSS block of its own — styles.css's plain
  // :root/[data-theme] rules ARE this preset.
  { key: 'paper', name: 'Paper Planner', defaultAccent: 'copper', preview: { a: '#1d1712', b: '#c07a45' } },
  // Pre-Wave-2 look (indigo glass), restored from git history — see
  // styles.css's [data-palette="classic"] block for the source commit.
  { key: 'classic', name: 'Classic Indigo', defaultAccent: 'indigo', preview: { a: '#161a2e', b: '#6d6cf7' } },
  // "Flight-deck" refresh: solid cool-navy panels, minimal glow, a single
  // flat indigo (not the two-tone gradient) — see [data-palette="instrument"].
  { key: 'instrument', name: 'Instrument', defaultAccent: 'indigo-flat', preview: { a: '#131829', b: '#6d6cf7' } },
  // Deep-space base with a translucent aurora wash — see [data-palette="aurora"].
  { key: 'aurora', name: 'Aurora', defaultAccent: 'indigo', preview: { a: '#161a2e', b: '#a855f7' } },
]

export const DEFAULT_PALETTE = 'paper'

export function paletteFor(key) {
  return PALETTES.find((p) => p.key === key) || PALETTES[0]
}

// Sets/removes [data-palette] on <html> and persists the choice, so a bare
// `applyPalette(key)` (e.g. the pre-paint call in main.jsx) is a complete,
// idempotent "set the preset" operation — unlike applyAccent (inline style,
// no persistence of its own; App.jsx's effect persists that one instead),
// this one owns its own persistence per the palette contract.
export function applyPalette(key) {
  const p = paletteFor(key)
  if (p.key === DEFAULT_PALETTE) document.documentElement.removeAttribute('data-palette')
  else document.documentElement.setAttribute('data-palette', p.key)
  localStorage.setItem('reminders-palette', p.key)
  return p.key
}
