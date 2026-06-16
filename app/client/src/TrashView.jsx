import { useEffect, useState } from 'react'
import { notesApi } from './api.js'
import { IconTrash, IconChevL, IconSpinner } from './icons.jsx'

const fmt = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString() }

// Trash bin: list of soft-deleted notes with Restore / Delete-forever / Empty.
// `onChanged` lets the widget refresh its main list after a restore/empty.
export default function TrashView({ onClose, onChanged }) {
  const [items, setItems] = useState(null)
  const load = () => { setItems(null); notesApi.trashList().then((r) => setItems(r.notes || [])).catch(() => setItems([])) }
  useEffect(() => { load() }, [])
  const restore = async (p) => { try { await notesApi.restore(p); load(); onChanged?.() } catch { /* ignore */ } }
  const del = async (p) => { try { await notesApi.del(p); load() } catch { /* ignore */ } }
  const empty = async () => { try { await notesApi.emptyTrash(); load(); onChanged?.() } catch { /* ignore */ } }
  return (
    <div className="trash-view">
      <div className="note-edit-head">
        <button className="iconbtn sm" onClick={onClose} aria-label="Back to notes" title="Back"><IconChevL size={16} /></button>
        <div className="trash-title"><IconTrash size={15} /> Trash</div>
        <span style={{ flex: 1 }} />
        {items && items.length > 0 && <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={empty}>Empty trash</button>}
      </div>
      <div className="trash-list">
        {items === null ? <div className="note-loading"><IconSpinner size={20} /></div>
          : items.length === 0 ? <div className="trash-empty">Trash is empty.</div>
            : items.map((t) => (
              <div key={t.path} className="trash-row">
                <div className="trash-row-main">
                  <span className="trash-row-title">{t.title}</span>
                  <span className="trash-row-sub">from {t.trashedFrom || 'Notes'}{fmt(t.trashedAt) && ` · ${fmt(t.trashedAt)}`}</span>
                </div>
                <button className="btn ghost sm" onClick={() => restore(t.path)}>Restore</button>
                <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => del(t.path)}>Delete</button>
              </div>
            ))}
      </div>
    </div>
  )
}
