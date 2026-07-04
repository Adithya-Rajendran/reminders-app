// The shared task store's first-subscriber freshness window (client/src/
// taskstore.js): the boot warm (Dashboard) refresh()es before any widget
// mounts; the first subscribe() must NOT fire a duplicate /api/tasks when that
// load is still fresh, and MUST when it's stale or failed. The store is module
// state, so each scenario imports its own instance via a distinct query string.
// Run with: node test/taskstore.test.mjs
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const tick = () => new Promise((r) => setTimeout(r, 0))

// api.js goes through global fetch; serve /api/tasks with a counting stub.
let fetchCalls = 0
globalThis.fetch = async () => {
  fetchCalls++
  return {
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    json: async () => [{ id: 1, title: 'stub', done: false }],
  }
}

// --- fresh boot warm: subscribe within the window reuses it (the cold-load duplicate) ---
{
  fetchCalls = 0
  const store = await import('../client/src/data/taskstore.js?fresh')
  await store.refresh() // the Dashboard boot warm
  ok(fetchCalls === 1, 'boot warm fetches once')
  store.subscribe(() => {})
  await tick()
  ok(fetchCalls === 1, 'first subscriber within the freshness window does not refetch')
  ok(store.getState() === 'ready' && store.getTasks().length === 1, 'store is ready with the warmed list')
}

// --- no boot warm: the first subscriber still loads the list ---
{
  fetchCalls = 0
  const store = await import('../client/src/data/taskstore.js?cold')
  store.subscribe(() => {})
  await tick()
  ok(fetchCalls === 1, 'with no prior load the first subscriber fetches')
}

// --- stale boot warm: subscribe past the window refetches ---
{
  fetchCalls = 0
  const store = await import('../client/src/data/taskstore.js?stale')
  await store.refresh()
  const realNow = Date.now
  Date.now = () => realNow() + 6000 // past the 5s freshness window
  try {
    store.subscribe(() => {})
    await tick()
  } finally { Date.now = realNow }
  ok(fetchCalls === 2, 'a stale warm load is refreshed by the first subscriber')
}

// --- failed boot warm: subscribe retries ---
{
  const store = await import('../client/src/data/taskstore.js?err')
  const good = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('down') }
  await store.refresh()
  ok(store.getState() === 'error', 'a failed load leaves the store in error')
  globalThis.fetch = good
  fetchCalls = 0
  store.subscribe(() => {})
  await tick()
  ok(fetchCalls === 1 && store.getState() === 'ready', 'an errored store always refetches on subscribe')
}

console.log(`taskstore: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
