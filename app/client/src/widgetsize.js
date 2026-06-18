// Pure widget size-classification — no React/DOM, so the framework-free node
// tests can exercise it (test/widgetsize.test.mjs). This is the stable contract
// every size-responsive widget reads against.
//
// Like Apple/Android home-screen widgets, our widgets change *what they show*
// (not just their scale) as they grow. Those platforms use discrete size
// families keyed on BOTH dimensions — a "small" widget isn't a shrunk "large"
// one, it's a different shape with different content. We mirror that with a 2D
// taxonomy: an independent width tier and height tier, plus a friendly 1-D name.
//
// Breakpoints (px, measured on the widget body) honor the thresholds the two
// hand-rolled adapters used before this system existed, so migrating them onto
// it preserves their behavior: CalendarWidget split at 360/540, NotesWidget at
// ~520. The grid's ~40px column pitch (see dashlayout.js) means a given grid `w`
// is ~constant pixels, so these px bands map cleanly onto grid sizes.

export const W_TIERS = ['xs', 'sm', 'md', 'lg', 'xl'] // ordered narrow -> wide
export const H_TIERS = ['xs', 'sm', 'md', 'lg']        // ordered short -> tall

// Lower-bound px for each tier (a width >= W_BREAKS[t] and < the next is tier t).
export const W_BREAKS = { xs: 0, sm: 260, md: 360, lg: 540, xl: 840 }
export const H_BREAKS = { xs: 0, sm: 180, md: 320, lg: 520 }

// Generic "which tier does `px` fall in" given an ordered tier list + its breaks.
// Walks tiers high-to-low and returns the first whose lower bound px clears.
function tierFor(px, tiers, breaks) {
  const v = Number.isFinite(px) ? px : 0
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (v >= breaks[tiers[i]]) return tiers[i]
  }
  return tiers[0]
}

export const widthTier = (px) => tierFor(px, W_TIERS, W_BREAKS)
export const heightTier = (px) => tierFor(px, H_TIERS, H_BREAKS)

// A friendly 1-D label for widgets that only need a coarse descriptor (and for
// readability in branches). Collapses the (w, h) grid into one of a few names.
export function sizeName(w, h) {
  const wi = W_TIERS.indexOf(w)
  const hi = H_TIERS.indexOf(h)
  if (wi <= 1 && hi <= 1) return 'mini'        // narrow AND short
  if (wi <= 1) return 'tall'                   // narrow but with vertical room
  if (hi <= 1) return 'wide'                   // short but with horizontal room
  if (wi >= 3 && hi >= 2) return 'large'       // roomy in both directions
  if (wi === 2 && hi === 2) return 'standard'  // the default-widget neighborhood
  return wi >= hi + 1 ? 'wide' : 'standard'
}

// The descriptor a widget consumes. Frozen so it's safe to share through context
// without a defensive copy. `width`/`height` are the raw px for the rare widget
// that needs them; most code should branch on the tiers / comparators instead.
export function classifySize({ width, height } = {}) {
  const w = widthTier(width)
  const h = heightTier(height)
  return Object.freeze({ w, h, name: sizeName(w, h), width: width || 0, height: height || 0 })
}

// Comparators so widget code reads as intent, not index math:
//   if (atLeastW(sz, 'lg')) { /* show the extra column */ }
const cmp = (tiers, a, b) => tiers.indexOf(a) - tiers.indexOf(b)
export const atLeastW = (size, tier) => cmp(W_TIERS, size?.w, tier) >= 0
export const atMostW = (size, tier) => cmp(W_TIERS, size?.w, tier) <= 0
export const atLeastH = (size, tier) => cmp(H_TIERS, size?.h, tier) >= 0
export const atMostH = (size, tier) => cmp(H_TIERS, size?.h, tier) <= 0

// Seed value before the first measurement — a real mid tier, so a widget paints
// its "standard" layout on first frame and only refines once measured (no flash
// from an extreme size, no crash for code that reads size outside a frame).
export const DEFAULT_WIDGET_SIZE = Object.freeze({ w: 'md', h: 'md', name: 'standard', width: 0, height: 0 })
