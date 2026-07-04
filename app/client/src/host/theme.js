// Theme preference is tri-state: 'light' | 'dark' | 'system'. The EFFECTIVE theme
// (what the <html data-theme> attribute carries, and what the CSS reads) resolves
// 'system' against the OS `prefers-color-scheme`. Keeping the preference and the
// effective theme separate is what fixes the "toggle looks broken" finding — on a
// dark-set OS, a plain light/dark toggle that starts on 'system' appeared to do
// nothing. Pure module (no React) so the framework-free node tests exercise it.

export const THEME_PREFS = ['light', 'dark', 'system']

// The OS preference right now. Defaults to 'dark' where matchMedia is unavailable
// (SSR / old runtimes) — matching the app's historical default.
export function systemTheme(mql) {
  const m = mql || (typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null)
  if (!m) return 'dark'
  return m.matches ? 'dark' : 'light'
}

// Coerce any stored/garbage value to a valid preference. Legacy stored values were
// only 'light'/'dark'; those still resolve to themselves. Anything unknown → 'dark'.
export function normalizeThemePref(v) {
  return THEME_PREFS.includes(v) ? v : 'dark'
}

// The concrete 'light'|'dark' to render for a given preference.
export function effectiveTheme(pref, mql) {
  const p = normalizeThemePref(pref)
  return p === 'system' ? systemTheme(mql) : p
}

// Cycle the visible control: light → dark → system → light.
export function nextThemePref(pref) {
  const i = THEME_PREFS.indexOf(normalizeThemePref(pref))
  return THEME_PREFS[(i + 1) % THEME_PREFS.length]
}
