// Pure interruption-tier mapping for reminder events. Run: node test/notiftier.test.mjs
import { eventTier, partitionByTier, TIERS } from '../client/src/notiftier.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// app SSE envelope shape
const envel = (name, task = {}) => ({ receivedAt: Date.now(), data: { event: { event_name: name, data: { task } } } })

ok(eventTier(envel('task.overdue')) === TIERS.BREAKTHROUGH, 'overdue -> breakthrough')
ok(eventTier(envel('task.reminder', { priority: 5 })) === TIERS.BREAKTHROUGH, 'high-priority reminder -> breakthrough')
ok(eventTier(envel('task.reminder', { priority: 4 })) === TIERS.BREAKTHROUGH, 'priority 4 reminder -> breakthrough')
ok(eventTier(envel('task.reminder', { priority: 2 })) === TIERS.ROUTINE, 'normal reminder -> routine')
ok(eventTier(envel('task.reminder')) === TIERS.ROUTINE, 'reminder with no priority -> routine')
// defensive: bare event and junk
ok(eventTier({ event_name: 'task.overdue' }) === TIERS.BREAKTHROUGH, 'bare event shape works')
ok(eventTier(null) === TIERS.ROUTINE, 'null -> routine (no throw)')

{
  const list = [envel('task.reminder', { priority: 1 }), envel('task.overdue'), envel('task.reminder', { priority: 5 })]
  const { breakthrough, routine } = partitionByTier(list)
  ok(breakthrough.length === 2 && routine.length === 1, 'partitionByTier splits by tier')
  ok(partitionByTier(null).routine.length === 0, 'partitionByTier tolerates null')
}

console.log(`\nnotiftier.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
