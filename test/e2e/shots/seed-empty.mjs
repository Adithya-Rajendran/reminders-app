// Seed the "empty" board: the SAME showcase layout (all 9 widgets, same
// sizes/positions) but with no data — every widget's empty state.
import { clearTasks, clearNotes, clearEvents, showcaseLayout, putLayout } from './seedlib.mjs'

await clearTasks()
await clearNotes()
await clearEvents()
await putLayout(showcaseLayout())
console.log('  empty board saved (0 tasks, 0 notes, 0 events)')
