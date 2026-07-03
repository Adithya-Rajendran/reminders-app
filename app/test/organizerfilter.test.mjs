// The global active-organizer-filter external store (client/src/organizerfilter.js):
// get/set/subscribe with no-op suppression. Run with: node test/organizerfilter.test.mjs
import { getOrganizerFilter, setOrganizerFilter, subscribeOrganizerFilter } from '../client/src/organizerfilter.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// default: no filter on either axis
ok(getOrganizerFilter().areaId === null && getOrganizerFilter().context === null, 'default filter is empty')

let fires = 0
const off = subscribeOrganizerFilter(() => { fires++ })

setOrganizerFilter({ areaId: 'area-1' })
ok(getOrganizerFilter().areaId === 'area-1' && getOrganizerFilter().context === null, 'setFilter sets areaId, leaves context null')
ok(fires === 1, 'a real change notifies subscribers')

setOrganizerFilter({ areaId: 'area-1' })
ok(fires === 1, 'no-op set (same value) does not notify')

setOrganizerFilter({ areaId: 'area-1', context: 'Calls' })
ok(getOrganizerFilter().context === 'Calls' && fires === 2, 'adding a context axis notifies')

setOrganizerFilter(null)
ok(getOrganizerFilter().areaId === null && getOrganizerFilter().context === null && fires === 3, 'null clears both axes and notifies')

// a throwing subscriber must not break other subscribers or the setter
subscribeOrganizerFilter(() => { throw new Error('boom') })
let healthy = 0
subscribeOrganizerFilter(() => { healthy++ })
setOrganizerFilter({ areaId: 'area-9' })
ok(healthy === 1, 'a throwing subscriber is isolated; healthy subscribers still fire')

off()
const before = fires
setOrganizerFilter({ context: 'x' })
ok(fires === before, 'unsubscribed handler stops receiving')

console.log(`\norganizerfilter.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
