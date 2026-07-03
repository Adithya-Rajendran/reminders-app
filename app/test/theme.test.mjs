// Unit tests for the tri-state theme resolver (client/src/theme.js). Pure module,
// plain Node. Run with: node test/theme.test.mjs
import { THEME_PREFS, systemTheme, normalizeThemePref, effectiveTheme, nextThemePref } from '../client/src/theme.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- normalize (legacy + garbage tolerance) ----
ok(normalizeThemePref('light') === 'light' && normalizeThemePref('dark') === 'dark' && normalizeThemePref('system') === 'system', 'valid prefs pass through')
ok(normalizeThemePref('') === 'dark' && normalizeThemePref(null) === 'dark' && normalizeThemePref('bogus') === 'dark', 'unknown/empty preference falls back to dark')

// ---- systemTheme (inject a matchMedia-like object so it's deterministic) ----
ok(systemTheme({ matches: true }) === 'dark', 'system = dark when the OS prefers dark')
ok(systemTheme({ matches: false }) === 'light', 'system = light when the OS prefers light')
ok(systemTheme(null) === 'dark', 'no matchMedia available → dark default')

// ---- effectiveTheme ----
ok(effectiveTheme('light') === 'light', 'light → light')
ok(effectiveTheme('dark') === 'dark', 'dark → dark')
ok(effectiveTheme('system', { matches: true }) === 'dark', 'system resolves to the OS dark scheme')
ok(effectiveTheme('system', { matches: false }) === 'light', 'system resolves to the OS light scheme')
ok(effectiveTheme('bogus') === 'dark', 'a garbage preference resolves to dark')

// ---- cycle ----
ok(nextThemePref('light') === 'dark' && nextThemePref('dark') === 'system' && nextThemePref('system') === 'light', 'cycles light → dark → system → light')
ok(nextThemePref('bogus') === 'system', 'cycling from a garbage pref (normalized to dark) → system')
ok(THEME_PREFS.length === 3, 'exactly three preferences')

console.log(`\ntheme.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
