export const QUADS = [
  { k: 'Q1', label: 'Do first', sub: 'important · urgent' },
  { k: 'Q2', label: 'Schedule', sub: 'important · not urgent' },
  { k: 'Q3', label: 'Delegate', sub: 'not important · urgent' },
  { k: 'Q4', label: 'Later', sub: 'not important · not urgent' },
]

export const IMPORTANT_QUAD = { Q1: true, Q2: true, Q3: false, Q4: false }
export const URGENT_QUAD = { Q1: true, Q3: true, Q2: false, Q4: false }

export function soonDue() {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}
