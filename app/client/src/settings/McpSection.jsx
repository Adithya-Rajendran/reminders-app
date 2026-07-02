import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { WIDGET_MANIFEST } from '../widgets/manifest.js'
import {
  IconCheck, IconCopy, IconKey, IconLink, IconSpinner, IconTrash,
} from '../icons.jsx'

// MCP-capable manifest entries — the `mcp` field is added by a parallel workstream,
// so we filter defensively rather than assuming every entry has it.
const MCP_WIDGETS = WIDGET_MANIFEST.filter((m) => m.mcp)

// Format an ISO date string as a human-readable local date.
function fmtDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return iso
  }
}

// Copy text to clipboard with a fallback for environments where
// navigator.clipboard is unavailable (e.g. HTTP or older browsers).
async function copyToClipboard(text) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback: select a temporary <textarea>.
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

// A small copyable <code> block with a button. Used for the token and the
// connection snippets so users can grab them without selecting text manually.
function CopyBlock({ value, label }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await copyToClipboard(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Browser denied clipboard; select the text so the user can Ctrl+C.
      // Nothing more we can do here.
    }
  }

  return (
    <div className="mcp-copy-block">
      <code className="mcp-code">{value}</code>
      <button
        type="button"
        className="btn ghost sm mcp-copy-btn"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        title={copied ? 'Copied!' : `Copy ${label}`}
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

// Per-widget toggle row.
function WidgetRow({ descriptor, enabled, disabled: sectionDisabled, onToggle }) {
  return (
    <div className="mcp-widget-row">
      <div className="mcp-widget-main">
        <span className="mcp-widget-label">{descriptor.label}</span>
        <span className="notes-cfg-sub mcp-widget-desc" style={{ margin: 0 }}>
          {descriptor.mcp.summary}
        </span>
      </div>
      <span className="chip mcp-tool-chip" title={`${descriptor.mcp.tools.length} tools exposed to MCP clients`}>
        {descriptor.mcp.tools.length} tool{descriptor.mcp.tools.length === 1 ? '' : 's'}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={!!enabled}
        aria-checked={!!enabled}
        aria-label={`Enable MCP access for ${descriptor.label} widget`}
        disabled={sectionDisabled}
        onChange={onToggle}
      />
    </div>
  )
}

// The full MCP Settings section — sits inside the SettingsModal after
// ReminderGroupsSection. It follows the same self-contained fetch-on-mount
// pattern and idle|saving|saved|err state machine as the other settings sections.
export default function McpSection() {
  // Server state (mirrors GET /api/mcp/settings shape).
  const [settings, setSettings] = useState(null)
  // idle | saving | saved | err
  const [status, setStatus] = useState('idle')
  const [loadErr, setLoadErr] = useState(false)

  // A token that was just generated in this session — shown once, then gone.
  const [freshToken, setFreshToken] = useState(null)

  // Inline confirm state: 'regenerate' | 'revoke' | null
  const [confirmAction, setConfirmAction] = useState(null)

  // Last toggle error message (separate from top-level `status` so it doesn't
  // overwrite the master-switch saved flash).
  const [toggleErr, setToggleErr] = useState(null)

  // Token operation error (generate / regenerate / revoke).
  const [tokenErr, setTokenErr] = useState(null)
  const [tokenBusy, setTokenBusy] = useState(false)

  const isMounted = useRef(true)
  // Monotonically-increasing sequence counter for widget toggle PUTs.
  // Each PUT stamps its own seq; responses whose seq < latestSeq are stale
  // (out-of-order) and are discarded rather than overwriting newer local state.
  const latestSeq = useRef(0)
  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const load = () => {
    setLoadErr(false)
    return api('/api/mcp/settings')
      .then((d) => { if (isMounted.current) setSettings(d) })
      .catch(() => { if (isMounted.current) setLoadErr(true) })
  }

  useEffect(() => { load() }, [])

  // Toggle master on/off switch.
  const setEnabled = async (enabled) => {
    setSettings((s) => ({ ...s, enabled }))
    setStatus('saving')
    setTokenErr(null)
    try {
      const next = await api('/api/mcp/settings', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      if (isMounted.current) {
        setSettings(next)
        setStatus('saved')
        setTimeout(() => { if (isMounted.current) setStatus('idle') }, 1500)
      }
    } catch {
      if (isMounted.current) {
        setSettings((s) => ({ ...s, enabled: !enabled })) // revert
        setStatus('err')
      }
    }
  }

  // Toggle an individual widget.
  // Sends only a single-key delta { widgets: { [type]: bool } } — server merges
  // it into current state, so a stale client map can’t clobber other keys.
  const setWidgetEnabled = async (type, on) => {
    if (!settings) return
    const prevWidgets = settings.widgets || {}
    // Optimistic update: flip just this key. No busy-lockout on the switches —
    // per-key deltas + server merge + the seq guard make concurrent toggles
    // safe, and locking every switch during a PUT made toggling a list of
    // widgets needlessly serial.
    setSettings((s) => ({ ...s, widgets: { ...s.widgets, [type]: on } }))
    setToggleErr(null)
    // Stamp this request with a monotonically-increasing seq so that if two
    // rapid PUTs resolve out of order we can discard the stale one.
    const mySeq = ++latestSeq.current
    try {
      const next = await api('/api/mcp/settings', {
        method: 'PUT',
        // Delta only — server merges; never sends the whole map.
        body: JSON.stringify({ widgets: { [type]: on } }),
      })
      if (isMounted.current && mySeq === latestSeq.current) setSettings(next)
    } catch {
      if (isMounted.current) {
        // Revert only the toggled key, not the whole map.
        setSettings((s) => ({ ...s, widgets: { ...s.widgets, [type]: prevWidgets[type] } }))
        setToggleErr('Couldn’t update widget access — check your server and try again.')
      }
    }
  }

  // Enable all MCP-capable widgets at once.
  // Sends the full all-true map; safe with merge semantics and not a delta
  // (intent is to enable everything, so sending the complete set is correct).
  const enableAll = async () => {
    if (!settings) return
    const prevWidgets = settings.widgets || {}
    const nextWidgets = { ...prevWidgets }
    for (const m of MCP_WIDGETS) nextWidgets[m.type] = true
    setSettings((s) => ({ ...s, widgets: nextWidgets }))
    setToggleErr(null)
    const mySeq = ++latestSeq.current
    try {
      const next = await api('/api/mcp/settings', {
        method: 'PUT',
        body: JSON.stringify({ widgets: nextWidgets }),
      })
      if (isMounted.current && mySeq === latestSeq.current) setSettings(next)
    } catch {
      if (isMounted.current) {
        setSettings((s) => ({ ...s, widgets: prevWidgets }))
        setToggleErr('Couldn’t update widget access — check your server and try again.')
      }
    }
  }

  // Generate a new token (or regenerate — same endpoint, old one is invalidated).
  const generateToken = async () => {
    setTokenBusy(true)
    setTokenErr(null)
    try {
      const { token } = await api('/api/mcp/token', { method: 'POST' })
      if (isMounted.current) {
        setFreshToken(token)
        setConfirmAction(null)
        // Refresh settings so hasToken / tokenCreatedAt reflect the new state.
        await load()
      }
    } catch {
      if (isMounted.current) {
        setTokenErr('Couldn’t generate a token — check your server and try again.')
      }
    } finally {
      if (isMounted.current) setTokenBusy(false)
    }
  }

  // Revoke the token entirely.
  const revokeToken = async () => {
    setTokenBusy(true)
    setTokenErr(null)
    try {
      await api('/api/mcp/token', { method: 'DELETE' })
      if (isMounted.current) {
        setFreshToken(null)
        setConfirmAction(null)
        await load()
      }
    } catch {
      if (isMounted.current) {
        setTokenErr('Couldn’t revoke the token — check your server and try again.')
      }
    } finally {
      if (isMounted.current) setTokenBusy(false)
    }
  }

  const enabled = settings ? !!settings.enabled : false
  const hasToken = settings ? !!settings.hasToken : false
  const widgets = settings ? (settings.widgets || {}) : {}

  // Connection help: show when enabled + token exists, or right after generating.
  const showConnectionHelp = enabled && (hasToken || freshToken !== null)
  const endpoint = `${window.location.origin}/mcp`
  // The CLI snippet uses the live token when we just generated one; otherwise
  // we show a placeholder so the user knows what to substitute.
  const tokenForSnippet = freshToken ?? '<your token>'
  const cliSnippet = `claude mcp add --transport http reminders ${endpoint} --header "Authorization: Bearer ${tokenForSnippet}"`

  // Widget toggles are disabled only while MCP itself is off — in-flight PUTs
  // don't lock them (deltas + merge + seq guard make concurrency safe).
  const widgetDisabled = !enabled

  return (
    <div className="notes-cfg">
      {/* ---- Section header ---- */}
      <div className="notes-cfg-head">
        <IconKey size={16} />
        <span>MCP access (AI clients)</span>
        {status === 'saved' && <IconCheck size={14} style={{ color: 'var(--green)', marginLeft: 4 }} />}
        {status === 'saving' && <IconSpinner size={14} style={{ marginLeft: 4 }} />}
      </div>
      <div className="notes-cfg-sub">
        Let AI clients (Claude Code, Claude Desktop,&nbsp;&hellip;) read and act on your widgets over the Model Context Protocol.
      </div>

      {loadErr && (
        <div className="rem-err" role="alert">
          Couldn&rsquo;t load MCP settings &mdash; check your server.
        </div>
      )}

      {!loadErr && settings === null && (
        <div className="state-sub" style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          <IconSpinner size={14} style={{ verticalAlign: '-3px', marginRight: 4 }} />
          Loading&hellip;
        </div>
      )}

      {settings !== null && (
        <>
          {/* ---- Master switch ---- */}
          <label className="mcp-master-row">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={enabled}
              aria-checked={enabled}
              aria-label="Enable MCP access"
              disabled={status === 'saving'}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="mcp-master-label">Enable MCP access</span>
          </label>

          {status === 'err' && (
            <div className="rem-err" role="alert">
              Couldn&rsquo;t save &mdash; check your server.
            </div>
          )}

          {/* Everything below is visible even when disabled, for discoverability. */}
          <div className={enabled ? undefined : 'mcp-dimmed'} aria-disabled={!enabled}>

            {/* ---- Token block ---- */}
            <div className="mcp-token-block">
              {tokenErr && (
                <div className="rem-err" role="alert">{tokenErr}</div>
              )}

              {!hasToken && freshToken === null && (
                // No token yet — offer to generate one.
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={generateToken}
                  disabled={!enabled || tokenBusy}
                >
                  {tokenBusy ? <IconSpinner size={14} /> : <IconKey size={14} />}
                  Generate token
                </button>
              )}

              {freshToken !== null && (
                // Fresh token: show it once in a copyable box + warn the user.
                <div className="mcp-fresh-token">
                  <div className="notes-cfg-sub mcp-token-warn" style={{ margin: '0 0 6px' }}>
                    <strong>Save it now</strong> &mdash; it won&rsquo;t be shown again.&nbsp;
                    Anyone with this token can read and change everything in your account (tasks, calendar, notes).
                  </div>
                  <CopyBlock value={freshToken} label="token" />
                </div>
              )}

              {hasToken && freshToken === null && (
                // Existing token: show metadata + inline-confirm regenerate / revoke.
                <div className="mcp-token-meta">
                  <div className="notes-cfg-sub" style={{ margin: 0 }}>
                    <strong>Token created:</strong>{' '}
                    {fmtDate(settings.tokenCreatedAt) ?? 'unknown'}
                    {' · '}
                    <strong>Last used:</strong>{' '}
                    {fmtDate(settings.lastUsedAt) ?? 'never'}
                  </div>

                  <div className="mcp-token-actions">
                    {confirmAction === 'regenerate' ? (
                      <span className="rg-confirm">
                        <span className="rg-confirm-q">Old token stops working immediately.</span>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={generateToken}
                          disabled={tokenBusy}
                        >
                          {tokenBusy ? <IconSpinner size={13} /> : 'Regenerate'}
                        </button>
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => setConfirmAction(null)}
                          disabled={tokenBusy}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : confirmAction === 'revoke' ? (
                      <span className="rg-confirm">
                        <span className="rg-confirm-q">Revoke token? AI clients will lose access.</span>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={revokeToken}
                          disabled={tokenBusy}
                        >
                          {tokenBusy ? <IconSpinner size={13} /> : 'Revoke'}
                        </button>
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => setConfirmAction(null)}
                          disabled={tokenBusy}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => setConfirmAction('regenerate')}
                          disabled={!enabled || tokenBusy}
                        >
                          <IconKey size={13} /> Regenerate
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm mcp-revoke-btn"
                          onClick={() => setConfirmAction('revoke')}
                          disabled={!enabled || tokenBusy}
                        >
                          <IconTrash size={13} /> Revoke
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ---- Connection help ---- */}
            {showConnectionHelp && (
              <div className="mcp-connection-help">
                <div className="notes-cfg-sub mcp-conn-label" style={{ margin: '0 0 4px' }}>
                  <IconLink size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  MCP endpoint
                </div>
                <CopyBlock value={endpoint} label="endpoint URL" />

                <div className="notes-cfg-sub mcp-conn-label" style={{ margin: '8px 0 4px' }}>
                  Quick-add to Claude Code
                </div>
                <CopyBlock value={cliSnippet} label="claude mcp add command" />
              </div>
            )}

            {/* ---- Per-widget toggles ---- */}
            {MCP_WIDGETS.length > 0 && (
              <div className="mcp-widgets-block">
                <div className="mcp-widgets-head">
                  <span className="notes-cfg-head" style={{ fontSize: 13 }}>Widget access</span>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={enableAll}
                    disabled={widgetDisabled}
                    style={{ marginLeft: 'auto' }}
                  >
                    Enable all
                  </button>
                </div>
                <div className="notes-cfg-sub" style={{ marginBottom: 8 }}>
                  Only enabled widgets&rsquo; tools are visible to MCP clients.
                </div>

                {toggleErr && (
                  <div className="rem-err" role="alert">{toggleErr}</div>
                )}

                <div className="mcp-widget-list">
                  {MCP_WIDGETS.map((m) => (
                    <WidgetRow
                      key={m.type}
                      descriptor={m}
                      enabled={!!widgets[m.type]}
                      disabled={widgetDisabled}
                      onToggle={(e) => setWidgetEnabled(m.type, e.target.checked)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
