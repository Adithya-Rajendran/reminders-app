/* ============================================================
   Reminders — App root (state, grid, theme, tweaks)
   ============================================================ */

const DEFAULT_WIDGETS = [
  { uid: "w1", type: "tasklist", projectId: "redesign", w: 2, h: 5 },
  { uid: "w2", type: "upcoming", w: 2, h: 5 },
  { uid: "w3", type: "calendar", w: 2, h: 5 },
  { uid: "w4", type: "feed", w: 3, h: 4 },
  { uid: "w5", type: "caldav", w: 3, h: 4 },
];
const DEFAULT_SIZE = {
  tasklist: { w: 2, h: 5 }, upcoming: { w: 2, h: 5 }, calendar: { w: 2, h: 5 },
  feed: { w: 3, h: 4 }, caldav: { w: 3, h: 4 },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": ["#6d6cf7", "#a855f7"],
  "glassBlur": 12,
  "glow": 1,
  "density": 1,
  "demoState": "normal"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  /* ---------- auth + theme ---------- */
  const [authed, setAuthed] = useState(() => localStorage.getItem("reminders-authed") === "1");
  const [theme, setTheme] = useState(() => localStorage.getItem("reminders-theme") || "dark");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("reminders-theme", theme);
  }, [theme]);

  /* ---------- apply visual tweaks ---------- */
  useEffect(() => {
    const r = document.documentElement.style;
    const [a1, a2] = t.accent;
    r.setProperty("--accent", a1);
    r.setProperty("--accent2", a2);
    r.setProperty("--accent-soft", `color-mix(in oklab, ${a1} 16%, transparent)`);
    r.setProperty("--glass-blur", `${t.glassBlur}px`);
    r.setProperty("--glow-strength", String(t.glow));
    r.setProperty("--density", String(t.density));
  }, [t.accent, t.glassBlur, t.glow, t.density]);

  /* ---------- data store ---------- */
  const [tasks, setTasks] = useState(TASKS);
  const [caldav, setCaldav] = useState(CALDAV_TASKS);
  const [feed, setFeed] = useState(SEED_FEED);

  const store = useMemo(() => ({
    tasks, caldav, feed,
    toggleTask: (id) => setTasks((ts) => ts.map((x) => x.id === id ? { ...x, done: !x.done } : x)),
    addTask: (project, title) => setTasks((ts) => [
      ...ts, { id: `t${Date.now()}`, title, done: false, priority: 4, due: null, project },
    ]),
    toggleCaldav: (id) => setCaldav((cs) => cs.map((x) => x.id === id ? { ...x, done: !x.done } : x)),
  }), [tasks, caldav, feed]);

  /* ---------- simulated SSE feed ---------- */
  useEffect(() => {
    if (!authed) return;
    const tick = () => setFeed((f) => {
      const item = { ...makeFeedItem(), _new: true };
      const rest = f.map((x) => ({ ...x, _new: false }));
      return [item, ...rest].slice(0, 40);
    });
    const id = setInterval(tick, 9000 + Math.random() * 3000);
    return () => clearInterval(id);
  }, [authed]);

  /* ---------- widgets + per-widget load ---------- */
  const [widgets, setWidgets] = useState(() => DEFAULT_WIDGETS.map((w) => ({ ...w, _state: "loading" })));
  const loadTimers = useRef([]);

  useEffect(() => {
    // initial staggered load
    widgets.forEach((w, i) => {
      const id = setTimeout(() => {
        setWidgets((ws) => ws.map((x) => x.uid === w.uid ? { ...x, _state: "ready" } : x));
      }, 500 + i * 160);
      loadTimers.current.push(id);
    });
    return () => loadTimers.current.forEach(clearTimeout);
    // eslint-disable-next-line
  }, []);

  const retryWidget = (uid) => {
    setWidgets((ws) => ws.map((x) => x.uid === uid ? { ...x, _state: "loading" } : x));
    setTimeout(() => setWidgets((ws) => ws.map((x) => x.uid === uid ? { ...x, _state: "ready" } : x)), 850);
  };
  const addWidget = (type, projectId) => {
    const uid = `w${Date.now()}`;
    const size = DEFAULT_SIZE[type] || { w: 2, h: 4 };
    setWidgets((ws) => [...ws, { uid, type, projectId, ...size, _state: "loading" }]);
    setTimeout(() => setWidgets((ws) => ws.map((x) => x.uid === uid ? { ...x, _state: "ready" } : x)), 750);
  };
  const removeWidget = (uid) => setWidgets((ws) => ws.filter((x) => x.uid !== uid));

  /* ---------- drag to reorder ---------- */
  const gridRef = useRef(null);
  const [drag, setDrag] = useState(null);     // { uid, overUid }
  const dragRef = useRef(null);

  const onGripDown = (e, uid) => {
    if (e.pointerType === "touch" || window.innerWidth <= 560) return;
    e.preventDefault();
    dragRef.current = { uid, overUid: uid };
    setDrag({ uid, overUid: uid });
    const move = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const gi = el && el.closest("[data-uid]");
      const overUid = gi ? gi.getAttribute("data-uid") : dragRef.current.overUid;
      if (overUid !== dragRef.current.overUid) {
        dragRef.current = { ...dragRef.current, overUid };
        setDrag({ ...dragRef.current });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current;
      if (d && d.overUid && d.overUid !== d.uid) {
        setWidgets((ws) => {
          const from = ws.findIndex((x) => x.uid === d.uid);
          const to = ws.findIndex((x) => x.uid === d.overUid);
          if (from < 0 || to < 0) return ws;
          const next = ws.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ---------- resize ---------- */
  const onResizeDown = (e, uid) => {
    if (e.pointerType === "touch" || window.innerWidth <= 560) return;
    e.preventDefault(); e.stopPropagation();
    const cs = getComputedStyle(gridRef.current);
    const cols = cs.gridTemplateColumns.split(" ").length;
    const rowH = parseFloat(cs.gridAutoRows) || 80;
    const gap = parseFloat(cs.gap) || 16;
    const gridW = gridRef.current.clientWidth;
    const cellW = (gridW - gap * (cols - 1)) / cols;
    const w0 = widgets.find((x) => x.uid === uid);
    const start = { x: e.clientX, y: e.clientY, w: w0.w, h: w0.h };
    document.body.style.cursor = "nwse-resize";
    const move = (ev) => {
      const dCol = Math.round((ev.clientX - start.x) / (cellW + gap));
      const dRow = Math.round((ev.clientY - start.y) / (rowH + gap));
      const nw = clamp(start.w + dCol, 1, cols);
      const nh = clamp(start.h + dRow, 3, 12);
      setWidgets((ws) => ws.map((x) => x.uid === uid ? { ...x, w: nw, h: nh } : x));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ---------- auth handlers ---------- */
  const signIn = () => { setAuthed(true); localStorage.setItem("reminders-authed", "1"); };
  const logout = () => { setAuthed(false); localStorage.removeItem("reminders-authed"); setSettingsOpen(false); };

  /* ---------- render a widget ---------- */
  const renderWidget = (w) => {
    const frameProps = {
      widget: w,
      onGripDown: (e) => onGripDown(e, w.uid),
      onResizeDown: (e) => onResizeDown(e, w.uid),
      onRemove: () => removeWidget(w.uid),
      onRetry: () => retryWidget(w.uid),
      lifted: drag && drag.uid === w.uid,
    };
    switch (w.type) {
      case "tasklist": return <TaskListWidget widget={w} frameProps={frameProps} store={store} />;
      case "upcoming": return <UpcomingWidget widget={w} frameProps={frameProps} store={store} />;
      case "feed": return <RemindersFeedWidget widget={w} frameProps={frameProps} store={store} />;
      case "caldav": return <CalDavWidget widget={w} frameProps={frameProps} store={store} />;
      case "calendar": return <CalendarWidget widget={w} frameProps={frameProps} store={store} />;
      default: return null;
    }
  };

  return (
    <>
      <div className="app-bg" />
      {!authed ? (
        <Login onSignIn={signIn} />
      ) : (
        <div className="app">
          <TopBar
            theme={theme}
            onToggleTheme={() => setTheme((th) => th === "dark" ? "light" : "dark")}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={logout}
          />
          <Toolbar onAdd={addWidget} />
          <div className="grid-wrap">
            <WidgetDemoCtx.Provider value={{ state: t.demoState }}>
              {widgets.length === 0 ? (
                <div className="glass" style={{ borderRadius: "var(--r-card)", padding: "48px 24px", textAlign: "center", maxWidth: 460, margin: "40px auto" }}>
                  <div className="state-ic" style={{ margin: "0 auto 12px" }}><IconInbox size={22} /></div>
                  <div className="state-title" style={{ fontSize: 16 }}>Your dashboard is empty</div>
                  <div className="state-sub" style={{ margin: "6px auto 18px" }}>Add a widget to start assembling your workspace.</div>
                  <AddWidgetMenu onAdd={addWidget} />
                </div>
              ) : (
                <div className={`grid${drag ? " dragging" : ""}`} ref={gridRef}>
                  {widgets.map((w) => (
                    <div
                      key={w.uid}
                      data-uid={w.uid}
                      className={`gi${drag && drag.uid === w.uid ? " drag-source" : ""}${drag && drag.overUid === w.uid && drag.uid !== w.uid ? " drag-over" : ""}`}
                      style={{ gridColumn: `span ${w.w}`, gridRow: `span ${w.h}` }}
                    >
                      {renderWidget(w)}
                    </div>
                  ))}
                </div>
              )}
            </WidgetDemoCtx.Provider>
          </div>
        </div>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* ---------- Tweaks ---------- */}
      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakColor
          label="Accent" value={t.accent}
          options={[["#6d6cf7", "#a855f7"], ["#3b82f6", "#06b6d4"], ["#10b981", "#14b8a6"], ["#f43f5e", "#fb923c"], ["#f59e0b", "#ef4444"]]}
          onChange={(v) => setTweak("accent", v)}
        />
        <TweakSlider label="Glass blur" value={t.glassBlur} min={0} max={24} step={1} unit="px" onChange={(v) => setTweak("glassBlur", v)} />
        <TweakSlider label="Glow strength" value={t.glow} min={0} max={1.8} step={0.1} onChange={(v) => setTweak("glow", v)} />
        <TweakSlider label="Density" value={t.density} min={0.85} max={1.25} step={0.05} onChange={(v) => setTweak("density", v)} />
        <TweakSection label="Showcase widget states" />
        <TweakRadio
          label="State" value={t.demoState}
          options={["normal", "loading", "empty", "error"]}
          onChange={(v) => setTweak("demoState", v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
