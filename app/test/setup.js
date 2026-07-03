import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom ships neither ResizeObserver nor matchMedia. Widgets read element size via
// useElementSize (ResizeObserver) and theme/density via media queries; with no-op
// shims they degrade to the default (md/md) tier rather than throwing, which is the
// documented test-time contract (see docs/widget-sdk.md).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub

// jsdom implements no layout, so Element.scrollIntoView is absent — components that
// keep an active row in view (the command palette, menus) call it in an effect. A
// no-op shim lets them mount without throwing.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false },
  })
}

afterEach(() => cleanup())
