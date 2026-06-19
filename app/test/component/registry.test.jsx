import { describe, it, expect } from 'vitest'
import { WIDGETS, WIDGET_TYPES } from '../../client/src/widgets/registry.jsx'
import { WIDGET_MANIFEST } from '../../client/src/widgets/manifest.js'

// CI gate for the manifest↔registry contract. The registry throws at import time
// if a manifest descriptor has no renderer; because registry.jsx is JSX (not
// node-importable), that guarantee only becomes a CI check here under vitest.
describe('widget registry ↔ manifest parity', () => {
  it('pairs every manifest descriptor with a renderer + icon', () => {
    expect(WIDGETS.length).toBe(WIDGET_MANIFEST.length)
    for (const w of WIDGETS) {
      expect(typeof w.render, `${w.type} render`).toBe('function')
      expect(w.icon, `${w.type} icon`).toBeTruthy()
      expect(typeof w.type).toBe('string')
      expect(typeof w.label).toBe('string')
    }
  })

  it('indexes every widget by its stable type', () => {
    expect(WIDGET_TYPES.size).toBe(WIDGET_MANIFEST.length)
    for (const m of WIDGET_MANIFEST) expect(WIDGET_TYPES.get(m.type)).toBeTruthy()
  })

  it('supports widget-contributed Settings panels', () => {
    const withPanel = WIDGETS.filter((w) => w.settingsPanel)
    expect(withPanel.length).toBeGreaterThan(0) // Notes contributes its folder panel
    for (const w of withPanel) expect(typeof w.settingsPanel).toBe('function')
  })

  it('accepts optional per-instance lifecycle hooks (when declared)', () => {
    for (const w of WIDGETS) {
      if (!w.lifecycle) continue
      if (w.lifecycle.onMount) expect(typeof w.lifecycle.onMount).toBe('function')
      if (w.lifecycle.onUnmount) expect(typeof w.lifecycle.onUnmount).toBe('function')
    }
  })
})
