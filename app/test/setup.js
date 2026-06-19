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
