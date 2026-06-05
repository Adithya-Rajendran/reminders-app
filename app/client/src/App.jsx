import React, { useEffect, useRef, useState } from 'react'
import Dashboard from './Dashboard.jsx'
import SettingsModal from './SettingsModal.jsx'
import {
  IconBell, IconSun, IconMoon, IconGear, IconLogout,
  IconShield, IconKey, IconSpinner,
} from './icons.jsx'

/* close a popover on outside-click + Esc */
function usePopover(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return ref
}

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
          <IconShield size={13} /> Self-hosted · syncs with Vikunja &amp; CalDAV
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

/* ---------- TopBar ---------- */
function TopBar({ user, theme, onToggleTheme, onOpenSettings }) {
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

export default function App() {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'login' | 'ready'
  const [theme, setTheme] = useState(() => localStorage.getItem('reminders-theme') || 'dark')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Theme: persist + reflect on <html data-theme>.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('reminders-theme', theme)
  }, [theme])

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
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <Dashboard user={user} onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
