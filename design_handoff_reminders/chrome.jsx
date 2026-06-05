/* ============================================================
   Reminders — Login, TopBar, Toolbar
   ============================================================ */

/* close on outside-click + Esc */
function usePopover(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);
  return ref;
}

/* ---------- Login ---------- */
function Login({ onSignIn }) {
  const [loading, setLoading] = useState(false);
  const go = () => { setLoading(true); setTimeout(onSignIn, 1100); };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><IconBell size={28} /></div>
        <h1>Sign in to Reminders</h1>
        <p className="lede">Your self-hosted tasks &amp; calendar, all in one calm dashboard.</p>
        <button className="btn primary block" style={{ padding: "12px 16px", fontSize: 14 }} onClick={go} disabled={loading} aria-label="Continue with single sign-on">
          {loading ? <><IconSpinner size={17} /> Redirecting…</> : <><IconShield size={17} /> Continue with SSO</>}
        </button>
        <div className="sso-detail"><IconKey size={13} /> Authenticated with OpenID Connect</div>
        <div className="login-foot">
          <IconShield size={13} /> Self-hosted · syncs with Vikunja &amp; CalDAV
        </div>
      </div>
    </div>
  );
}

/* ---------- Theme toggle ---------- */
function ThemeToggle({ theme, onToggle }) {
  return (
    <button className="iconbtn" onClick={onToggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
      {theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
    </button>
  );
}

/* ---------- TopBar ---------- */
function TopBar({ theme, onToggleTheme, onOpenSettings, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = usePopover(menuOpen, setMenuOpen);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo"><IconBell size={19} /></span>
        <span className="wordmark">Reminders</span>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-right">
        <span className="user-email">
          <span className="avatar">{USER.initials}</span>
          <span className="email-text">{USER.email}</span>
        </span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button className="iconbtn" aria-label="Settings" title="Settings" onClick={onOpenSettings}><IconGear size={18} /></button>
        <button className="iconbtn danger-hover" aria-label="Log out" title="Log out" onClick={onLogout}><IconLogout size={18} /></button>

        {/* mobile avatar menu */}
        <div style={{ position: "relative" }} ref={ref}>
          <button className="iconbtn avatar-menu-btn" aria-label="Account menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <span className="avatar" style={{ width: 26, height: 26 }}>{USER.initials}</span>
          </button>
          {menuOpen && (
            <div className="menu" role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", animation: "menuIn 150ms ease" }}>
              <div className="menu-label">{USER.email}</div>
              <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onToggleTheme(); }}>
                {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />} Toggle theme
              </button>
              <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onOpenSettings(); }}><IconGear size={16} /> Settings</button>
              <div className="menu-sep" />
              <button className="menu-item" role="menuitem" onClick={onLogout} style={{ color: "var(--danger)" }}><IconLogout size={16} /> Log out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ---------- Add-widget dropdown ---------- */
const WIDGET_MENU = [
  { type: "tasklist", label: "Project task list", icon: IconList, hasSub: true },
  { type: "upcoming", label: "Upcoming", icon: IconClock },
  { type: "feed", label: "Reminders feed", icon: IconBell },
  { type: "caldav", label: "CalDAV tasks", icon: IconCloud },
  { type: "calendar", label: "Calendar", icon: IconCalendar },
];

function AddWidgetMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const ref = usePopover(open, setOpen);
  useEffect(() => { if (!open) setSub(false); }, [open]);

  const pick = (type, projectId) => { onAdd(type, projectId); setOpen(false); };

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconPlus size={16} /> Add widget <IconChevDown size={14} style={{ marginLeft: -2, opacity: 0.85 }} />
      </button>
      {open && (
        <div className="menu" role="menu" style={{ position: "absolute", left: 0, top: "calc(100% + 8px)", animation: "menuIn 150ms ease" }}>
          {!sub ? (
            <>
              <div className="menu-label">Add a widget</div>
              {WIDGET_MENU.map((m) => {
                const I = m.icon;
                return (
                  <button
                    key={m.type}
                    className="menu-item"
                    role="menuitem"
                    onClick={() => m.hasSub ? setSub(true) : pick(m.type)}
                    aria-haspopup={m.hasSub ? "menu" : undefined}
                  >
                    <I size={16} /> {m.label}
                    {m.hasSub && <IconChevR size={15} className="chev" />}
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <button className="menu-item" role="menuitem" onClick={() => setSub(false)} style={{ color: "var(--muted)" }}>
                <IconChevL size={15} /> Project task list
              </button>
              <div className="menu-sep" />
              <div className="menu-label">Choose a project</div>
              {PROJECTS.map((p) => (
                <button key={p.id} className="menu-item" role="menuitem" onClick={() => pick("tasklist", p.id)}>
                  <span className="pdot" style={{ background: p.color, width: 9, height: 9 }} /> {p.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Toolbar ---------- */
function Toolbar({ onAdd }) {
  const dateLabel = `${DOW_FULL[NOW.getDay()]}, ${MONTHS[NOW.getMonth()]} ${NOW.getDate()}`;
  return (
    <div className="toolbar">
      <div>
        <h1>Dashboard</h1>
        <div className="sub">{dateLabel}</div>
      </div>
      <div className="toolbar-spacer" />
      <AddWidgetMenu onAdd={onAdd} />
    </div>
  );
}

Object.assign(window, { Login, TopBar, ThemeToggle, AddWidgetMenu, Toolbar, usePopover, WIDGET_MENU });
