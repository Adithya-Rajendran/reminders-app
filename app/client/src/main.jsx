import { createRoot } from 'react-dom/client'
import App from './host/App.jsx'
import './styles.css'
// The widget primitive vocabulary (wg-eyebrow/wg-card/wg-stat/…, see
// widget-sdk/ui/primitives.css). Widgets are lazy chunks (registry.jsx), so
// importing this from widget-sdk's own barrel wouldn't guarantee it's loaded
// before the FIRST widget paints on a cold board — importing it here, next
// to styles.css, does: the host loads it eagerly at boot, before any widget
// chunk is requested.
import './widget-sdk/ui/primitives.css'
import { applyAccent, DEFAULT_ACCENT } from './host/accents.js'
import { effectiveTheme, normalizeThemePref } from './host/theme.js'
import { applyPalette, paletteFor, DEFAULT_PALETTE } from './host/palettes.js'

// Apply persisted theme + palette + accent before first paint to avoid a flash.
// The stored theme preference may be 'system', which resolves to the OS's
// current scheme here. Palette is applied BEFORE accent, and the accent
// fallback below reads the resolved palette's defaultAccent (not the global
// DEFAULT_ACCENT) — mirrors App.jsx's own state-init fallback exactly, so
// this pre-paint color and the first render agree (see host/App.jsx's accent
// useState comment for the "silent default-revert" bug this shape avoids).
document.documentElement.setAttribute('data-theme', effectiveTheme(normalizeThemePref(localStorage.getItem('reminders-theme'))))
const paletteKey = applyPalette(localStorage.getItem('reminders-palette') || DEFAULT_PALETTE)
applyAccent(localStorage.getItem('reminders-accent') || paletteFor(paletteKey).defaultAccent || DEFAULT_ACCENT)

createRoot(document.getElementById('root')).render(<App />)
