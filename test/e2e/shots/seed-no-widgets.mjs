// Seed the "no-widgets" board: an empty widgets/layouts board, so Dashboard.jsx
// renders its "Your dashboard is empty — add a widget" card.
import { emptyBoardLayout, putLayout } from './seedlib.mjs'

await putLayout(emptyBoardLayout())
console.log('  no-widgets board saved (0 widgets)')
