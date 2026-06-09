import { useEffect, useState } from 'react'
import { notesApi } from '../api.js'
import { IconCheck, IconNote, IconSpinner } from '../icons.jsx'

// Where notes live in the cloud: pick the WebDAV account + root folder.
export default function NotesFolderSection({ accounts }) {
  const [folders, setFolders] = useState([])
  const [val, setVal] = useState('Notes')
  const [acct, setAcct] = useState('')
  const [saving, setSaving] = useState('idle') // idle | saving | saved | err
  useEffect(() => {
    notesApi.config().then((c) => { setVal(c.rootPath || 'Notes'); setAcct(c.accountId || (accounts[0] && accounts[0].id) || '') }).catch(() => {})
  }, [])
  useEffect(() => { notesApi.browse('').then((b) => setFolders((b.folders || []).map((f) => f.name))).catch(() => {}) }, [acct])
  const save = async () => {
    setSaving('saving')
    try { const r = await notesApi.setConfig(acct, val.trim() || 'Notes'); setVal(r.rootPath); setSaving('saved'); setTimeout(() => setSaving('idle'), 1500) } catch { setSaving('err') }
  }
  return (
    <div className="notes-cfg">
      <div className="notes-cfg-head"><IconNote size={16} /> <span>Notes folder</span></div>
      <div className="notes-cfg-sub">Notes &amp; drawings are saved as files in the Nextcloud account above (over WebDAV) — pick which folder. Created if it doesn’t exist.</div>
      {accounts.length > 1 && (
        <select className="input" value={acct} onChange={(e) => setAcct(e.target.value)} aria-label="Notes account" style={{ marginBottom: 8 }}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      <div className="notes-cfg-row">
        <input className="input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Notes" aria-label="Notes folder path" />
        <button className="btn primary sm" onClick={save} disabled={saving === 'saving'}>
          {saving === 'saving' ? <IconSpinner size={14} /> : saving === 'saved' ? <IconCheck size={14} /> : 'Save'}
        </button>
      </div>
      {folders.length > 0 && (
        <div className="notes-cfg-chips">
          {folders.slice(0, 12).map((f) => <button key={f} className={`chip notes-chip${val === f ? ' on' : ''}`} onClick={() => setVal(f)}>{f}</button>)}
        </div>
      )}
    </div>
  )
}
