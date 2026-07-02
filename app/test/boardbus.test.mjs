// The board bus (client/src/boardbus.js): publish/subscribe of the current
// board + the go-to-widget channel. Run with: node test/boardbus.test.mjs
import { publishBoard, onBoard, getBoard, onGoToWidget, flashWidget } from '../client/src/boardbus.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- board publish/subscribe ---
const seen = []
const offBoard = onBoard((b) => seen.push(b))
publishBoard([{ i: 'w-1', title: 'Calendar' }])
ok(getBoard().length === 1 && getBoard()[0].title === 'Calendar', 'getBoard returns the published board')
ok(seen.length === 1, 'subscribers hear a publish')
publishBoard(null)
ok(getBoard().length === 0, 'non-array publish clears to empty')
offBoard()
publishBoard([{ i: 'w-2', title: 'Notes' }])
ok(seen.length === 2, 'unsubscribed handlers stop receiving')

// --- go-to channel + dead-handler isolation ---
const gone = []
onGoToWidget(() => { throw new Error('dead handler') })
const offGo = onGoToWidget((id) => gone.push(id))
flashWidget('w-9')
ok(gone.join() === 'w-9', 'a throwing handler does not break the others')
offGo()
flashWidget('w-10')
ok(gone.join() === 'w-9', 'go-to unsubscribe works')

console.log(`boardbus: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
