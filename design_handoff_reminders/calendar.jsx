/* ============================================================
   Reminders — Calendar widget (Month / Week / Day / Agenda)
   ============================================================ */
const CAL_VIEWS = ["Month", "Week", "Day", "Agenda"];
const DAY_START = 7;   // 7 AM
const DAY_END = 23;    // 11 PM
const HOUR_PX = 44;

function eventsOn(day) {
  return EVENTS.filter((e) => sameDay(e.start, day)).sort((a, b) => a.start - b.start);
}
function weekStart(d) { const x = startOfDay(d); return addDays(x, -x.getDay()); }

/* ---------- Month ---------- */
function MonthView({ ref0, onPick }) {
  const first = new Date(ref0.getFullYear(), ref0.getMonth(), 1);
  const gridStart = addDays(startOfDay(first), -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return (
    <div className="month">
      <div className="dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="month-grid">
        {cells.map((day, i) => {
          const out = day.getMonth() !== ref0.getMonth();
          const today = sameDay(day, TODAY);
          const evts = eventsOn(day);
          return (
            <div className={`day-cell${out ? " out" : ""}${today ? " today" : ""}`} key={i}>
              <span className="day-num">{day.getDate()}</span>
              {evts.slice(0, 3).map((e) => (
                <span className="evt-pill" key={e.id} style={{ background: e.color }} title={`${fmtTime(e.start)} · ${e.title}`}>{e.title}</span>
              ))}
              {evts.length > 3 && <span className="evt-more">+{evts.length - 3} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Time grid (Week + Day) ---------- */
function TimeColumn({ day }) {
  const evts = eventsOn(day);
  return (
    <div className="tg-col">
      {Array.from({ length: DAY_END - DAY_START }).map((_, i) => (
        <div className="hourline" key={i} />
      ))}
      {evts.map((e) => {
        const sh = e.start.getHours() + e.start.getMinutes() / 60;
        const eh = e.end.getHours() + e.end.getMinutes() / 60;
        const top = (Math.max(sh, DAY_START) - DAY_START) * HOUR_PX;
        const h = Math.max(18, (Math.min(eh, DAY_END) - Math.max(sh, DAY_START)) * HOUR_PX - 3);
        return (
          <div className="tg-evt" key={e.id} style={{ top, height: h, background: e.color }} title={`${fmtTime(e.start)}–${fmtTime(e.end)} · ${e.title}`}>
            <div>{e.title}</div>
            {h > 30 && <div className="te-time">{fmtTime(e.start)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ ref0 }) {
  const ws = weekStart(ref0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  return (
    <div className="timegrid week">
      <div className="tg-corner" />
      {days.map((d, i) => (
        <div className={`tg-dayhead${sameDay(d, TODAY) ? " today" : ""}`} key={i}>{DOW[d.getDay()]} {d.getDate()}</div>
      ))}
      <div className="tg-times">
        {hours.map((h) => <div className="tg-hour" key={h}>{fmtTime(atTime(TODAY, h))}</div>)}
      </div>
      {days.map((d, i) => <TimeColumn day={d} key={i} />)}
    </div>
  );
}

function DayView({ ref0 }) {
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  return (
    <div className="timegrid">
      <div className="tg-corner" />
      <div className={`tg-dayhead${sameDay(ref0, TODAY) ? " today" : ""}`}>{DOW_FULL[ref0.getDay()]}, {MON_ABBR[ref0.getMonth()]} {ref0.getDate()}</div>
      <div className="tg-times">
        {hours.map((h) => <div className="tg-hour" key={h}>{fmtTime(atTime(TODAY, h))}</div>)}
      </div>
      <TimeColumn day={ref0} />
    </div>
  );
}

/* ---------- Agenda ---------- */
function AgendaView({ ref0 }) {
  const days = [];
  for (let i = 0; i < 21; i++) {
    const d = addDays(startOfDay(ref0), i);
    const evts = eventsOn(d);
    if (evts.length) days.push({ d, evts });
    if (days.length >= 8) break;
  }
  if (!days.length) {
    return <EmptyState icon={IconCalendar} title="Nothing on the agenda" sub="No events scheduled in the coming weeks." />;
  }
  return (
    <div>
      {days.map(({ d, evts }) => (
        <div className="agenda-day" key={d.toISOString()}>
          <div className="agenda-date">{relDay(d)}<span className="ad-sub">{DOW_FULL[d.getDay()]}, {MON_ABBR[d.getMonth()]} {d.getDate()}</span></div>
          {evts.map((e) => (
            <div className="agenda-evt" key={e.id}>
              <span className="agenda-time">{fmtTime(e.start)}</span>
              <span className="agenda-bar" style={{ background: e.color }} />
              <div style={{ minWidth: 0 }}>
                <div className="agenda-title">{e.title}</div>
                <div className="feed-time">{fmtTime(e.start)} – {fmtTime(e.end)}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- Calendar widget shell ---------- */
function CalendarWidget({ widget, frameProps, store }) {
  const [view, setView] = useState(widget.view || "Month");
  const [ref0, setRef0] = useState(TODAY);
  const eff = useEffState(widget._state, false);

  const step = (dir) => {
    if (view === "Month") setRef0(new Date(ref0.getFullYear(), ref0.getMonth() + dir, 1));
    else if (view === "Week") setRef0(addDays(ref0, 7 * dir));
    else if (view === "Day") setRef0(addDays(ref0, dir));
    else setRef0(addDays(ref0, 7 * dir));
  };
  const goToday = () => setRef0(TODAY);

  const period = useMemo(() => {
    if (view === "Month") return `${MONTHS[ref0.getMonth()]} ${ref0.getFullYear()}`;
    if (view === "Day") return `${DOW_FULL[ref0.getDay()]}, ${MON_ABBR[ref0.getMonth()]} ${ref0.getDate()}`;
    const ws = weekStart(ref0), we = addDays(ws, 6);
    if (ws.getMonth() === we.getMonth()) return `${MON_ABBR[ws.getMonth()]} ${ws.getDate()} – ${we.getDate()}`;
    return `${MON_ABBR[ws.getMonth()]} ${ws.getDate()} – ${MON_ABBR[we.getMonth()]} ${we.getDate()}`;
  }, [view, ref0]);

  return (
    <WidgetFrame {...frameProps} title="Calendar" icon={IconCalendar}>
      {eff.state === "loading" ? (
        <div className="widget-body"><SkeletonRows n={6} /></div>
      ) : eff.state === "error" ? (
        <div className="widget-body"><ErrorState sub="Couldn’t reach the calendar source." onRetry={frameProps.onRetry} /></div>
      ) : eff.empty ? (
        <div className="widget-body"><EmptyState icon={IconCalendar} title="No calendar connected" sub="Connect a CalDAV calendar to see your events here." /></div>
      ) : (
        <div className="cal">
          <div className="cal-toolbar">
            <div className="seg" role="tablist" aria-label="Calendar view">
              {CAL_VIEWS.map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  className={view === v ? "on" : ""}
                  onClick={() => setView(v)}
                >{v}</button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <div className="cal-nav">
              <button className="iconbtn sm" aria-label="Previous" onClick={() => step(-1)}><IconChevL size={16} /></button>
              <button className="btn ghost sm" onClick={goToday}>Today</button>
              <button className="iconbtn sm" aria-label="Next" onClick={() => step(1)}><IconChevR size={16} /></button>
            </div>
            <span className="cal-period" style={{ marginLeft: 4 }}>{period}</span>
          </div>
          <div className="cal-body">
            {view === "Month" && <MonthView ref0={ref0} />}
            {view === "Week" && <WeekView ref0={ref0} />}
            {view === "Day" && <DayView ref0={ref0} />}
            {view === "Agenda" && <AgendaView ref0={ref0} />}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}

Object.assign(window, {
  CalendarWidget, MonthView, WeekView, DayView, AgendaView,
  CAL_VIEWS,
});
