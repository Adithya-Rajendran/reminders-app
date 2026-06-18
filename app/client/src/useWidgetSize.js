import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import { classifySize, DEFAULT_WIDGET_SIZE } from './widgetsize.js'

// Size-responsive widgets, the reproducible way. WidgetFrame (Dashboard.jsx)
// measures each widget body once with useElementSize and broadcasts the result
// through this context; a widget reads it with useWidgetSize(). See
// docs/adding-a-widget.md and widgetsize.js for the size contract.

export const WidgetSizeContext = createContext(DEFAULT_WIDGET_SIZE)

// The current { w, h, name, width, height } descriptor for the enclosing widget.
// Outside a frame (or before the first measurement) returns DEFAULT_WIDGET_SIZE,
// so reading it never flashes an extreme size and never crashes.
export function useWidgetSize() {
  return useContext(WidgetSizeContext)
}

// Owns one ResizeObserver. Attach the returned ref to the element to measure
// (WidgetFrame attaches it to .widget-body). Returns [ref, size].
//
// The damping here is load-bearing, not incidental:
//   • border-box — a scrollbar appearing inside the body changes the CONTENT
//     box width, which would re-trigger the observer and risk a feedback loop
//     as content reflows. Border-box is unaffected by the scrollbar, so the
//     measurement is stable.
//   • requestAnimationFrame — coalesces bursts and sidesteps the browser's
//     "ResizeObserver loop completed with undelivered notifications" warning.
//   • tier-only updates — classifySize buckets px into coarse tiers and we keep
//     the previous object identity unless a tier actually changed, so a widget
//     re-renders only on a real tier transition (not on every pixel of a drag).
//   • typeof guard — jsdom / SSR have no ResizeObserver; degrade to the default.
export function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState(DEFAULT_WIDGET_SIZE)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const box = entries[0]?.borderBoxSize?.[0]
        const width = box ? box.inlineSize : (entries[0]?.contentRect?.width || el.clientWidth)
        const height = box ? box.blockSize : (entries[0]?.contentRect?.height || el.clientHeight)
        setSize((prev) => {
          const next = classifySize({ width, height })
          return (prev.w === next.w && prev.h === next.h) ? prev : next
        })
      })
    })
    ro.observe(el, { box: 'border-box' })
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])
  return [ref, size]
}
