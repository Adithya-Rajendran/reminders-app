// Unit tests for the reveal bus (client/src/revealbus.js). Pure module, plain Node.
// Run with: node test/revealbus.test.mjs
import { onRevealTask, emitRevealTask } from '../client/src/revealbus.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// subscribe → receive, with the id coerced to a string
let got = null
const off = onRevealTask((id) => { got = id })
emitRevealTask(42)
ok(got === '42', 'a handler receives the emitted id, coerced to a string')

// multiple subscribers all fire
let a = 0, b = 0
const offA = onRevealTask(() => { a++ })
const offB = onRevealTask(() => { b++ })
emitRevealTask('x')
ok(a === 1 && b === 1, 'every subscriber is notified')

// a throwing handler must not break the others
let reached = false
const offBoom = onRevealTask(() => { throw new Error('boom') })
const offAfter = onRevealTask(() => { reached = true })
emitRevealTask('y')
ok(reached === true, 'a throwing handler does not stop later handlers')

// unsubscribe stops delivery
offBoom(); offAfter(); offA(); offB()
got = null
off()
emitRevealTask('z')
ok(got === null, 'an unsubscribed handler stops receiving')

console.log(`revealbus.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
