import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../data/api.js'
import { emitTasksChanged } from '../../data/tasksbus.js'
import { IconBell, IconSpinner, IconTrash } from '../../widget-sdk/icons.jsx'

// Reminder groups → calendars: create a group (it gets its own calendar /
// synced task list), remap a group to another calendar, or delete it.
export default function ReminderGroupsSection({ initialCreate }) {
  const [data, setData] = useState(null) // { groups, calendars }
  const [busy, setBusy] = useState(null) // group name in flight
  const [confirmDel, setConfirmDel] = useState(null)
  const [delCal, setDelCal] = useState(false)
  const [newName, setNewName] = useState(initialCreate || '')
  const [newCal, setNewCal] = useState('__new') // '__new' = create a calendar named after the group
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState(null) // last create/remap/delete failure
  const [loadErr, setLoadErr] = useState(false) // initial load failed (vs. genuinely empty)
  const rootRef = useRef(null)
  const nameRef = useRef(null)
  const load = useCallback(() => {
    return api('/api/reminder-groups')
      .then((d) => { setData(d); setLoadErr(false) })
      .catch(() => { setData({ groups: [], calendars: [] }); setLoadErr(true) })
  }, [])
  useEffect(() => { load() }, [load])

  // Opened via "＋ New group…" from a picker — prefill, scroll into view, focus.
  useEffect(() => {
    if (!initialCreate) return undefined
    setNewName(initialCreate)
    const t = setTimeout(() => { rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); nameRef.current?.focus() }, 80)
    return () => clearTimeout(t)
  }, [initialCreate])

  const remap = async (group, value) => {
    setBusy(group); setErr(null)
    try {
      if (value === '__new') await api('/api/reminder-groups', { method: 'PUT', body: JSON.stringify({ group, createNew: true }) })
      else {
        let id = value
        if (value === '') { const rem = data.calendars.find((c) => /^reminders$/i.test(c.name)); id = rem ? rem.id : null }
        if (id) await api('/api/reminder-groups', { method: 'PUT', body: JSON.stringify({ group, listId: Number(id) }) })
      }
      await load(); emitTasksChanged()
    } catch { setErr('Couldn’t move that group — check your server and try again.') } finally { setBusy(null) }
  }
  const del = async (group) => {
    setBusy(group); setErr(null)
    try { await api('/api/reminder-groups?group=' + encodeURIComponent(group) + '&deleteCalendar=' + (delCal ? '1' : '0'), { method: 'DELETE' }); setConfirmDel(null); setDelCal(false); await load(); emitTasksChanged() } catch { setErr('Couldn’t delete that group — check your server and try again.') } finally { setBusy(null) }
  }
  const create = async (e) => {
    e?.preventDefault()
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true); setErr(null)
    try {
      const body = newCal === '__new' ? { group: name, createNew: true } : { group: name, listId: Number(newCal) }
      await api('/api/reminder-groups', { method: 'PUT', body: JSON.stringify(body) })
      setNewName(''); setNewCal('__new'); await load(); emitTasksChanged() // refresh widget group pickers
    } catch { setErr('Couldn’t create that group — check your server and try again.') } finally { setCreating(false) }
  }

  const calendars = (data && data.calendars) || []
  return (
    <div className="notes-cfg" ref={rootRef}>
      <div className="notes-cfg-head"><IconBell size={16} /> <span>Reminder groups → calendars</span></div>
      <div className="notes-cfg-sub">Create a group here and it gets its own calendar (synced as its own task list). Each group’s reminders live in its calendar; changing the calendar moves them.</div>
      <form className="rg-new" onSubmit={create}>
        <input ref={nameRef} className="input rg-newname" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New group name" aria-label="New group name" />
        <select className="input rg-newcal" value={newCal} onChange={(e) => setNewCal(e.target.value)} aria-label="Calendar for the new group">
          <option value="__new">＋ New calendar</option>
          {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="btn primary sm" disabled={creating || !newName.trim()}>{creating ? <IconSpinner size={14} /> : 'Add'}</button>
      </form>
      {err && <div className="rem-err" role="alert">{err}</div>}
      {loadErr && <div className="rem-err" role="alert">Couldn’t load reminder groups — check your server.</div>}
      {data && data.groups.length > 0 && (
      <div className="rg-list">
        {data.groups.map((g) => (
          <div className="rg-row" key={g.name}>
            <span className="rg-name">{g.name}<span className="rg-count">{g.count}</span></span>
            {confirmDel === g.name ? (
              <span className="rg-confirm">
                <label className="rg-delcal"><input type="checkbox" checked={delCal} onChange={(e) => setDelCal(e.target.checked)} /> also delete the calendar</label>
                <button className="btn sm danger" onClick={() => del(g.name)} disabled={busy === g.name}>Delete</button>
                <button className="btn sm ghost" onClick={() => { setConfirmDel(null); setDelCal(false) }}>Cancel</button>
              </span>
            ) : (
              <span className="rg-actions">
                <select className="input rg-cal" value={g.listId || ''} onChange={(e) => remap(g.name, e.target.value)} disabled={busy === g.name} aria-label={`Calendar for ${g.name}`}>
                  <option value="">Default (Reminders)</option>
                  {data.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new">＋ Create new calendar</option>
                </select>
                {busy === g.name && <IconSpinner size={14} />}
                <button className="iconbtn sm danger-hover" title="Delete group" aria-label={`Delete group ${g.name}`} onClick={() => { setConfirmDel(g.name); setDelCal(false) }}><IconTrash size={14} /></button>
              </span>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
