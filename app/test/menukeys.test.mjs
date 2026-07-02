// Pure roving-focus math for the mini-menu keyboard model (client/src/
// menukeys.js, consumed by widget-sdk useMenuKeyNav). Run with:
//   node test/menukeys.test.mjs
import { nextIndex, claimsKey, normalizeKey } from '../client/src/menukeys.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- nextIndex: wrap + Home/End + outside-list entry ---
ok(nextIndex('ArrowDown', 0, 3) === 1, 'down moves forward')
ok(nextIndex('ArrowDown', 2, 3) === 0, 'down wraps at the end')
ok(nextIndex('ArrowUp', 0, 3) === 2, 'up wraps at the start')
ok(nextIndex('ArrowUp', 2, 3) === 1, 'up moves backward')
ok(nextIndex('ArrowDown', -1, 3) === 0, 'entering from outside, down lands on the first item')
ok(nextIndex('ArrowUp', -1, 3) === 2, 'entering from outside, up lands on the last item')
ok(nextIndex('Home', 2, 3) === 0, 'Home jumps to the first item')
ok(nextIndex('End', 0, 3) === 2, 'End jumps to the last item')
ok(nextIndex('ArrowDown', 0, 0) === -1, 'an empty list yields no index')
ok(nextIndex('x', 1, 3) === 1, 'unclaimed keys leave the index unchanged')

// --- claimsKey: verticals always; horizontals only for radio rows ---
ok(claimsKey('ArrowDown') && claimsKey('ArrowUp') && claimsKey('Home') && claimsKey('End'), 'vertical + jump keys are claimed')
ok(!claimsKey('ArrowLeft') && !claimsKey('ArrowRight'), 'horizontal arrows unclaimed for menu rows')
ok(claimsKey('ArrowLeft', { radio: true }) && claimsKey('ArrowRight', { radio: true }), 'horizontal arrows claimed for radio rows')
ok(!claimsKey('Enter') && !claimsKey('Escape'), 'activation/dismiss keys are not claimed (handled elsewhere)')

// --- normalizeKey: radio horizontal aliases ---
ok(normalizeKey('ArrowRight') === 'ArrowDown' && normalizeKey('ArrowLeft') === 'ArrowUp', 'horizontal aliases map onto the vertical model')
ok(normalizeKey('Home') === 'Home', 'other keys pass through')

console.log(`menukeys: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
