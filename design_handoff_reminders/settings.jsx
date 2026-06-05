/* ============================================================
   Reminders — Settings modal (CalDAV Sync)
   ============================================================ */

/* focus trap + Esc */
function useModal(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const prevFocus = document.activeElement;
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(node.querySelectorAll(sel)).filter((el) => !el.disabled && el.offsetParent !== null);
    const t = setTimeout(() => { const f = focusables(); (f[0] || node).focus(); }, 30);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
  }, [open, onClose]);
  return ref;
}

const PROVIDER_PRESETS = {
  nextcloud: {
    name: "Nextcloud", icon: IconNextcloud,
    fields: [
      { key: "url", label: "Server URL", placeholder: "https://cloud.example.com", type: "url" },
      { key: "user", label: "Username", placeholder: "alex", type: "text" },
      { key: "pass", label: "App password", placeholder: "xxxxx-xxxxx-xxxxx", type: "password", hint: "Generate one under Settings → Security → Devices & sessions. Never use your login password." },
    ],
  },
  apple: {
    name: "Apple iCloud", icon: IconApple,
    fields: [
      { key: "user", label: "Apple ID", placeholder: "you@icloud.com", type: "email" },
      { key: "pass", label: "App-specific password", placeholder: "xxxx-xxxx-xxxx-xxxx", type: "password", hint: "Create at appleid.apple.com → Sign-In & Security. iCloud’s CalDAV URL is discovered automatically — no server URL needed." },
    ],
  },
  generic: {
    name: "Generic CalDAV", icon: IconLink,
    fields: [
      { key: "url", label: "CalDAV URL", placeholder: "https://dav.example.com/dav/principals/", type: "url" },
      { key: "user", label: "Username", placeholder: "username", type: "text" },
      { key: "pass", label: "Password", placeholder: "••••••••", type: "password" },
    ],
  },
};

function ProviderIcon({ provider, size = 20 }) {
  const map = { nextcloud: IconNextcloud, apple: IconApple, generic: IconLink };
  const I = map[provider] || IconCloud;
  return <I size={size} />;
}

function SettingsModal({ open, onClose }) {
  const ref = useModal(open, onClose);
  const [accounts, setAccounts] = useState(ACCOUNTS_SEED);
  const [mode, setMode] = useState("list"); // list | pick | form | discover
  const [provider, setProvider] = useState(null);
  const [form, setForm] = useState({});
  const [connecting, setConnecting] = useState(false);
  const [lists, setLists] = useState([]);
  const [syncingId, setSyncingId] = useState(null);

  useEffect(() => {
    if (open) { setMode("list"); setProvider(null); setForm({}); setConnecting(false); }
  }, [open]);

  if (!open) return null;

  const preset = provider ? PROVIDER_PRESETS[provider] : null;
  const formValid = preset && preset.fields.every((f) => (form[f.key] || "").trim().length > 0);

  const refreshAcct = (id) => {
    setSyncingId(id);
    setAccounts((a) => a.map((x) => x.id === id ? { ...x, status: "syncing" } : x));
    setTimeout(() => {
      setAccounts((a) => a.map((x) => x.id === id ? { ...x, status: "ok" } : x));
      setSyncingId(null);
    }, 1400);
  };
  const deleteAcct = (id) => setAccounts((a) => a.filter((x) => x.id !== id));

  const connect = () => {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      setLists(DISCOVERED_LISTS.map((l) => ({ ...l })));
      setMode("discover");
    }, 1600);
  };
  const finish = () => {
    const label = provider === "apple" ? "Apple iCloud" : provider === "nextcloud" ? `Nextcloud — ${(form.url||"").replace(/^https?:\/\//,"") || "server"}` : "Generic CalDAV";
    setAccounts((a) => [...a, { id: `a${Date.now()}`, provider, label, detail: form.user || "", status: "ok" }]);
    setMode("list"); setProvider(null); setForm({});
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <IconCloud size={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="settings-title">CalDAV Sync</h2>
            <div className="sub">
              {mode === "list" && "Connect calendar & task accounts to sync."}
              {mode === "pick" && "Choose a provider to connect."}
              {mode === "form" && `Connect your ${preset.name} account.`}
              {mode === "discover" && "Choose which lists to sync."}
            </div>
          </div>
          <button className="iconbtn" aria-label="Close settings" onClick={onClose}><IconX size={18} /></button>
        </div>

        <div className="modal-body">
          {/* ---- account list ---- */}
          {mode === "list" && (
            <div>
              {accounts.length === 0 ? (
                <EmptyState icon={IconCloud} title="No accounts connected" sub="Add a CalDAV account to start syncing your tasks and calendars." />
              ) : accounts.map((a) => (
                <div className="acct" key={a.id}>
                  <span className="provider-ic"><ProviderIcon provider={a.provider} /></span>
                  <div className="acct-main">
                    <div className="acct-label">{a.label}</div>
                    <div className="acct-sub">
                      <span className={`status-dot ${a.status === "ok" ? "ok" : a.status === "syncing" ? "syncing" : "err"}`} />
                      {a.status === "ok" && `Connected · ${a.detail}`}
                      {a.status === "syncing" && "Syncing…"}
                      {a.status === "err" && "Sync error"}
                    </div>
                  </div>
                  <div className="acct-actions">
                    <button className="iconbtn sm" aria-label={`Refresh ${a.label}`} onClick={() => refreshAcct(a.id)} disabled={syncingId === a.id}>
                      {syncingId === a.id ? <IconSpinner size={15} /> : <IconRefresh size={15} />}
                    </button>
                    <button className="iconbtn sm danger-hover" aria-label={`Remove ${a.label}`} onClick={() => deleteAcct(a.id)}><IconTrash size={15} /></button>
                  </div>
                </div>
              ))}
              <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => setMode("pick")}>
                <IconPlus size={15} /> Add account
              </button>
            </div>
          )}

          {/* ---- provider picker ---- */}
          {mode === "pick" && (
            <div className="provider-grid">
              {Object.entries(PROVIDER_PRESETS).map(([key, p]) => {
                const I = p.icon;
                return (
                  <button className="provider-card" key={key} onClick={() => { setProvider(key); setForm({}); setMode("form"); }}>
                    <span className="provider-ic"><I size={22} /></span>
                    <span className="pc-name">{p.name}</span>
                    <span className="pc-sub">{key === "apple" ? "iCloud" : key === "nextcloud" ? "Self-hosted" : "Any server"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ---- connect form ---- */}
          {mode === "form" && preset && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="provider-ic"><preset.icon size={20} /></span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{preset.name}</span>
              </div>
              {preset.fields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`f-${f.key}`}>{f.label}</label>
                  <input
                    id={`f-${f.key}`}
                    type={f.type}
                    className="input"
                    placeholder={f.placeholder}
                    value={form[f.key] || ""}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                  {f.hint && <span className="hint"><IconKey size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{f.hint}</span>}
                </div>
              ))}
            </div>
          )}

          {/* ---- discovered lists ---- */}
          {mode === "discover" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--green)", fontSize: 13, fontWeight: 600 }}>
                <IconCheck size={16} /> Connected — found {lists.length} lists
              </div>
              <div className="disc-list">
                {lists.map((l) => (
                  <div className="disc-row" key={l.id}>
                    <span className="disc-swatch" style={{ background: l.color }} />
                    <span className="disc-name">{l.name}</span>
                    <span className="disc-count">{l.count} tasks</span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="switch"
                      checked={l.on}
                      aria-label={`Sync ${l.name}`}
                      aria-checked={l.on}
                      onChange={() => setLists((ls) => ls.map((x) => x.id === l.id ? { ...x, on: !x.on } : x))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---- footer ---- */}
        <div className="modal-foot">
          {mode === "list" && <button className="btn primary" onClick={onClose}>Done</button>}
          {mode === "pick" && <button className="btn ghost" onClick={() => setMode("list")}>Back</button>}
          {mode === "form" && (
            <>
              <button className="btn ghost" onClick={() => setMode("pick")} disabled={connecting}>Back</button>
              <button className="btn primary" onClick={connect} disabled={!formValid || connecting}>
                {connecting ? <><IconSpinner size={15} /> Connecting…</> : <><IconLink size={15} /> Connect</>}
              </button>
            </>
          )}
          {mode === "discover" && (
            <>
              <button className="btn ghost" onClick={() => { setMode("list"); setProvider(null); }}>Cancel</button>
              <button className="btn primary" onClick={finish}><IconCheck size={15} /> Save {lists.filter(l=>l.on).length} lists</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsModal, useModal, PROVIDER_PRESETS, ProviderIcon });
