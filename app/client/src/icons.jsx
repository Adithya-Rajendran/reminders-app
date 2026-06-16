
/* ============================================================
   Reminders — inline SVG icon set
   All thin 1.75px stroke, currentColor, ~18px default.
   Canonical Icon* named exports only — keep this file free of
   icons nothing imports.
   ============================================================ */

export const Icon = ({ d, size = 18, sw = 1.75, fill, children, label, ...rest }) => (
  <svg
    className="ic"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill || 'none'}
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
    {...rest}
  >
    {children || <path d={d} />}
  </svg>
)

export const IconGear = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
)
export const IconPlus = (p) => <Icon {...p} d="M12 5v14M5 12h14" />
export const IconX = (p) => <Icon {...p} d="M18 6 6 18M6 6l12 12" />
export const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
)
export const IconRefresh = (p) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
)
export const IconCloud = (p) => <Icon {...p} d="M17.5 19a4.5 4.5 0 0 0 .5-8.97 6 6 0 0 0-11.64-1.6A4 4 0 0 0 6.5 19z" />
export const IconCheck = (p) => <Icon {...p} d="M20 6 9 17l-5-5" />
export const IconCalendar = (p) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9h18M8 2.5v4M16 2.5v4" />
  </Icon>
)
export const IconBell = (p) => (
  <Icon {...p}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Icon>
)
export const IconSpinner = (p) => (
  <Icon {...p} className="ic spin">
    <path d="M12 2a10 10 0 0 1 10 10" />
  </Icon>
)
export const IconInbox = (p) => (
  <Icon {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Icon>
)
export const IconClock = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
)
export const IconList = (p) => (
  <Icon {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
)
export const IconNote = (p) => (
  <Icon {...p}>
    <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Icon>
)
export const IconFolder = (p) => (
  <Icon {...p}>
    <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
  </Icon>
)
export const IconSun = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
)
export const IconMoon = (p) => <Icon {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
export const IconLogout = (p) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Icon>
)
export const IconChevR = (p) => <Icon {...p} d="M9 6l6 6-6 6" />
export const IconChevL = (p) => <Icon {...p} d="M15 6l-6 6 6 6" />
export const IconChevDown = (p) => <Icon {...p} d="M6 9l6 6 6-6" />
export const IconShield = (p) => (
  <Icon {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
)
export const IconKey = (p) => (
  <Icon {...p}>
    <circle cx="7.5" cy="15.5" r="4" />
    <path d="M10.5 12.5 20 3M16 7l2.5 2.5M14 9l2.5 2.5" />
  </Icon>
)
export const IconLink = (p) => (
  <Icon {...p}>
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
)
export const IconPalette = (p) => (
  <Icon {...p}>
    <path d="M12 2a10 10 0 1 0 0 20 2.4 2.4 0 0 0 2.4-2.4c0-.66-.27-1.25-.7-1.7-.27-.3-.45-.7-.45-1.13 0-.87.7-1.57 1.57-1.57H17a5 5 0 0 0 5-5c0-4.7-4.48-8.2-10-8.2z" />
    <circle cx="8.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="13.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="17" cy="10" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
)
export const IconSearch = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
)
export const IconCornerDownLeft = (p) => <Icon {...p} d="M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4" />
export const IconSort = (p) => (
  <Icon {...p}>
    <path d="M7 4v16M7 4l-3 3M7 4l3 3" />
    <path d="M12 7h9M12 12h6M12 17h3" />
  </Icon>
)
export const IconDots = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
)
export const IconPin = (p) => (
  <Icon {...p}>
    <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6" />
  </Icon>
)
export const IconCopy = (p) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Icon>
)

// Productivity-layer marks (review / cues / habits / goals / frog / quick-win)
export const IconChart = (p) => (
  <Icon {...p}>
    <path d="M3 3v18h18" />
    <path d="M8 17v-5M13 17V8M18 17v-8" />
  </Icon>
)
export const IconCue = (p) => (
  <Icon {...p}>
    <path d="M4 12h12" />
    <path d="M13 7l5 5-5 5" />
    <circle cx="4" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </Icon>
)
export const IconFlame = (p) => (
  <Icon {...p}>
    <path d="M12 2c2.5 4 5 5.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5C10.5 7 11.5 5 12 2z" />
  </Icon>
)
export const IconTarget = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </Icon>
)
export const IconFrog = (p) => (
  <Icon {...p}>
    <circle cx="8.5" cy="8" r="2.2" />
    <circle cx="15.5" cy="8" r="2.2" />
    <path d="M4 13a8 8 0 0 0 16 0" />
    <path d="M9 17c1 1 5 1 6 0" />
  </Icon>
)
export const IconGrid = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </Icon>
)

// Provider brand-ish marks (simple, original geometry)
export const IconNextcloud = (p) => (
  <Icon {...p} sw={1.6}>
    <circle cx="12" cy="12" r="2.4" />
    <circle cx="5.5" cy="12" r="2" />
    <circle cx="18.5" cy="12" r="2" />
  </Icon>
)
export const IconApple = (p) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M16.3 12.6c0-2 1.6-3 1.7-3a3.7 3.7 0 0 0-2.9-1.6c-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7A3.9 3.9 0 0 0 6.2 10c-1.4 2.5-.4 6.2 1 8.2.7 1 1.5 2.1 2.5 2 1 0 1.4-.6 2.6-.6s1.5.6 2.6.6 1.7-1 2.4-2a8.4 8.4 0 0 0 1-2.2 3.6 3.6 0 0 1-2-3.4z" />
    <path d="M14.4 6.3a3.4 3.4 0 0 0 .8-2.4 3.5 3.5 0 0 0-2.3 1.2 3.2 3.2 0 0 0-.8 2.3 2.9 2.9 0 0 0 2.3-1.1z" />
  </Icon>
)
