// The task/project/label store. Tasks live as VTODOs in the user's CalDAV server
// (tasks_caldav.js). Postgres was retired — CalDAV is the only backend.
import * as caldavStore from './tasks_caldav.js'

export const store = caldavStore
