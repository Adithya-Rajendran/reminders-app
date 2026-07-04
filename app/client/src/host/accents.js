// User-selectable accent colors. Applied by overriding the accent CSS vars on
// <html>; --accent-grad and everything else cascade from --accent/--accent2.
function softFromHex(hex, a = 0.16) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export const ACCENTS = [
  { key: 'indigo', name: 'Indigo', a: '#6d6cf7', b: '#a855f7' },
  { key: 'violet', name: 'Violet', a: '#8b5cf6', b: '#d946ef' },
  { key: 'blue', name: 'Blue', a: '#3b82f6', b: '#22d3ee' },
  { key: 'emerald', name: 'Emerald', a: '#10b981', b: '#34d399' },
  { key: 'amber', name: 'Amber', a: '#f59e0b', b: '#f97316' },
  { key: 'rose', name: 'Rose', a: '#f43f5e', b: '#fb7185' },
  { key: 'pink', name: 'Pink', a: '#ec4899', b: '#a855f7' },
  { key: 'cyan', name: 'Cyan', a: '#06b6d4', b: '#3b82f6' },
]

export const DEFAULT_ACCENT = 'indigo'

export function applyAccent(key) {
  const acc = ACCENTS.find((x) => x.key === key) || ACCENTS[0]
  const s = document.documentElement.style
  s.setProperty('--accent', acc.a)
  s.setProperty('--accent2', acc.b)
  s.setProperty('--accent-soft', softFromHex(acc.a, 0.16))
  return acc.key
}
