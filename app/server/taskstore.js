// Selects the task/project/label backend at boot. Same 9-handler contract +
// wire shape either way, so routes and the SPA are unchanged.
//   TASK_STORE=postgres (default) → Postgres-native store (tasks.js)
//   TASK_STORE=caldav             → CalDAV VTODO store (tasks_caldav.js)
import * as pgStore from './tasks.js'
import * as caldavStore from './tasks_caldav.js'

export const store = (process.env.TASK_STORE || 'postgres') === 'caldav' ? caldavStore : pgStore
