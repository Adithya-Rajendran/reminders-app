// Seed the "empty" board: the SAME showcase layout (every manifest widget
// type, same sizes/positions) but with no data — every widget's empty state.
import { clearTasks, clearNotes, clearEvents, clearDailyPlan, showcaseLayout, putLayout } from './seedlib.mjs'

await clearTasks()
await clearNotes()
await clearEvents()
await clearDailyPlan()
await putLayout(showcaseLayout())
console.log('  empty board saved (0 tasks, 0 notes, 0 events, empty daily plan)')
