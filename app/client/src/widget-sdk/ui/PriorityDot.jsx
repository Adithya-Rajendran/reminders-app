import { pdotClass, PRIORITIES } from '../../tasklib.js'

// Priority conveyed by BAR HEIGHT *and* colour — never colour alone (WCAG 1.4.1,
// use-of-colour). Three ascending bars light up from the left as priority rises, so
// a colour-blind user reads the level from the glyph's SHAPE while the hue reinforces
// it. This is the design-system fix for the old flat `.pdot` (a coloured circle whose
// only signal was its fill colour).
//
// Decorative by default: the enclosing control already carries the accessible label
// (e.g. TaskRow's "Priority: High" menu button), so the glyph is aria-hidden and adds
// no duplicate announcement. Pass `standalone` where the dot is the ONLY priority cue
// (no adjacent label) to give it its own role="img" + title.
const LIT = { p1: 3, p2: 2, p3: 1, p4: 0 } // lit bars per tier (pdotClass output)

function levelLabel(value) {
  const p = PRIORITIES.find((x) => x.v === (Number(value) || 0))
  return p ? p.label : 'None'
}

export function PriorityDot({ value = 0, standalone = false }) {
  const cls = pdotClass(value) // 'p1'..'p4'
  const lit = LIT[cls] || 0
  const label = `Priority: ${levelLabel(value)}`
  const a11y = standalone
    ? { role: 'img', 'aria-label': label, title: label }
    : { 'aria-hidden': 'true' }
  return (
    <span className={`pbars ${cls}`} {...a11y}>
      {[0, 1, 2].map((i) => <span key={i} className={`pbar${i < lit ? ' on' : ''}`} />)}
    </span>
  )
}
