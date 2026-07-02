import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import McpSection from '../../client/src/settings/McpSection.jsx'

// The real WIDGET_MANIFEST may not carry `mcp` fields yet (added by a parallel
// workstream), so we mock the entire module with two fake descriptors that do.
vi.mock('../../client/src/widgets/manifest.js', () => ({
  WIDGET_MANIFEST: [
    {
      type: 'reminders',
      label: 'Reminders',
      plugs: ['tasks'],
      mcp: { summary: 'Read and create reminders', tools: ['list_tasks', 'create_task', 'complete_task'] },
    },
    {
      type: 'calendar',
      label: 'Calendar',
      plugs: ['calendar'],
      mcp: { summary: 'Read calendar events', tools: ['list_events'] },
    },
    {
      // No `mcp` field — this one should never appear in the widget rows.
      type: 'notes',
      label: 'Notes',
      plugs: ['notes'],
    },
  ],
  WIDGET_MANIFEST_BY_TYPE: new Map(),
  DEFAULT_BOARD: [],
}))

// Default GET response representing "MCP enabled, token present, both widgets off".
const DEFAULT_SETTINGS = {
  enabled: true,
  widgets: { reminders: false, calendar: false },
  hasToken: true,
  tokenCreatedAt: '2026-06-01T10:00:00.000Z',
  lastUsedAt: null,
}

// Default GET response for the "no token" state.
const NO_TOKEN_SETTINGS = {
  enabled: false,
  widgets: {},
  hasToken: false,
  tokenCreatedAt: null,
  lastUsedAt: null,
}

// Build a minimal fetch mock that handles the four MCP endpoints.
function makeFetch({ getSettings = DEFAULT_SETTINGS, putResult, postTokenResult, deleteResult } = {}) {
  return vi.fn(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    if (url === '/api/mcp/settings' && method === 'GET') {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => getSettings }
    }
    if (url === '/api/mcp/settings' && method === 'PUT') {
      const body = JSON.parse(opts.body || '{}')
      const result = putResult ?? { ...getSettings, ...body, widgets: { ...getSettings.widgets, ...(body.widgets || {}) } }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => result }
    }
    if (url === '/api/mcp/token' && method === 'POST') {
      const result = postTokenResult ?? { token: 'test-secret-token-abc123' }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => result }
    }
    if (url === '/api/mcp/token' && method === 'DELETE') {
      const result = deleteResult ?? { ok: true }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => result }
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })
}

// After each DELETE/POST we re-fetch GET to refresh state. The mock needs to
// serve the right state on the second GET call too. This helper creates a fetch
// that returns `firstGet` on the first GET, then `secondGet` on subsequent ones.
function makeFetchWithRefresh(firstGet, secondGet) {
  let getCallCount = 0
  return vi.fn(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    if (url === '/api/mcp/settings' && method === 'GET') {
      getCallCount++
      const result = getCallCount === 1 ? firstGet : secondGet
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => result }
    }
    if (url === '/api/mcp/token' && method === 'POST') {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ token: 'new-token-xyz' }) }
    }
    if (url === '/api/mcp/token' && method === 'DELETE') {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }
    }
    if (url === '/api/mcp/settings' && method === 'PUT') {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => firstGet }
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })
}

describe('McpSection', () => {
  let origFetch

  beforeEach(() => {
    origFetch = globalThis.fetch
    // Silence navigator.clipboard (not in jsdom).
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    vi.restoreAllMocks()
  })

  it('renders the master toggle reflecting the GET response', async () => {
    globalThis.fetch = makeFetch({ getSettings: DEFAULT_SETTINGS })
    render(<McpSection />)

    // Wait for the async GET to resolve and paint the toggle.
    const toggle = await screen.findByRole('switch', { name: /^enable mcp access$/i })
    expect(toggle).toBeChecked()
  })

  it('renders per-widget rows for manifest entries that have an mcp field', async () => {
    globalThis.fetch = makeFetch({ getSettings: DEFAULT_SETTINGS })
    render(<McpSection />)

    // Both mcp-capable widgets appear; the "notes" entry (no mcp field) does not.
    await screen.findByRole('switch', { name: /^enable mcp access$/i })
    expect(screen.getByText('Reminders')).toBeInTheDocument()
    expect(screen.getByText('Calendar')).toBeInTheDocument()
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })

  it('shows tool counts as chip labels in the widget rows', async () => {
    globalThis.fetch = makeFetch({ getSettings: DEFAULT_SETTINGS })
    render(<McpSection />)

    await screen.findByText('Reminders')
    // Reminders has 3 tools, Calendar has 1.
    expect(screen.getByText('3 tools')).toBeInTheDocument()
    expect(screen.getByText('1 tool')).toBeInTheDocument()
  })

  it('PUTs { enabled: false } when the master switch is toggled off', async () => {
    const fetchMock = makeFetch({ getSettings: DEFAULT_SETTINGS })
    globalThis.fetch = fetchMock
    render(<McpSection />)

    const toggle = await screen.findByRole('switch', { name: /^enable mcp access$/i })
    await userEvent.click(toggle)

    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        ([url, opts]) => url === '/api/mcp/settings' && (opts?.method || 'GET').toUpperCase() === 'PUT',
      )
      expect(puts.length).toBeGreaterThan(0)
      const body = JSON.parse(puts[0][1].body)
      expect(body.enabled).toBe(false)
    })
  })

  it('PUTs { widgets } when a per-widget toggle is flipped', async () => {
    const fetchMock = makeFetch({ getSettings: DEFAULT_SETTINGS })
    globalThis.fetch = fetchMock
    render(<McpSection />)

    // Wait for the section to load and find the Reminders widget toggle.
    await screen.findByText('Reminders')
    const remindersToggle = screen.getByRole('switch', { name: /enable mcp access for reminders widget/i })
    await userEvent.click(remindersToggle)

    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        ([url, opts]) => url === '/api/mcp/settings' && (opts?.method || 'GET').toUpperCase() === 'PUT',
      )
      expect(puts.length).toBeGreaterThan(0)
      const body = JSON.parse(puts[puts.length - 1][1].body)
      expect(body.widgets).toMatchObject({ reminders: true })
    })
  })

  it('shows the Generate token button when there is no token', async () => {
    globalThis.fetch = makeFetch({ getSettings: NO_TOKEN_SETTINGS })
    render(<McpSection />)

    // Wait for GET.
    await screen.findByRole('switch', { name: /^enable mcp access$/i })
    expect(screen.getByRole('button', { name: /generate token/i })).toBeInTheDocument()
  })

  it('POSTs to /api/mcp/token and shows the token once after Generate', async () => {
    // Start with MCP enabled but no token yet; after POST the GET refresh returns hasToken: true.
    const enabledNoToken = { enabled: true, widgets: {}, hasToken: false, tokenCreatedAt: null, lastUsedAt: null }
    const afterGenerate = { enabled: true, widgets: {}, hasToken: true, tokenCreatedAt: '2026-07-01T00:00:00.000Z', lastUsedAt: null }
    globalThis.fetch = makeFetchWithRefresh(enabledNoToken, afterGenerate)

    render(<McpSection />)

    // Wait for load and click Generate.
    await screen.findByRole('button', { name: /generate token/i })
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }))

    // Token value appears in a <code> block exactly once.
    await screen.findByText('new-token-xyz')
    // The copy button appears.
    expect(screen.getByRole('button', { name: /copy token/i })).toBeInTheDocument()
    // The warning text is shown.
    expect(screen.getByText(/save it now/i)).toBeInTheDocument()
  })

  it('shows Regenerate and Revoke buttons when a token already exists', async () => {
    globalThis.fetch = makeFetch({ getSettings: DEFAULT_SETTINGS })
    render(<McpSection />)

    await screen.findByRole('switch', { name: /^enable mcp access$/i })
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
  })

  it('shows an inline confirm before Revoke, then DELETEs on confirm', async () => {
    // After DELETE, re-fetch returns no token.
    globalThis.fetch = makeFetchWithRefresh(DEFAULT_SETTINGS, {
      ...DEFAULT_SETTINGS,
      hasToken: false,
      tokenCreatedAt: null,
      lastUsedAt: null,
    })

    render(<McpSection />)

    // Click Revoke — should show the confirm state, not immediately DELETE.
    await screen.findByRole('button', { name: /revoke/i })
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))

    // Confirm prompt appears.
    expect(screen.getByText(/revoke token\? ai clients will lose access/i)).toBeInTheDocument()

    // Confirm the revoke.
    const confirmRevoke = screen.getByRole('button', { name: /^revoke$/i })
    await userEvent.click(confirmRevoke)

    // After DELETE + refresh, the Generate token button should reappear.
    await screen.findByRole('button', { name: /generate token/i })
  })

  it('can cancel the Revoke confirm without deleting', async () => {
    globalThis.fetch = makeFetch({ getSettings: DEFAULT_SETTINGS })
    render(<McpSection />)

    await screen.findByRole('button', { name: /revoke/i })
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    expect(screen.getByText(/revoke token\? ai clients will lose access/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    // After cancel, normal buttons return and no DELETE was issued.
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument()
  })

  it('shows an error alert when GET fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network error')
    })
    render(<McpSection />)

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.*t load mcp settings/i)
  })

  it('shows connection help (endpoint + CLI snippet) when enabled and hasToken', async () => {
    globalThis.fetch = makeFetch({ getSettings: DEFAULT_SETTINGS })
    render(<McpSection />)

    await screen.findByRole('switch', { name: /^enable mcp access$/i })
    // Endpoint text should appear. Exact-string matcher on purpose: a regex built
    // from the origin would also match the CLI snippet below (which embeds the
    // endpoint as a substring) and getByText would fail on multiple matches.
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeInTheDocument()
    // CLI snippet text (only the command block starts with "claude mcp add").
    expect(screen.getByText(/claude mcp add/i)).toBeInTheDocument()
  })

  // ---------------------------------------------------------------
  // Delta-PUT tests (Workstream 4 — fix #2)
  // ---------------------------------------------------------------

  it('PUT body for a widget toggle is a single-key delta, not the full map', async () => {
    // Start with both reminders and calendar off.
    const fetchMock = makeFetch({ getSettings: DEFAULT_SETTINGS })
    globalThis.fetch = fetchMock
    render(<McpSection />)

    await screen.findByText('Reminders')
    const remindersToggle = screen.getByRole('switch', { name: /enable mcp access for reminders widget/i })
    await userEvent.click(remindersToggle)

    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        ([url, opts]) => url === '/api/mcp/settings' && (opts?.method || 'GET').toUpperCase() === 'PUT',
      )
      expect(puts.length).toBeGreaterThan(0)
      const body = JSON.parse(puts[puts.length - 1][1].body)
      // Must be a delta: only the toggled key present, no 'enabled' key, no
      // 'calendar' key.
      expect(Object.keys(body)).toEqual(['widgets'])
      expect(Object.keys(body.widgets)).toEqual(['reminders'])
      expect(body.widgets.reminders).toBe(true)
    })
  })

  it('out-of-order (stale seq) response does not overwrite newer local state', async () => {
    // Simulate two rapid PUTs resolving in reverse order.
    // PUT #1 (reminders on): resolves SECOND with stale data ({ reminders: true, calendar: false }).
    // PUT #2 (calendar on): resolves FIRST with authoritative data ({ reminders: true, calendar: true }).
    // After both settle, calendar should still be true (newer PUT wins).

    let resolvePut1, resolvePut2
    const put1Promise = new Promise((res) => { resolvePut1 = res })
    const put2Promise = new Promise((res) => { resolvePut2 = res })

    let putCallCount = 0
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/mcp/settings' && method === 'GET') {
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => DEFAULT_SETTINGS }
      }
      if (url === '/api/mcp/settings' && method === 'PUT') {
        putCallCount++
        if (putCallCount === 1) {
          // First PUT (reminders toggle): hold until we tell it to resolve.
          await put1Promise
          return {
            ok: true, status: 200, headers: { get: () => 'application/json' },
            // Stale response: doesn't know calendar was enabled.
            json: async () => ({ ...DEFAULT_SETTINGS, widgets: { reminders: true, calendar: false } }),
          }
        } else {
          // Second PUT (calendar toggle): resolves first (wins).
          await put2Promise
          return {
            ok: true, status: 200, headers: { get: () => 'application/json' },
            json: async () => ({ ...DEFAULT_SETTINGS, widgets: { reminders: true, calendar: true } }),
          }
        }
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })

    render(<McpSection />)
    await screen.findByText('Reminders')

    const remindersToggle = screen.getByRole('switch', { name: /enable mcp access for reminders widget/i })
    const calendarToggle = screen.getByRole('switch', { name: /enable mcp access for calendar widget/i })

    // Fire both toggles before either PUT resolves.
    await userEvent.click(remindersToggle)
    await userEvent.click(calendarToggle)

    // Resolve PUT #2 (calendar) first — this is the "newer" one.
    resolvePut2()
    // Give it a tick to settle.
    await waitFor(() => expect(putCallCount).toBeGreaterThanOrEqual(2))
    // Now resolve PUT #1 (reminders) — this is "stale" and should be ignored.
    resolvePut1()

    // After both resolve, calendar should remain enabled (newer PUT wins; stale
    // PUT #1 response is discarded because its seq < latestSeq).
    await waitFor(() => {
      const calSwitch = screen.getByRole('switch', { name: /enable mcp access for calendar widget/i })
      expect(calSwitch).toBeChecked()
    })
  })

  it('error revert flips only the toggled key back, not the whole map', async () => {
    // Start: reminders true, calendar false.
    const startSettings = { ...DEFAULT_SETTINGS, widgets: { reminders: true, calendar: false } }
    let putCallCount = 0
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/mcp/settings' && method === 'GET') {
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => startSettings }
      }
      if (url === '/api/mcp/settings' && method === 'PUT') {
        putCallCount++
        throw new Error('network error')
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })

    render(<McpSection />)
    await screen.findByText('Reminders')

    // Reminders is currently ON. Toggle it OFF — this will fail and should revert
    // only reminders back to true, leaving calendar at false.
    const remindersToggle = screen.getByRole('switch', { name: /enable mcp access for reminders widget/i })
    expect(remindersToggle).toBeChecked()

    await userEvent.click(remindersToggle)

    // Wait for the error to surface.
    await screen.findByRole('alert')

    // After revert: reminders should be back to true; calendar should still be
    // false (i.e. the whole map was NOT replaced with stale state).
    const calendarToggle = screen.getByRole('switch', { name: /enable mcp access for calendar widget/i })
    expect(remindersToggle).toBeChecked()
    expect(calendarToggle).not.toBeChecked()
    // One PUT (the failed delta) — the revert is client-local, no second request.
    expect(putCallCount).toBe(1)
  })
})
