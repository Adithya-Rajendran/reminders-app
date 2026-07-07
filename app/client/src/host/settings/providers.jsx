import { IconApple, IconCloud, IconLink, IconNextcloud } from '../../widget-sdk/icons.jsx'

/* Provider presets — keys are the REAL backend `type` values
   ('nextcloud' | 'icloud' | 'generic'). Field keys map straight onto the
   POST body the BFF expects ({ name, type, serverUrl, username, password }). */
export const PROVIDER_PRESETS = {
  nextcloud: {
    name: 'Nextcloud', sub: 'Self-hosted', icon: IconNextcloud,
    fields: [
      { key: 'serverUrl', label: 'Server URL', placeholder: 'https://cloud.example.com', type: 'url' },
      { key: 'username', label: 'Username', placeholder: 'alex', type: 'text' },
      {
        key: 'password', label: 'App password', placeholder: 'xxxxx-xxxxx-xxxxx', type: 'password',
        hint: 'Generate one under Settings → Security → Devices & sessions — we append /remote.php/dav automatically. Never use your login password.',
      },
    ],
  },
  icloud: {
    name: 'Apple iCloud', sub: 'iCloud', icon: IconApple,
    fields: [
      { key: 'username', label: 'Apple ID', placeholder: 'you@icloud.com', type: 'email' },
      {
        key: 'password', label: 'App-specific password', placeholder: 'xxxx-xxxx-xxxx-xxxx', type: 'password',
        hint: 'Create at appleid.apple.com → Sign-In & Security. The CalDAV URL is discovered automatically — no server URL needed. Note: only legacy (non-upgraded) Reminders lists are reachable.',
      },
    ],
  },
  generic: {
    name: 'Generic CalDAV', sub: 'Any server', icon: IconLink,
    fields: [
      { key: 'serverUrl', label: 'CalDAV URL', placeholder: 'https://dav.example.com/dav/', type: 'url' },
      { key: 'username', label: 'Username', placeholder: 'username', type: 'text' },
      {
        key: 'password', label: 'Password', placeholder: '••••••••', type: 'password',
        hint: 'Full CalDAV endpoint for Radicale, Baïkal, Fastmail, etc.',
      },
    ],
  },
}

// Identity/categorical colors for account swatches — CSS custom properties
// (styles.css, --swatch-1..7) so they follow the active theme. Previously a
// hardcoded hex array that happened to byte-match the dark theme's
// --accent/--green/--accent2/--warn/--danger, so the light theme silently
// showed dark-theme colors.
const SWATCH_COUNT = 7
export function swatchFor(key) {
  const s = String(key || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `var(--swatch-${(h % SWATCH_COUNT) + 1})`
}

function hostOf(url) {
  return (url || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
}
export function deriveName(provider, form) {
  if (provider === 'icloud') return 'Apple iCloud'
  const host = hostOf(form.serverUrl)
  if (provider === 'nextcloud') return host ? `Nextcloud — ${host}` : 'Nextcloud'
  return host ? `CalDAV — ${host}` : 'Generic CalDAV'
}

export function ProviderIcon({ type, size = 20 }) {
  const map = { nextcloud: IconNextcloud, icloud: IconApple, generic: IconLink }
  const I = map[type] || IconCloud
  return <I size={size} />
}
