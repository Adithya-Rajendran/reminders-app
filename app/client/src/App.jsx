import { useEffect, useState } from 'react'
import { api } from './api.js'
import Dashboard from './Dashboard.jsx'
import SettingsModal from './SettingsModal.jsx'
import { usePopover } from './usePopover.js'
import {
  IconBell, IconSun, IconMoon, IconGear, IconLogout,
  IconShield, IconKey, IconSpinner, IconPalette,
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
function TopBar({ user, theme, onToggleTheme, accent, onAccent, onOpenSettings }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = usePopover(menuOpen, setMenuOpen)
  const initials = initialsFor(user)
  const email = user?.email || user?.name || ''
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo"><IconBell size={19} /></span>
        <span className="wordmark">Reminders</span>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-right">
        <span className="user-email">
          <span className="avatar">{initials}</span>
          <span className="email-text">{email}</span>
        </span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <AccentPicker accent={accent} onPick={onAccent} />
        <button className="iconbtn" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          <IconGear size={18} />
        </button>
        <a className="iconbtn danger-hover" href="/auth/logout" aria-label="Log out" title="Log out">
          <IconLogout size={18} />
        </a>

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
  const start = (d) => { setEditing(d.id); setVal(d.name) }
  const commit = () => { if (editing) onRename(editing, val); setEditing(null) }
  return (
    <div className="dash-tabs" role="tablist" aria-label="Dashboards">
      {dashboards.map((d) => (
        <span key={d.id} className={`dash-tab${d.id === active ? ' on' : ''}`}>
          {editing === d.id ? (
            <input
              autoFocus className="dash-tab-edit" value={val} aria-label="Dashboard name"
              onChange={(e) => setVal(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null) }}
            />
          ) : (
            <button
              className="dash-tab-btn" role="tab" aria-selected={d.id === active}
              onClick={() => onSelect(d.id)} onDoubleClick={() => start(d)}
              title="Click to switch · double-click to rename"
            >{d.name}</button>
          )}
          {d.id === active && dashboards.length > 1 && editing !== d.id && (
            <button className="dash-tab-x" aria-label={`Delete ${d.name}`} title="Delete dashboard" onClick={() => onRemove(d.id)}>×</button>
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
  const openSettings = (opts) => setSettings({ createGroup: opts && opts.createGroup ? String(opts.createGroup) : undefined })
  const [dashboards, setDashboards] = useState([{ id: 'main', name: 'Dashboard' }])
  const [activeDash, setActiveDash] = useState('main')

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

      {settings && <SettingsModal initialCreateGroup={settings.createGroup} onClose={() => setSettings(null)} />}
    </>
  )
}
