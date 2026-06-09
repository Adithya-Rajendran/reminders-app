import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { useModalRef } from './useModalRef.js'
import ReminderGroupsSection from './settings/ReminderGroupsSection.jsx'
import NotesFolderSection from './settings/NotesFolderSection.jsx'
import { PROVIDER_PRESETS, ProviderIcon, deriveName, swatchFor } from './settings/providers.jsx'
import {
  IconCloud, IconX, IconPlus, IconTrash, IconRefresh, IconSpinner,
  IconCheck, IconKey, IconLink,
} from './icons.jsx'

export default function SettingsModal({ onClose, initialCreateGroup }) {
  const ref = useModalRef(onClose)

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusMap, setStatusMap] = useState({}) // id -> 'ok' | 'syncing' | 'err'
  const [busyId, setBusyId] = useState(null)

  const [mode, setMode] = useState('list') // list | pick | form | discover
  const [provider, setProvider] = useState(null)
  const [form, setForm] = useState({})
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)

  const [activeId, setActiveId] = useState(null) // account whose lists are shown in discover
  const [lists, setLists] = useState([])
  const [counts, setCounts] = useState({}) // listName -> task count (best-effort)

  const preset = provider ? PROVIDER_PRESETS[provider] : null
  const formValid = !!preset && preset.fields.every((f) => (form[f.key] || '').trim().length > 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api('/api/caldav/accounts')
      setAccounts(data.accounts || [])
    } catch { /* leave existing accounts */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const setStatus = (id, s) => setStatusMap((m) => ({ ...m, [id]: s }))

  // Best-effort task counts for the discovered lists (real CalDAV tasks feed).
  const fetchCounts = useCallback((id) => {
    api('/api/caldav/tasks').then((data) => {
      const m = {}
      for (const t of data.tasks || []) {
        if (t.accountId === id && t.listName) m[t.listName] = (m[t.listName] || 0) + 1
      }
      setCounts(m)
    }).catch(() => { /* counts are decorative */ })
  }, [])

  const enterDiscover = (id, ls) => {
    setActiveId(id)
    setLists(ls || [])
    setCounts({})
    fetchCounts(id)
    setMode('discover')
  }

  const refreshAcct = async (id) => {
    setBusyId(id)
    setStatus(id, 'syncing')
    try {
      const data = await api(`/api/caldav/accounts/${id}/discover`, { method: 'POST' })
      setStatus(id, 'ok')
      enterDiscover(id, data.lists)
    } catch {
      setStatus(id, 'err')
    } finally {
      setBusyId(null)
    }
  }

  const deleteAcct = async (id) => {
    setBusyId(id)
    try {
      await api(`/api/caldav/accounts/${id}`, { method: 'DELETE' })
      setAccounts((a) => a.filter((x) => x.id !== id))
    } catch { /* keep the row */ }
    setBusyId(null)
  }

  const startAdd = () => { setProvider(null); setForm({}); setError(null); setMode('pick') }
  const pickProvider = (key) => { setProvider(key); setForm({}); setError(null); setMode('form') }

  const connect = async () => {
    if (!provider) return
    setConnecting(true)
    setError(null)
    try {
      const body = {
        name: deriveName(provider, form),
        type: provider,
        serverUrl: form.serverUrl || '',
        username: form.username || '',
        password: form.password || '',
      }
      const data = await api('/api/caldav/accounts', { method: 'POST', body: JSON.stringify(body) })
      const acct = data.account || {}
      await load()
      if (acct.id) setStatus(acct.id, 'ok')
      enterDiscover(acct.id, acct.lists)
    } catch (err) {
      let msg = 'Could not connect — check the server URL, username and (app) password.'
      try { msg = JSON.parse(err.message).error || msg } catch { /* keep default */ }
      setError(msg)
    } finally {
      setConnecting(false)
    }
  }

  const toggleList = async (url) => {
    const prev = lists
    const next = lists.map((l) => (l.url === url ? { ...l, enabled: !l.enabled } : l))
    setLists(next)
    if (!activeId) return
    try {
      await api(`/api/caldav/accounts/${activeId}/lists`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: next.filter((l) => l.enabled).map((l) => l.url) }),
      })
    } catch {
      setLists(prev) // revert on failure
    }
  }

  const finishDiscover = async () => {
    await load()
    setMode('list')
    setProvider(null)
    setForm({})
    setActiveId(null)
    setLists([])
    setCounts({})
  }

  const backToList = () => { setMode('list'); setProvider(null); setForm({}); setError(null) }

  const headSub = mode === 'list' ? 'Calendar & tasks (CalDAV) + notes (Nextcloud) — one account.'
    : mode === 'pick' ? 'Choose a provider to connect.'
      : mode === 'form' ? `Connect your ${preset ? preset.name : ''} account.`
        : 'Choose which lists to sync.'

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <IconCloud size={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="settings-title">Sync &amp; Storage</h2>
            <div className="sub">{headSub}</div>
          </div>
          <button className="iconbtn" aria-label="Close settings" onClick={onClose}><IconX size={18} /></button>
        </div>

        <div className="modal-body">
          {/* ---- account list ---- */}
          {mode === 'list' && (
            loading ? (
              <div className="state">
                <div className="state-ic"><IconSpinner size={20} /></div>
                <div className="state-sub">Loading accounts…</div>
              </div>
            ) : (
              <div>
                {accounts.length === 0 ? (
                  <div className="state">
                    <div className="state-ic"><IconCloud size={22} /></div>
                    <div className="state-title">No accounts connected</div>
                    <div className="state-sub">Add a CalDAV account to start syncing your tasks and calendars.</div>
                  </div>
                ) : accounts.map((a) => {
                  const st = statusMap[a.id] || 'ok'
                  return (
                    <div className="acct" key={a.id}>
                      <span className="provider-ic"><ProviderIcon type={a.type} /></span>
                      <div className="acct-main">
                        <div className="acct-label">{a.name}</div>
                        <div className="acct-sub">
                          <span className={`status-dot ${st === 'ok' ? 'ok' : st === 'syncing' ? 'syncing' : 'err'}`} />
                          {st === 'ok' && `Connected · ${a.username}`}
                          {st === 'syncing' && 'Syncing…'}
                          {st === 'err' && 'Sync error'}
                        </div>
                      </div>
                      <div className="acct-actions">
                        <button
                          className="iconbtn sm"
                          aria-label={`Refresh ${a.name}`}
                          onClick={() => refreshAcct(a.id)}
                          disabled={busyId === a.id}
                        >
                          {busyId === a.id && st === 'syncing' ? <IconSpinner size={15} /> : <IconRefresh size={15} />}
                        </button>
                        <button
                          className="iconbtn sm danger-hover"
                          aria-label={`Remove ${a.name}`}
                          onClick={() => deleteAcct(a.id)}
                          disabled={busyId === a.id}
                        >
                          <IconTrash size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
                <button className="btn ghost block" style={{ marginTop: 14 }} onClick={startAdd}>
                  <IconPlus size={15} /> Add account
                </button>
                {accounts.length > 0 && <NotesFolderSection accounts={accounts} />}
                {accounts.length > 0 && <ReminderGroupsSection initialCreate={initialCreateGroup} />}
              </div>
            )
          )}

          {/* ---- provider picker ---- */}
          {mode === 'pick' && (
            <div className="provider-grid">
              {Object.entries(PROVIDER_PRESETS).map(([key, p]) => {
                const I = p.icon
                return (
                  <button className="provider-card" key={key} onClick={() => pickProvider(key)}>
                    <span className="provider-ic"><I size={22} /></span>
                    <span className="pc-name">{p.name}</span>
                    <span className="pc-sub">{p.sub}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* ---- connect form ---- */}
          {mode === 'form' && preset && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="provider-ic"><preset.icon size={20} /></span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{preset.name}</span>
              </div>
              {preset.fields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`cd-${f.key}`}>{f.label}</label>
                  <input
                    id={`cd-${f.key}`}
                    type={f.type}
                    className="input"
                    placeholder={f.placeholder}
                    value={form[f.key] || ''}
                    autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                  {f.hint && (
                    <span className="hint">
                      <IconKey size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{f.hint}
                    </span>
                  )}
                </div>
              ))}
              {error && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--danger)' }}>
                  <IconX size={14} /> {error}
                </div>
              )}
            </div>
          )}

          {/* ---- discovered lists ---- */}
          {mode === 'discover' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>
                <IconCheck size={16} /> Connected — found {lists.length} {lists.length === 1 ? 'list' : 'lists'}
              </div>
              {lists.length === 0 ? (
                <div className="state">
                  <div className="state-ic"><IconCloud size={22} /></div>
                  <div className="state-sub">No task or calendar lists were found for this account.</div>
                </div>
              ) : (
                <div className="disc-list">
                  {lists.map((l) => {
                    const name = l.displayName || l.url
                    const c = counts[name]
                    return (
                      <div className="disc-row" key={l.url}>
                        <span className="disc-swatch" style={{ background: swatchFor(l.url) }} />
                        <span className="disc-name">{name}</span>
                        <span className="disc-count">{typeof c === 'number' ? `${c} task${c === 1 ? '' : 's'}` : ''}</span>
                        <input
                          type="checkbox"
                          role="switch"
                          className="switch"
                          checked={!!l.enabled}
                          aria-checked={!!l.enabled}
                          aria-label={`Sync ${name}`}
                          onChange={() => toggleList(l.url)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- footer ---- */}
        <div className="modal-foot">
          {mode === 'list' && <button className="btn primary" onClick={onClose}>Done</button>}
          {mode === 'pick' && <button className="btn ghost" onClick={backToList}>Back</button>}
          {mode === 'form' && (
            <>
              <button className="btn ghost" onClick={() => setMode('pick')} disabled={connecting}>Back</button>
              <button className="btn primary" onClick={connect} disabled={!formValid || connecting}>
                {connecting ? <><IconSpinner size={15} /> Connecting…</> : <><IconLink size={15} /> Connect</>}
              </button>
            </>
          )}
          {mode === 'discover' && (
            <>
              <button className="btn ghost" onClick={finishDiscover}>Back</button>
              <button className="btn primary" onClick={finishDiscover}>
                <IconCheck size={15} /> Save {lists.filter((l) => l.enabled).length} lists
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
