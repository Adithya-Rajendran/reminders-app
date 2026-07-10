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

// Apply persisted theme + accent before first paint to avoid a flash. The stored
// preference may be 'system', which resolves to the OS's current scheme here.
document.documentElement.setAttribute('data-theme', effectiveTheme(normalizeThemePref(localStorage.getItem('reminders-theme'))))
applyAccent(localStorage.getItem('reminders-accent') || DEFAULT_ACCENT)

createRoot(document.getElementById('root')).render(<App />)
