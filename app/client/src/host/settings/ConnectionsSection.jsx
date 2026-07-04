import { WIDGETS } from '../../widgets/registry.jsx'
import { APP_INTERFACES, describeConnections } from '../../connections.js'
import { IconLink, IconCheck, IconX } from '../../widget-sdk/icons.jsx'

// Read-only "snap connections"-style viewer of the widget interface layer: which
// interfaces the app provides (slots) and which interfaces each widget plugs into,
// with live status. App connections auto-connect and are mandatory, so there's
// nothing to toggle here — this is purely a window onto the wiring. Static data
// (the registry + the interface catalog), so it needs no server call.
// See connections.js and docs/widget-connections.md.

const SLOT_NAMES = Object.keys(APP_INTERFACES)

function PlugBadge({ c }) {
  // connected → ok; known-but-unprovided → unavailable; not in catalog → unknown.
  const status = !c.known ? 'err' : c.connected ? 'ok' : 'warn'
  const title = !c.known ? 'Unknown interface — no such app slot'
    : c.connected ? 'Connected' : 'Unavailable — no provider on this board'
  return (
    <span className={`conn-badge ${status}`} title={title}>
      {status === 'ok' && <IconCheck size={11} />}
      {status === 'err' && <IconX size={11} />}
      {c.interface}{c.optional ? ' ?' : ''}
    </span>
  )
}

export default function ConnectionsSection() {
  const report = describeConnections(WIDGETS, SLOT_NAMES)
  return (
    <div className="notes-cfg">
      <div className="notes-cfg-head"><IconLink size={16} /> <span>Widget connections</span></div>
      <div className="notes-cfg-sub">
        Like Snap connections, widgets declare the interfaces they need and the app auto-connects them.
        A widget receives only the data it plugs into.
      </div>

      <div className="conn-subhead">Provided by the app</div>
      <div className="conn-slots">
        {SLOT_NAMES.map((name) => (
          <div className="conn-slot" key={name}>
            <span className="conn-iface">{name}</span>
            <span className="conn-slot-sub" title={APP_INTERFACES[name].summary}>
              {APP_INTERFACES[name].userSummary || APP_INTERFACES[name].summary}
            </span>
          </div>
        ))}
      </div>

      <div className="conn-subhead">Widgets</div>
      <div className="conn-widgets">
        {report.map((r) => {
          const spec = WIDGETS.find((w) => w.type === r.type)
          const Ic = spec?.icon
          return (
            <div className="conn-widget" key={r.type}>
              <span className="conn-widget-name">{Ic && <Ic size={14} />} {r.label}</span>
              <span className="conn-plugs">
                {r.connections.length === 0
                  ? <span className="conn-none">no connections</span>
                  : r.connections.map((c) => <PlugBadge key={c.interface} c={c} />)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
