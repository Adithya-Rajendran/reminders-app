// Tests for the slash-menu item filter (client/src/editor/slashItems.js). Pure
// module. Run with:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/slashitems.test.mjs
import { SLASH_ITEMS, filterSlashItems } from '../client/src/editor/slashItems.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const ids = (q) => filterSlashItems(q).map((i) => i.id)

ok(filterSlashItems('').length === SLASH_ITEMS.length, 'empty query returns all items')
ok(filterSlashItems('').map((i) => i.id).join() === SLASH_ITEMS.map((i) => i.id).join(), 'empty query keeps order')
ok(ids('tab')[0] === 'table', 'alias/prefix "tab" -> table first')
ok(ids('todo').includes('task'), '"todo" alias maps to checklist')
ok(ids('check').includes('task'), '"check" alias maps to checklist')
ok(ids('h2')[0] === 'h2', 'title prefix "h2" -> Heading 2 first')
ok(ids('note').includes('callout'), '"note" alias maps to callout')
ok(filterSlashItems('zzzzz').length === 0, 'no match -> empty')
// prefix ranks above substring: "li" prefixes nothing? "list" alias on bullet starts with li
ok(ids('list').includes('bullet'), '"list" alias maps to bullet list')

console.log(`\nslashitems.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
