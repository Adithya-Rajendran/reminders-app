// Shared, side-effect-free constants for the server.

// Sentinel for an unset date, in ISO 8601. Year 0001 is not a real calendar
// date here (iCalendar/Vikunja use it as "no date"), so `getUTCFullYear() > 1`
// reliably tells a real date from this placeholder. Mirrors ZERO_DATE on the
// client (client/src/tasklib.js).
export const ZERO_DATE = '0001-01-01T00:00:00Z'
