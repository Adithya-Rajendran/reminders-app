/* ============================================================
   Reminders — mock data + date helpers
   Dates are generated relative to "now" so the app always
   looks live. Mixed work + personal flavor.
   ============================================================ */

const NOW = new Date();
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const atTime = (d, h, m=0) => { const x = new Date(d); x.setHours(h,m,0,0); return x; };
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const TODAY = startOfDay(NOW);

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DOW_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MON_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtTime(d) {
  let h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2,"0")} ${ap}`;
}
function relDay(d) {
  const diff = Math.round((startOfDay(d) - TODAY) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return DOW_FULL[d.getDay()];
  return `${MON_ABBR[d.getMonth()]} ${d.getDate()}`;
}
function dueChip(d) {
  if (!d) return null;
  const diff = Math.round((startOfDay(d) - TODAY) / 86400000);
  if (diff < 0) return { label: relDay(d), cls: "overdue" };
  if (diff <= 1) return { label: relDay(d), cls: "due-soon" };
  return { label: relDay(d), cls: "" };
}
function relTime(d) {
  const s = Math.round((Date.now() - d.getTime())/1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s/60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h/24)}d ago`;
}

const PROJECTS = [
  { id: "redesign", name: "Website Redesign", color: "#6d6cf7" },
  { id: "home", name: "Home & Errands", color: "#34d399" },
  { id: "infra", name: "Homelab / Infra", color: "#a855f7" },
  { id: "reading", name: "Reading List", color: "#fbbf24" },
];

let _tid = 0;
const T = (title, opts = {}) => ({
  id: `t${++_tid}`,
  title,
  done: opts.done || false,
  priority: opts.priority || 4, // 1 highest .. 4 none
  due: opts.due || null,
  project: opts.project || "redesign",
});

const TASKS = [
  // Website Redesign
  T("Finalize dashboard widget grid spec", { priority: 1, due: TODAY, project: "redesign" }),
  T("Review CalDAV sync error handling", { priority: 2, due: addDays(TODAY,1), project: "redesign" }),
  T("Ship dark-mode token pass", { priority: 3, due: addDays(TODAY,2), project: "redesign" }),
  T("Write empty-state copy for widgets", { priority: 4, due: addDays(TODAY,4), project: "redesign" }),
  T("Audit focus rings for AA contrast", { done: true, priority: 3, project: "redesign" }),

  // Home & Errands
  T("Pick up dry cleaning", { priority: 2, due: TODAY, project: "home" }),
  T("Renew passport — book appointment", { priority: 1, due: addDays(TODAY,-1), project: "home" }),
  T("Water the monstera", { priority: 4, due: addDays(TODAY,1), project: "home" }),
  T("Order replacement air filter", { priority: 3, due: addDays(TODAY,5), project: "home" }),

  // Infra
  T("Rotate Vikunja app passwords", { priority: 2, due: addDays(TODAY,3), project: "infra" }),
  T("Patch Nextcloud to latest LTS", { priority: 1, due: addDays(TODAY,1), project: "infra" }),
  T("Set up off-site backup snapshot", { priority: 3, due: addDays(TODAY,6), project: "infra" }),

  // Reading
  T("Finish 'Designing Data-Intensive Apps' ch. 7", { priority: 4, due: addDays(TODAY,3), project: "reading" }),
  T("Read OIDC spec section on PKCE", { priority: 3, project: "reading" }),
];

// CalDAV tasks — tagged with source list + account
const CALDAV_LISTS = [
  { id: "personal", name: "Personal", color: "#34d399", account: "iCloud" },
  { id: "work", name: "Work", color: "#6d6cf7", account: "Nextcloud" },
  { id: "shopping", name: "Shopping", color: "#fbbf24", account: "iCloud" },
];
let _cid = 0;
const CD = (title, list, due) => ({ id: `cd${++_cid}`, title, list, due: due || null, done: false });
const CALDAV_TASKS = [
  CD("Standup notes → shared doc", "work", TODAY),
  CD("Reply to landlord about lease", "personal", addDays(TODAY,1)),
  CD("Buy oat milk + coffee beans", "shopping", TODAY),
  CD("Submit quarterly OKRs", "work", addDays(TODAY,2)),
  CD("Call dentist to reschedule", "personal", addDays(TODAY,-1)),
  CD("Pick up package from locker", "shopping", addDays(TODAY,1)),
];

// Calendar events across the current month
const EVT_COLORS = { work: "#6d6cf7", personal: "#34d399", focus: "#a855f7", health: "#f4577a", social: "#fbbf24" };
let _eid = 0;
const E = (title, dayOffset, sh, eh, cat) => {
  const day = addDays(TODAY, dayOffset);
  return {
    id: `e${++_eid}`, title,
    start: atTime(day, Math.floor(sh), Math.round((sh%1)*60)),
    end: atTime(day, Math.floor(eh), Math.round((eh%1)*60)),
    color: EVT_COLORS[cat], cat,
  };
};
const EVENTS = [
  E("Design sync", -2, 10, 11, "work"),
  E("Deep work: grid layout", -1, 9, 11.5, "focus"),
  E("Lunch w/ Priya", -1, 12.5, 13.5, "social"),
  E("Standup", 0, 9.5, 9.75, "work"),
  E("Widget grid review", 0, 11, 12, "work"),
  E("Focus block", 0, 14, 16, "focus"),
  E("Gym", 0, 18, 19, "health"),
  E("1:1 with Sam", 1, 10, 10.5, "work"),
  E("CalDAV sync planning", 1, 13, 14, "work"),
  E("Dinner reservation", 1, 19.5, 21, "social"),
  E("Homelab maintenance window", 2, 22, 23, "focus"),
  E("Dentist", 3, 8.5, 9.5, "health"),
  E("Sprint demo", 3, 15, 16, "work"),
  E("Hike", 5, 8, 12, "health"),
  E("Quarterly planning", 6, 10, 12, "work"),
  E("Passport appointment", 8, 11, 11.5, "personal"),
  E("Team offsite", 11, 9, 17, "work"),
  E("Backup verification", 14, 21, 22, "focus"),
];

// Reminders feed — templates the simulated SSE stream draws from
const FEED_TEMPLATES = [
  { type: "due", text: (n)=>`<b>${n}</b> is due in 1 hour`, names: ["Finalize widget grid spec","Submit quarterly OKRs","Patch Nextcloud"] },
  { type: "done", text: (n)=>`<b>${n}</b> marked complete`, names: ["Audit focus rings","Standup notes → shared doc","Water the monstera"] },
  { type: "add", text: (n)=>`New task <b>${n}</b> added to Inbox`, names: ["Refill prescription","Review PR #482","Book flights"] },
  { type: "sync", text: ()=>`CalDAV sync finished — <b>3 lists</b> updated`, names: [""] },
  { type: "due", text: (n)=>`<b>${n}</b> starts in 15 min`, names: ["Design sync","1:1 with Sam","Sprint demo"] },
  { type: "sync", text: ()=>`Reconnected to <b>Nextcloud</b>`, names: [""] },
];
function makeFeedItem(t) {
  const tpl = FEED_TEMPLATES[Math.floor(Math.random()*FEED_TEMPLATES.length)];
  const name = tpl.names[Math.floor(Math.random()*tpl.names.length)];
  return { id: `f${Math.random().toString(36).slice(2,9)}`, type: tpl.type, html: tpl.text(name), at: t || new Date() };
}
// Seed feed (older items)
const SEED_FEED = [
  { id: "fs1", type: "sync", html: "CalDAV sync finished — <b>3 lists</b> updated", at: new Date(Date.now()-4*60000) },
  { id: "fs2", type: "done", html: "<b>Audit focus rings</b> marked complete", at: new Date(Date.now()-12*60000) },
  { id: "fs3", type: "due", html: "<b>Renew passport</b> is overdue", at: new Date(Date.now()-34*60000) },
  { id: "fs4", type: "add", html: "New task <b>Review PR #482</b> added to Inbox", at: new Date(Date.now()-58*60000) },
];

const ACCOUNTS_SEED = [
  { id: "a1", provider: "nextcloud", label: "Nextcloud — home.local", detail: "alex@home.local", status: "ok" },
  { id: "a2", provider: "apple", label: "Apple iCloud", detail: "alex@icloud.com", status: "ok" },
];

const DISCOVERED_LISTS = [
  { id: "d1", name: "Personal", color: "#34d399", count: 12, on: true },
  { id: "d2", name: "Work", color: "#6d6cf7", count: 23, on: true },
  { id: "d3", name: "Shopping", color: "#fbbf24", count: 5, on: false },
  { id: "d4", name: "Someday / Maybe", color: "#a855f7", count: 31, on: false },
];

const USER = { email: "alex@home.local", initials: "AX" };

Object.assign(window, {
  NOW, TODAY, startOfDay, addDays, atTime, sameDay,
  DOW, DOW_FULL, MONTHS, MON_ABBR,
  fmtTime, relDay, dueChip, relTime,
  PROJECTS, TASKS, CALDAV_LISTS, CALDAV_TASKS, EVT_COLORS, EVENTS,
  makeFeedItem, SEED_FEED, ACCOUNTS_SEED, DISCOVERED_LISTS, USER,
});
