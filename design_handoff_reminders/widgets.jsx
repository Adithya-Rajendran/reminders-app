/* ============================================================
   Reminders — WidgetFrame + state helpers + list widgets
   ============================================================ */
const { useState, useEffect, useRef, useMemo, useCallback, useContext, createContext } = React;

/* demo-state context: lets the Tweaks panel force every widget into a
   given state (loading / empty / error) to showcase those states. */
const WidgetDemoCtx = createContext({ state: "normal" });
function useEffState(localState, isEmpty) {
  const demo = useContext(WidgetDemoCtx);
  if (demo.state === "loading") return { state: "loading", empty: false };
  if (demo.state === "error") return { state: "error", empty: false };
  if (demo.state === "empty") return { state: "ready", empty: true };
  return { state: localState, empty: isEmpty };
}

/* ---------- shared widget states ---------- */
function SkeletonRows({ n = 5 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div className="skel-task" key={i}>
          <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 6, flex: "0 0 auto" }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skel-line" style={{ width: `${62 + (i*13)%30}%` }} />
            <div className="skeleton skel-line" style={{ width: `${30 + (i*17)%24}%`, marginTop: 7, height: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, sub }) {
  const I = icon || IconCheck;
  return (
    <div className="state">
      <div className="state-ic"><I size={22} /></div>
      <div className="state-title">{title}</div>
      {sub && <div className="state-sub">{sub}</div>}
    </div>
  );
}

function ErrorState({ sub, onRetry }) {
  return (
    <div className="state error" role="alert">
      <div className="state-ic"><IconCloud size={22} /></div>
      <div className="state-title">Couldn’t load</div>
      <div className="state-sub">{sub || "The sync request failed. Check your connection and try again."}</div>
      <button className="btn ghost sm" onClick={onRetry} style={{ marginTop: 4 }}>
        <IconRefresh size={14} /> Retry
      </button>
    </div>
  );
}

// Wraps body content; resolves loading/empty/error before showing children.
function WidgetBody({ state, onRetry, isEmpty, emptyProps, skeletonN, children }) {
  const eff = useEffState(state, isEmpty);
  return (
    <div className="widget-body">
      {eff.state === "loading" && <SkeletonRows n={skeletonN} />}
      {eff.state === "error" && <ErrorState onRetry={onRetry} />}
      {eff.state === "ready" && (eff.empty ? <EmptyState {...emptyProps} /> : children)}
    </div>
  );
}

/* ---------- WidgetFrame ---------- */
function WidgetFrame({ widget, title, icon, count, accent, onRemove, onGripDown, onResizeDown, lifted, children }) {
  const Ic = icon;
  return (
    <div className={`widget${lifted ? " lifted" : ""}`} data-screen-label={`Widget: ${title}`}>
      <div className="widget-head">
        <span
          className="widget-grip"
          title="Drag to move"
          aria-label="Drag to move widget"
          role="button"
          tabIndex={0}
          onPointerDown={onGripDown}
        >
          <IconGrip size={16} />
        </span>
        <span className="widget-title">
          {Ic && <Ic size={17} style={accent ? { color: accent } : undefined} />}
          <span className="t-text">{title}</span>
        </span>
        {typeof count === "number" && <span className="widget-count">{count}</span>}
        <span className="widget-head-actions">
          <button
            className="iconbtn sm danger-hover widget-remove"
            aria-label={`Remove ${title} widget`}
            title="Remove widget"
            onClick={onRemove}
          >
            <IconX size={15} />
          </button>
        </span>
      </div>
      {children}
      <span
        className="resize-handle"
        title="Resize"
        aria-hidden="true"
        onPointerDown={onResizeDown}
      >
        <IconResize size={15} />
      </span>
    </div>
  );
}

/* ---------- Task row ---------- */
function TaskRow({ task, onToggle }) {
  const chip = dueChip(task.due);
  return (
    <div className={`task${task.done ? " checked" : ""}`}>
      <input
        type="checkbox"
        className="check"
        checked={task.done}
        onChange={onToggle}
        aria-label={`${task.done ? "Mark incomplete" : "Complete"}: ${task.title}`}
        style={{ marginTop: 1 }}
      />
      <div className="task-main">
        <div className="task-title">
          {task.priority <= 3 && <span className={`pdot p${task.priority}`} title={`Priority ${task.priority}`} />}
          <span className="t">{task.title}</span>
        </div>
        {(chip) && (
          <div className="task-sub">
            {chip && <span className={`chip ${chip.cls}`}><IconClock size={12} /> {chip.label}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Add row ---------- */
function AddTaskRow({ onAdd, placeholder = "Add a task…" }) {
  const [val, setVal] = useState("");
  const ref = useRef(null);
  const submit = () => {
    const v = val.trim();
    if (v) { onAdd(v); setVal(""); }
  };
  return (
    <div className="add-row" onClick={() => ref.current && ref.current.focus()}>
      <IconPlus size={16} />
      <input
        ref={ref}
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        onBlur={submit}
        aria-label="Add a task"
      />
    </div>
  );
}

/* ---------- Task List widget ---------- */
function TaskListWidget({ widget, frameProps, store }) {
  const proj = PROJECTS.find((p) => p.id === widget.projectId) || PROJECTS[0];
  const tasks = store.tasks.filter((t) => t.project === proj.id);
  const open = tasks.filter((t) => !t.done).length;
  return (
    <WidgetFrame {...frameProps} title={proj.name} icon={IconList} accent={proj.color} count={open}>
      <WidgetBody
        state={widget._state}
        onRetry={frameProps.onRetry}
        isEmpty={tasks.length === 0}
        emptyProps={{ icon: IconCheck, title: "All clear", sub: "No tasks in this project yet. Add one below to get started." }}
        skeletonN={5}
      >
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onToggle={() => store.toggleTask(t.id)} />
        ))}
        <AddTaskRow onAdd={(title) => store.addTask(proj.id, title)} placeholder={`Add to ${proj.name}…`} />
      </WidgetBody>
    </WidgetFrame>
  );
}

/* ---------- Upcoming widget ---------- */
function UpcomingWidget({ widget, frameProps, store }) {
  const groups = useMemo(() => {
    const items = store.tasks.filter((t) => !t.done && t.due);
    items.sort((a, b) => a.due - b.due);
    const g = { today: [], tomorrow: [], week: [], later: [] };
    items.forEach((t) => {
      const diff = Math.round((startOfDay(t.due) - TODAY) / 86400000);
      if (diff <= 0) g.today.push(t);
      else if (diff === 1) g.tomorrow.push(t);
      else if (diff <= 7) g.week.push(t);
      else g.later.push(t);
    });
    return g;
  }, [store.tasks]);

  const sections = [
    { key: "today", label: "Today", date: relDay(TODAY) + " · " + `${MON_ABBR[TODAY.getMonth()]} ${TODAY.getDate()}`, items: groups.today },
    { key: "tomorrow", label: "Tomorrow", date: `${MON_ABBR[addDays(TODAY,1).getMonth()]} ${addDays(TODAY,1).getDate()}`, items: groups.tomorrow },
    { key: "week", label: "This week", date: "Next 7 days", items: groups.week },
  ].filter((s) => s.items.length);

  const total = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <WidgetFrame {...frameProps} title="Upcoming" icon={IconClock} count={total}>
      <WidgetBody
        state={widget._state}
        onRetry={frameProps.onRetry}
        isEmpty={total === 0}
        emptyProps={{ icon: IconCheck, title: "Nothing scheduled", sub: "Tasks with a due date in the next week will show up here." }}
        skeletonN={6}
      >
        {sections.map((s) => (
          <div key={s.key}>
            <div className="group-head">
              <span className="g-title">{s.label}</span>
              <span className="g-date">{s.date}</span>
              <span className="g-count">{s.items.length}</span>
            </div>
            {s.items.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={() => store.toggleTask(t.id)} />
            ))}
          </div>
        ))}
      </WidgetBody>
    </WidgetFrame>
  );
}

/* ---------- Reminders feed widget ---------- */
function feedIcon(type) {
  if (type === "due") return { I: IconBell, cls: "due" };
  if (type === "done") return { I: IconCheck, cls: "done" };
  if (type === "add") return { I: IconPlus, cls: "add" };
  return { I: IconRefresh, cls: "sync" };
}
function FeedItem({ item, fresh }) {
  const { I, cls } = feedIcon(item.type);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={`feed-item${fresh ? " fresh" : ""}`}>
      <span className={`feed-ic ${cls}`}><I size={16} /></span>
      <div className="feed-main">
        <div className="feed-text" dangerouslySetInnerHTML={{ __html: item.html }} />
        <div className="feed-time">{relTime(item.at)}</div>
      </div>
    </div>
  );
}
function RemindersFeedWidget({ widget, frameProps, store }) {
  const eff = useEffState(widget._state, store.feed.length === 0);
  return (
    <WidgetFrame {...frameProps} title="Reminders" icon={IconBell} count={store.feed.length}>
      <div className="widget-body" aria-live="polite" aria-label="Live reminders feed">
        {eff.state === "loading" && <SkeletonRows n={4} />}
        {eff.state === "error" && <ErrorState sub="Lost connection to the event stream." onRetry={frameProps.onRetry} />}
        {eff.state === "ready" && (
          eff.empty
            ? <EmptyState icon={IconBell} title="No reminders yet" sub="New events stream in here as they happen." />
            : store.feed.map((it, i) => <FeedItem key={it.id} item={it} fresh={i === 0 && it._new} />)
        )}
      </div>
    </WidgetFrame>
  );
}

/* ---------- CalDAV tasks widget ---------- */
function CalDavWidget({ widget, frameProps, store }) {
  const tasks = store.caldav;
  return (
    <WidgetFrame {...frameProps} title="CalDAV Tasks" icon={IconCloud} accent="var(--accent2)" count={tasks.filter(t=>!t.done).length}>
      <WidgetBody
        state={widget._state}
        onRetry={frameProps.onRetry}
        isEmpty={tasks.length === 0}
        emptyProps={{ icon: IconCloud, title: "No synced tasks", sub: "Enable a list in CalDAV Sync settings to pull tasks in." }}
        skeletonN={5}
      >
        {tasks.map((t) => {
          const list = CALDAV_LISTS.find((l) => l.id === t.list);
          const chip = dueChip(t.due);
          return (
            <div className={`cd-task${t.done ? " checked" : ""}`} key={t.id}>
              <span className="cd-bar" style={{ background: list.color }} />
              <input
                type="checkbox"
                className="check"
                checked={t.done}
                onChange={() => store.toggleCaldav(t.id)}
                aria-label={`Complete: ${t.title}`}
                style={{ marginTop: 1 }}
              />
              <div className="task-main">
                <div className={`task-title`} style={t.done ? { color: "var(--faint)", textDecoration: "line-through" } : undefined}>
                  <span className="t">{t.title}</span>
                </div>
                <div className="task-sub">
                  <span className="source-tag"><span className="sdot" style={{ background: list.color }} />{list.name} · {list.account}</span>
                  {chip && <span className={`chip ${chip.cls}`}>{chip.label}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </WidgetBody>
    </WidgetFrame>
  );
}

Object.assign(window, {
  WidgetDemoCtx, useEffState,
  SkeletonRows, EmptyState, ErrorState, WidgetBody, WidgetFrame,
  TaskRow, AddTaskRow,
  TaskListWidget, UpcomingWidget, RemindersFeedWidget, CalDavWidget,
  FeedItem, feedIcon,
});
