import { useCallback, useEffect, useState, Suspense } from 'react'
import { WIDGET_TYPES } from './widgets/registry.jsx'
import { ConnectedWidget } from './ConnectedWidget.jsx'
import { BoardFilterBar } from './BoardFilterBar.jsx'
import { useElementSize, WidgetSizeContext } from './useWidgetSize.js'
import WidgetBoundary from './widgets/WidgetBoundary.jsx'
import { SkeletonRows } from './widget-sdk'
import { loadJson, saveJson } from './storage.js'
import { publishBoard, onGoToWidget, onAddWidget } from './boardbus.js'
import { IconPlus, IconList } from './icons.jsx'

// The mobile spine: one surface per tab, in the workflow order.
const MOBILE_TABS = [
  { key: 'today', type: 'overview', label: 'Today' },
  { key: 'inbox', type: 'inbox', label: 'Inbox' },
  { key: 'calendar', type: 'calendar', label: 'Calendar' },
  { key: 'notes', type: 'notes', label: 'Notes' },
  { key: 'review', type: 'review', label: 'Review' },
]

// The mobile shell: one spine surface at a time with a bottom tab bar and a capture
// FAB (capture-first), reusing the EXACT widget render + connection machinery (the
// shared ConnectedWidget) — each tab is a full-height canonical widget, connected to
// the same app slots as on the grid. Desktop keeps the composable grid; this only
// renders below the breakpoint.
export function MobileShell({ appCtx, slots, available, organizerCap, onOpenSettings, onCapture, dashboardId }) {
  const [tab, setTab] = useState(() => loadJson('reminders-mtab-' + dashboardId, 'today'))
  const pick = useCallback((k) => { setTab(k); saveJson('reminders-mtab-' + dashboardId, k) }, [dashboardId])
  const [viewRef, size] = useElementSize()

  // Own the omnibox nav on mobile: publish the spine tabs as the "board" (so the
  // palette reflects THIS view, not the hidden grid), and route "Go to <surface>"
  // (flashWidget 'm-<type>') and "Add <surface>" (emitAddWidget '<type>') to switch
  // the active TAB. Non-spine types have no mobile surface and no-op (rather than
  // silently mutating/persisting the unmounted desktop grid).
  const goToType = useCallback((idOrType) => {
    const t = MOBILE_TABS.find((x) => x.type === idOrType || 'm-' + x.type === idOrType)
    if (t) pick(t.key)
  }, [pick])
  useEffect(() => {
    publishBoard(MOBILE_TABS.map((t) => ({ i: 'm-' + t.type, title: t.label, type: t.type })))
    return () => publishBoard([])
  }, [])
  useEffect(() => onGoToWidget(goToType), [goToType])
  useEffect(() => onAddWidget(goToType), [goToType])
  const active = MOBILE_TABS.find((t) => t.key === tab) || MOBILE_TABS[0]
  // Each tab is a full-height canonical widget (no group/config), wired to the same
  // app slots as on the grid via the shared ConnectedWidget.
  const w = { i: 'm-' + active.type, type: active.type }
  return (
    <div className="mobile-shell">
      <BoardFilterBar organizer={organizerCap} />
      <div className="mobile-view" ref={viewRef} data-wsize={size.w} data-hsize={size.h}>
        <WidgetSizeContext.Provider value={size}>
          <WidgetBoundary key={active.type}>
            <Suspense fallback={<SkeletonRows n={6} />}>
              <ConnectedWidget w={w} appCtx={appCtx} slots={slots} available={available} onOpenSettings={onOpenSettings} />
            </Suspense>
          </WidgetBoundary>
        </WidgetSizeContext.Provider>
      </div>
      <button className="mobile-fab" aria-label="Capture a task" title="Capture a task" onClick={() => onCapture?.()}>
        <IconPlus size={24} />
      </button>
      <nav className="mobile-tabbar" aria-label="Views">
        {MOBILE_TABS.map((t) => {
          const Ic = WIDGET_TYPES.get(t.type)?.icon || IconList
          const on = t.key === tab
          return (
            <button key={t.key} type="button" className={`mobile-tab${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => pick(t.key)}>
              <Ic size={20} />
              <span className="mobile-tab-label">{t.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
