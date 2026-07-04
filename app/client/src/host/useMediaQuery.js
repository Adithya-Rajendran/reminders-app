import { useCallback, useSyncExternalStore } from 'react'

// Reactive `matchMedia` match for a CSS media query, e.g. useMediaQuery('(max-width:
// 680px)'). useSyncExternalStore keeps it tear-free and SSR-safe (server snapshot =
// false). Used to switch the dashboard between the desktop grid and the mobile shell.
export function useMediaQuery(query) {
  const subscribe = useCallback((cb) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', cb)
    return () => mql.removeEventListener('change', cb)
  }, [query])
  const getSnapshot = useCallback(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
