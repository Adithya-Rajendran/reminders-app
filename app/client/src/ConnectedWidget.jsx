import { useEffect } from 'react'
import { WIDGET_TYPES } from './widgets/registry.jsx'
import { resolveConnections, selectCtx } from './connections.js'
import { IconCloud } from './icons.jsx'

// Capability prerequisites a widget may declare (manifest.requires) that the host
// can determine and gate on. Others (e.g. nextcloud) a widget self-handles.
export const KNOWABLE_REQUIREMENTS = new Set(['caldav'])
const REQUIREMENT_LABEL = { caldav: 'a CalDAV account', nextcloud: 'a Nextcloud account' }

// The display title for a widget instance: a type may compute one from the item
// (e.g. a group-locked list computes "Reminders · <group>"), else its static label.
export function titleFor(w) {
  const spec = WIDGET_TYPES.get(w.type)
  if (!spec) return w.type
  return spec.title ? spec.title(w) : spec.label
}

/* ---------- Per-instance lifecycle (optional registry `lifecycle` hooks) ---------- */
// Runs a widget type's optional onMount/onUnmount once per INSTANCE (keyed to w.i,
// not ctx identity, so re-memoizing a capability doesn't re-fire them). Forward-
// looking: no widget declares lifecycle hooks today, but the host supports them.
export function WidgetMount({ spec, w, ctx, children }) {
  const lifecycle = spec?.lifecycle
  useEffect(() => {
    lifecycle?.onMount?.(w, ctx)
    return () => lifecycle?.onUnmount?.(w)
  }, [w.i]) // eslint deps intentionally minimal: lifecycle is per-instance
  return children
}

/* ---------- Unmet capability requirement (manifest.requires) ---------- */
export function WidgetRequirement({ title, reqs, onOpenSettings }) {
  const what = reqs.map((r) => REQUIREMENT_LABEL[r] || r).join(' & ')
  return (
    <div className="state">
      <div className="state-ic"><IconCloud size={22} /></div>
      <div className="state-title">{title ? `${title} needs ${what}` : `Needs ${what}`}</div>
      <div className="state-sub">Connect it in Settings to use this widget.</div>
      <button className="btn primary sm" style={{ marginTop: 10 }} onClick={() => onOpenSettings?.()}>
        <IconCloud size={14} /> Open Settings
      </button>
    </div>
  )
}

/* ---------- A widget wired to the app (connections + requirement gate) ---------- */
// Auto-connect a widget's declared plugs to the app slots, hand it ONLY the connected
// interfaces (least privilege), and render its body — or the "connect it in Settings"
// placeholder when a host-knowable requirement is unmet. This is the ONE place the
// resolve→ctx→gate→render pipeline lives; the desktop grid and the mobile shell differ
// only in the CHROME around it (a draggable WidgetFrame vs the full-height mobile view),
// which stays with each caller. Both wrap this in their own WidgetBoundary + Suspense +
// WidgetSizeContext, so this component is chrome-agnostic on purpose.
export function ConnectedWidget({ w, appCtx, slots, available, onOpenSettings }) {
  const spec = WIDGET_TYPES.get(w.type)
  const { connections } = resolveConnections(spec?.plugs, slots)
  const ctx = selectCtx(appCtx, connections)
  const unmet = (spec?.requires || []).filter((r) => KNOWABLE_REQUIREMENTS.has(r) && !available.has(r))
  return (
    <WidgetMount spec={spec} w={w} ctx={ctx}>
      {unmet.length
        ? <WidgetRequirement title={titleFor(w)} reqs={unmet} onOpenSettings={onOpenSettings} />
        : spec?.render(w, ctx)}
    </WidgetMount>
  )
}
