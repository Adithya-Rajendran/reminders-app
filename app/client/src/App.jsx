import { useCallback, useEffect, useRef, useState } from 'react'
import { api, tk } from './api.js'
import { appCache } from './fetchcache.js'
import Dashboard from './Dashboard.jsx'
import SettingsModal from './SettingsModal.jsx'
import CommandPalette from './CommandPalette.jsx'
import QuickCaptureModal from './QuickCaptureModal.jsx'
import KeyboardHelpModal from './KeyboardHelpModal.jsx'
import { useGlobalHotkeys } from './useGlobalHotkeys.js'
import { usePopover } from './usePopover.js'
import { createTask } from './tasklib.js'
import { insertTask } from './taskstore.js'
import { emitTasksChanged } from './tasksbus.js'
import { preloadWidgets, DEFAULT_BOARD } from './widgets/registry.jsx'
import { loadJson } from './storage.js'
import { UndoBar } from './widget-sdk'
import {
  IconBell, IconSun, IconMoon, IconGear, IconLogout,
  IconShield, IconKey, IconSpinner, IconPalette, IconSearch,
} from './icons.jsx'
import { ACCENTS, applyAccent } from './accents.js'

function initialsFor(user) {
  const name = (user?.name || '').trim()
  if (name) {
    const parts = name.split(/\s+/)
    return (((parts[0]?.[0]) || '') + ((parts[1]?.[0]) || '')).toUpperCase() || '?'
  }
  const email = user?.email || ''
  return (email[0] || '?').toUpperCase()
}

/* ---------- Login (OIDC start) ---------- */
function Login() {
  const [loading, setLoading] = useState(false)
  const go = () => { setLoading(true); window.location.href = '/auth/login' }
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><IconBell size={28} /></div>
        <h1>Sign in to Reminders</h1>
        <p className="lede">Your self-hosted tasks &amp; calendar, all in one calm dashboard.</p>
        <button
          className="btn primary block"
          style={{ padding: '12px 16px', fontSize: 14 }}
          onClick={go}
          disabled={loading}
          aria-label="Continue with single sign-on"
        >
          {loading ? <><IconSpinner size={17} /> Redirecting…</> : <><IconShield size={17} /> Continue with SSO</>}
        </button>
        <div className="sso-detail"><IconKey size={13} /> Authenticated with OpenID Connect</div>
        <div className="login-foot">
          <IconShield size={13} /> Self-hosted · OIDC + CalDAV sync
        </div>
      </div>
    </div>
  )
}

/* ---------- Theme toggle ---------- */
function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className="iconbtn"
      onClick={onToggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title="Toggle theme"
    >
      {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
    </button>
  )
}

/* ---------- Accent color picker ---------- */
function AccentPicker({ accent, onPick }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="iconbtn" aria-label="Accent color" title="Accent color" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconPalette size={18} />
      </button>
      {open && (
        <div className="menu accent-pop" role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', animation: 'menuIn 150ms ease' }}>
          <div className="menu-label">Accent color</div>
          <div className="accent-grid">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                className={`accent-swatch${a.key === accent ? ' active' : ''}`}
                title={a.name}
                aria-label={a.name}
                style={{ background: `linear-gradient(135deg, ${a.a}, ${a.b})` }}
                onClick={() => { onPick(a.key); setOpen(false) }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- TopBar ---------- */
function TopBar({ user, theme, onToggleTheme, accent, onAccent, onOpenSettings, onOpenPalette }) {
  const [menuOpen, setMenuOpen] = useState(false)
  // Accent submenu inside the avatar dropdown: on narrow screens the inline
  // accent picker (.topbar-actions) is hidden, so the dropdown carries its own.
  const [accentOpen, setAccentOpen] = useState(false)
  const ref = usePopover(menuOpen, setMenuOpen)
  const initials = initialsFor(user)
  const email = user?.email || user?.name || ''
  const cmdKey = (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) ? '⌘K' : 'Ctrl K'
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo"><IconBell size={19} /></span>
        <span className="wordmark">Reminders</span>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-right">
        {/* Visible affordance for the command palette so mouse/touch users can
            reach it (and the shortcut is advertised), not just Ctrl/Cmd+K. */}
        <button className="palette-pill" onClick={onOpenPalette} aria-label="Search and commands" title="Search & commands">
          <IconSearch size={15} />
          <span className="palette-pill-text">Search…</span>
          <kbd className="palette-pill-kbd">{cmdKey}</kbd>
        </button>
        <span className="user-email">
          <span className="avatar">{initials}</span>
          <span className="email-text">{email}</span>
        </span>
        {/* Inline control cluster — hidden on narrow screens (the avatar menu
            below carries equivalents); see '.topbar-actions' in styles.css. */}
        <div className="topbar-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <AccentPicker accent={accent} onPick={onAccent} />
          <button className="iconbtn" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
            <IconGear size={18} />
          </button>
          <a className="iconbtn danger-hover" href="/auth/logout" aria-label="Log out" title="Log out">
            <IconLogout size={18} />
          </a>
        </div>

        {/* mobile avatar menu */}
        <div style={{ position: 'relative' }} ref={ref}>
          <button
            className="iconbtn avatar-menu-btn"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="avatar" style={{ width: 26, height: 26 }}>{initials}</span>
          </button>
          {menuOpen && (
            <div
              className="menu"
              role="menu"
              style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', animation: 'menuIn 150ms ease' }}
            >
              <div className="menu-label">{email}</div>
              <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onToggleTheme() }}>
                {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />} Toggle theme
              </button>
              {/* Accent color lives here too so it survives the inline cluster
                  being hidden on narrow screens. */}
              <button className="menu-item" role="menuitem" aria-haspopup="menu" aria-expanded={accentOpen} onClick={() => setAccentOpen((o) => !o)}>
                <IconPalette size={16} /> Accent color
              </button>
              {accentOpen && (
                <div className="accent-grid" role="menu" style={{ padding: '4px 8px 8px' }}>
                  {ACCENTS.map((a) => (
                    <button
                      key={a.key}
                      className={`accent-swatch${a.key === accent ? ' active' : ''}`}
                      title={a.name}
                      aria-label={a.name}
                      style={{ background: `linear-gradient(135deg, ${a.a}, ${a.b})` }}
                      onClick={() => { onAccent(a.key); setAccentOpen(false); setMenuOpen(false) }}
                    />
                  ))}
                </div>
              )}
              <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onOpenSettings() }}>
                <IconGear size={16} /> Settings
              </button>
              <div className="menu-sep" />
              <a className="menu-item" role="menuitem" href="/auth/logout" style={{ color: 'var(--danger)' }}>
                <IconLogout size={16} /> Log out
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/* ---------- Dashboard switcher (multiple dashboards) ---------- */
function DashboardTabs({ dashboards, active, onSelect, onAdd, onRename, onRemove }) {
  const [editing, setEditing] = useState(null)
  const [val, setVal] = useState('')
  // Two-step delete: the '×' arms an inline confirm rather than removing the
  // dashboard (and its layout) outright — deletion is irreversible.
  const [confirmDel, setConfirmDel] = useState(null)
  const start = (d) => { setEditing(d.id); setVal(d.name) }
  const commit = () => { if (editing) onRename(editing, val); setEditing(null) }
  // Standard ARIA tablist keyboard model: one Tab stop (the active tab), arrows
  // move selection — so N dashboards don't cost N Tab presses to get past.
  const onTabKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const i = dashboards.findIndex((d) => d.id === active)
    const next = dashboards[(i + dir + dashboards.length) % dashboards.length]
    onSelect(next.id)
    e.currentTarget.querySelector(`[data-dash="${next.id}"]`)?.focus()
  }
  return (
    <div className="dash-tabs" role="tablist" aria-label="Dashboards" onKeyDown={onTabKey}>
      {dashboards.map((d) => (
        <span key={d.id} className={`dash-tab${d.id === active ? ' on' : ''}`}>
          {editing === d.id ? (
            <input
              autoFocus className="dash-tab-edit" value={val} aria-label="Dashboard name"
              onChange={(e) => setVal(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); e.stopPropagation() }}
            />
          ) : (
            <button
              className="dash-tab-btn" role="tab" aria-selected={d.id === active}
              tabIndex={d.id === active ? 0 : -1} data-dash={d.id}
              onClick={() => onSelect(d.id)} onDoubleClick={() => start(d)}
              title="Click to switch · double-click to rename"
            >{d.name}</button>
          )}
          {d.id === active && dashboards.length > 1 && editing !== d.id && (
            confirmDel === d.id ? (
              <span className="rg-confirm dash-tab-confirm" role="group" aria-label={`Delete ${d.name}?`}>
                <span className="dash-tab-confirm-q">Delete “{d.name}”?</span>
                <button className="btn sm danger" onClick={() => { onRemove(d.id); setConfirmDel(null) }}>Delete</button>
                <button className="btn sm ghost" autoFocus onClick={() => setConfirmDel(null)}>Cancel</button>
              </span>
            ) : (
              <button className="dash-tab-x" aria-label={`Delete ${d.name}`} title="Delete dashboard" onClick={() => setConfirmDel(d.id)}>×</button>
            )
          )}
        </span>
      ))}
      <button className="dash-tab-add" aria-label="New dashboard" title="New dashboard" onClick={onAdd}>+</button>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'login' | 'ready'
  const [theme, setTheme] = useState(() => localStorage.getItem('reminders-theme') || 'dark')
  const [accent, setAccent] = useState(() => localStorage.getItem('reminders-accent') || 'indigo')
  const [settings, setSettings] = useState(null) // null = closed | { createGroup? }
  // Accepts an optional { createGroup } to open Settings with the group create form
  // prefilled; called as a plain onClick handler elsewhere, so ignore event args.
  // Stable identity (useCallback): it feeds Dashboard's capability memos — a fresh
  // function every App render cascaded into widget effects refetching on every
  // modal open/close.
  const openSettings = useCallback((opts) => setSettings({ createGroup: opts && opts.createGroup ? String(opts.createGroup) : undefined }), [])
  const [dashboards, setDashboards] = useState([{ id: 'main', name: 'Dashboard' }])
  const [activeDash, setActiveDash] = useState('main')
  const [palette, setPalette] = useState(null) // null | { mode: 'notes' | 'commands' }
  const [capture, setCapture] = useState(false) // global quick-capture popup
  const [help, setHelp] = useState(false)       // '?' shortcut cheat sheet
  const [inboxId, setInboxId] = useState(null)  // first project (the inbox), resolved once on ready
  // Transient post-capture confirmation ("where did it go?") — same UndoBar shell
  // the widgets use, app-level so it outlives the closed capture modal.
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const showToast = (label) => {
    clearTimeout(toastTimer.current)
    setToast({ label })
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  // Resolve the inbox project so quick-capture can create from anywhere, with no
  // task widget on the board (mirrors Dashboard's projects[0] inbox convention).
  useEffect(() => {
    if (status !== 'ready') return
    appCache.cached('projects', () => tk('/projects'), { ttl: 60_000 })
      .then((ps) => { const pr = Array.isArray(ps) ? ps.filter((p) => p.id > 0) : []; setInboxId(pr[0]?.id ?? null) }).catch(() => {})
  }, [status])

  // Create a captured task into the inbox + reconcile the shared store so any open
  // widget reflects it immediately (widget-independent).
  const captureCreate = async (fields) => {
    const t = await createTask(inboxId, fields)
    insertTask(t); emitTasksChanged()
    showToast('Captured to Inbox — it will appear in Triage.')
    return t
  }

  // Cycle dashboards with Ctrl/Cmd+[ and ] (wraps around).
  const cycleDash = useCallback((dir) => {
    setActiveDash((cur) => {
      if (dashboards.length < 2) return cur
      const i = dashboards.findIndex((d) => d.id === cur)
      return dashboards[(i + dir + dashboards.length) % dashboards.length].id
    })
  }, [dashboards])

  // App-wide palette + quick-capture hotkeys (only meaningful once signed in).
  // Capture is NOT gated on the inbox being resolved — a silently dead 'c' reads
  // as broken; the modal itself explains the no-account case (inboxReady).
  useGlobalHotkeys({
    onQuickSwitch: () => { if (status === 'ready') setPalette({ mode: 'notes' }) },
    onCommands: () => { if (status === 'ready') setPalette({ mode: 'commands' }) },
    onQuickCapture: () => { if (status === 'ready') setCapture(true) },
    onHelp: () => { if (status === 'ready') setHelp(true) },
    onCycleDash: (dir) => { if (status === 'ready') cycleDash(dir) },
  })

  // Warm the widget chunks for the last-seen board while the layout fetch is
  // still in flight — otherwise every chunk request waterfalls behind
  // /api/layouts. Falls back to the default board for a first visit.
  useEffect(() => {
    if (status !== 'ready') return
    preloadWidgets(loadJson('reminders-last-board-' + activeDash, DEFAULT_BOARD))
  }, [status, activeDash])

  // Theme: persist + reflect on <html data-theme>.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('reminders-theme', theme)
  }, [theme])

  // Accent: persist + apply to the accent CSS vars.
  useEffect(() => {
    applyAccent(accent)
    localStorage.setItem('reminders-accent', accent)
  }, [accent])

  // Session: fetch /api/me directly so a 401 shows the login screen instead of
  // the api() helper's auto-redirect (the login button starts the OIDC flow).
  useEffect(() => {
    let alive = true
    fetch('/api/me', { headers: { 'content-type': 'application/json' } })
      .then((res) => {
        if (!alive) return null
        if (res.status === 401) { setStatus('login'); return null }
        if (!res.ok) throw new Error('failed')
        return res.json()
      })
      .then((u) => { if (alive && u) { setUser(u); setStatus('ready') } })
      .catch(() => { if (alive) setStatus('login') })
    return () => { alive = false }
  }, [])

  // Load the user's dashboard list once signed in (falls back to one dashboard).
  useEffect(() => {
    if (status !== 'ready') return
    let alive = true
    api('/api/dashboards').then((r) => {
      if (!alive) return
      const list = Array.isArray(r?.dashboards) && r.dashboards.length ? r.dashboards : [{ id: 'main', name: 'Dashboard' }]
      setDashboards(list)
      setActiveDash((cur) => (list.some((d) => d.id === cur) ? cur : list[0].id))
    }).catch(() => { /* keep the default single dashboard */ })
    return () => { alive = false }
  }, [status])

  const persistDashboards = (list) => {
    setDashboards(list)
    api('/api/dashboards', { method: 'PUT', body: JSON.stringify({ dashboards: list }) }).catch(() => {})
  }
  const addDashboard = () => {
    const id = 'd-' + crypto.randomUUID()
    persistDashboards([...dashboards, { id, name: `Dashboard ${dashboards.length + 1}` }])
    setActiveDash(id)
  }
  const renameDashboard = (id, name) => persistDashboards(dashboards.map((d) => (d.id === id ? { ...d, name: name.trim() || d.name } : d)))
  const removeDashboard = (id) => {
    if (dashboards.length <= 1) return
    const next = dashboards.filter((d) => d.id !== id)
    persistDashboards(next)
    api('/api/dashboards/' + id, { method: 'DELETE' }).catch(() => {})
    setActiveDash((cur) => (cur === id ? next[0].id : cur))
  }

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  // App-level commands surfaced in the Ctrl/Cmd+K palette (alongside its built-in
  // note command), so the palette is a keyboard-driven spine for the whole app.
  const paletteCommands = [
    { id: 'quick-capture', label: 'Add reminder…', hint: 'Capture a task — shortcut: c', icon: IconBell, run: () => setCapture(true) },
    { id: 'open-settings', label: 'Open Settings', hint: 'Accounts, notes folder, groups', icon: IconGear, run: () => openSettings() },
    // One "Switch to …" command per other dashboard, so tab switching is
    // keyboard-reachable from the palette (and fuzzy-findable by name).
    ...dashboards.filter((d) => d.id !== activeDash).map((d) => (
      { id: 'dash-' + d.id, label: `Switch to ${d.name}`, hint: 'Dashboard — Ctrl+[ / ]', run: () => setActiveDash(d.id) }
    )),
    { id: 'shortcuts', label: 'Keyboard shortcuts', hint: 'Cheat sheet — shortcut: ?', run: () => setHelp(true) },
    { id: 'toggle-theme', label: 'Toggle light / dark theme', icon: theme === 'dark' ? IconSun : IconMoon, run: toggleTheme },
    { id: 'cycle-accent', label: 'Change accent color', icon: IconPalette, run: () => setAccent((a) => { const i = ACCENTS.findIndex((x) => x.key === a); return ACCENTS[(i + 1) % ACCENTS.length].key }) },
    { id: 'new-dashboard', label: 'New dashboard', hint: 'Add a dashboard tab', run: addDashboard },
    { id: 'logout', label: 'Log out', icon: IconLogout, run: () => window.location.assign('/auth/logout') },
  ]

  return (
    <>
      <div className="app-bg" />

      {status === 'loading' && (
        <div className="login-wrap"><IconSpinner size={26} /></div>
      )}

      {status === 'login' && <Login />}

      {status === 'ready' && (
        <div className="app">
          <TopBar
            user={user}
            theme={theme}
            onToggleTheme={toggleTheme}
            accent={accent}
            onAccent={setAccent}
            onOpenSettings={openSettings}
            onOpenPalette={() => setPalette({ mode: 'notes' })}
          />
          <DashboardTabs
            dashboards={dashboards}
            active={activeDash}
            onSelect={setActiveDash}
            onAdd={addDashboard}
            onRename={renameDashboard}
            onRemove={removeDashboard}
          />
          <Dashboard
            key={activeDash}
            dashboardId={activeDash}
            title={(dashboards.find((d) => d.id === activeDash) || {}).name}
            onOpenSettings={openSettings}
          />
        </div>
      )}

      {settings && <SettingsModal initialCreateGroup={settings.createGroup} onClose={() => {
        // Settings can change accounts, projects, and groups — drop every cached
        // read so the board refetches fresh (same freshness as before the cache).
        appCache.clear()
        setSettings(null)
      }} />}

      {status === 'ready' && palette && (
        <CommandPalette initialMode={palette.mode} commands={paletteCommands} onClose={() => setPalette(null)} />
      )}

      {status === 'ready' && capture && (
        <QuickCaptureModal
          onSubmit={captureCreate}
          onClose={() => setCapture(false)}
          inboxReady={inboxId != null}
          onOpenSettings={openSettings}
        />
      )}

      {status === 'ready' && help && <KeyboardHelpModal onClose={() => setHelp(false)} />}

      {toast && <div className="app-toast"><UndoBar undo={toast} dismiss={() => { clearTimeout(toastTimer.current); setToast(null) }} /></div>}
    </>
  )
}
