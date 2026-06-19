import { describe, it, expect, beforeEach } from 'vitest'
import { widgetStore } from '../../client/src/widget-sdk'

// P3: device-local UI state is namespaced per widget instance, with a one-time
// fallback to the pre-namespacing global key so existing state survives the
// upgrade. jsdom provides a real localStorage, so this exercises the actual paths.
describe('widgetStore(instanceId)', () => {
  beforeEach(() => localStorage.clear())

  it('namespaces keys per instance — two instances stay independent', () => {
    const a = widgetStore('w-1')
    const b = widgetStore('w-2')
    a.saveJson('view', 'matrix')
    b.saveJson('view', 'frog')
    expect(a.loadJson('view', null)).toBe('matrix')
    expect(b.loadJson('view', null)).toBe('frog')
    expect(localStorage.getItem('w:w-1:view')).toBeTruthy()
  })

  it('returns the fallback when nothing is stored', () => {
    const s = widgetStore('w-x')
    expect(s.loadJson('missing', 'def')).toBe('def')
    expect(s.loadStringSet('missing').size).toBe(0)
  })

  it('round-trips a string set under the instance namespace', () => {
    const s = widgetStore('w-7')
    s.saveStringSet('collapsed', new Set(['Work', 'Home']))
    expect([...s.loadStringSet('collapsed')].sort()).toEqual(['Home', 'Work'])
    expect(localStorage.getItem('w:w-7:collapsed')).toBeTruthy()
  })

  it('falls back once to the legacy global key, then the scoped write wins', () => {
    localStorage.setItem('frog-pick', JSON.stringify({ id: 5 })) // pre-upgrade global
    const s = widgetStore('w-1')
    expect(s.loadJson('frog-pick', null)).toEqual({ id: 5 })     // migration read
    s.saveJson('frog-pick', { id: 9 })                            // first scoped write
    expect(s.loadJson('frog-pick', null)).toEqual({ id: 9 })     // scoped now wins
    expect(JSON.parse(localStorage.getItem('frog-pick'))).toEqual({ id: 5 }) // legacy untouched
  })
})
