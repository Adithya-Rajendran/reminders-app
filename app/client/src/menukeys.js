// Pure roving-focus index math for menu/radio popovers (consumed by the
// widget-sdk useMenuKeyNav hook). Kept DOM-free so the framework-free node
// tests can pin the wrap/Home/End semantics (test/menukeys.test.mjs).

// The next focus index for a key, wrapping at both ends. `current` is -1 when
// focus is outside the list (first arrow press lands on an end).
export function nextIndex(key, current, length) {
  if (length <= 0) return -1
  const wrap = (n) => (n + length) % length
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : wrap(current + 1)
    case 'ArrowUp': return current < 0 ? length - 1 : wrap(current - 1)
    case 'Home': return 0
    case 'End': return length - 1
    default: return current
  }
}

// Keys the hook claims (and preventDefaults) when the menu is open. Left/Right
// alias Up/Down only for radio-style rows (e.g. the dread dots), where
// horizontal arrows are what a user expects.
export function claimsKey(key, { radio = false } = {}) {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return true
  return radio && (key === 'ArrowLeft' || key === 'ArrowRight')
}

// Map the radio aliases onto the vertical model before nextIndex.
export function normalizeKey(key) {
  if (key === 'ArrowRight') return 'ArrowDown'
  if (key === 'ArrowLeft') return 'ArrowUp'
  return key
}
