import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { applyAccent, DEFAULT_ACCENT } from './accents.js'
import { effectiveTheme, normalizeThemePref } from './theme.js'

// Apply persisted theme + accent before first paint to avoid a flash. The stored
// preference may be 'system', which resolves to the OS's current scheme here.
document.documentElement.setAttribute('data-theme', effectiveTheme(normalizeThemePref(localStorage.getItem('reminders-theme'))))
applyAccent(localStorage.getItem('reminders-accent') || DEFAULT_ACCENT)

createRoot(document.getElementById('root')).render(<App />)
