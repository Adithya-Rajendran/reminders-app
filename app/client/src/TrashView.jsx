import { useEffect, useState } from 'react'
import { notesApi } from './api.js'
import { IconTrash, IconChevL, IconSpinner } from './icons.jsx'

const fmt = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString() }

// Trash bin: list of soft-deleted notes with Restore / Delete-forever / Empty.
// `onChanged` lets the widget refresh its main list after a restore/empty.
export default function TrashView({ onClose, onChanged }) {
  const [items, setItems] = useState(null)
  const [confirm, setConfirm] = useState(null) // 'empty' | note path of the row pending delete-forever
  const [err, setErr] = useState(null)
  const load = () => { setItems(null); notesApi.trashList().then((r) => setItems(r.notes || [])).catch(() => setItems([])) }
  useEffect(() => { load() }, [])
  const restore = async (p) => { setErr(null); try { await notesApi.restore(p); load(); onChanged?.() } catch { setErr('Couldn’t restore that note. Try again.') } }
  // Permanent, irreversible deletes (gone from Nextcloud) gate behind an inline
  // confirm and surface failures — there's no Undo for a forever-delete.
  const del = async (p) => { setErr(null); setConfirm(null); try { await notesApi.del(p); load() } catch { setErr('Couldn’t delete that note forever. Try again.') } }
  const empty = async () => { setErr(null); setConfirm(null); try { await notesApi.emptyTrash(); load(); onChanged?.() } catch { setErr('Couldn’t empty the trash. Try again.') } }
  return (
    <div className="trash-view">
      <div className="note-edit-head">
        <button className="iconbtn sm" onClick={onClose} aria-label="Back to notes" title="Back"><IconChevL size={16} /></button>
        <div className="trash-title"><IconTrash size={15} /> Trash</div>
        <span style={{ flex: 1 }} />
        {items && items.length > 0 && (
          confirm === 'empty' ? (
            <span className="rg-confirm">
              <span>Delete all forever?</span>
              <button className="btn danger sm" onClick={empty}>Empty trash</button>
              <button className="btn ghost sm" onClick={() => setConfirm(null)}>Cancel</button>
            </span>
          ) : (
            <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirm('empty')}>Empty trash</button>
          )
        )}
      </div>
      {err && <div className="rem-err" role="alert">{err}</div>}
      <div className="trash-list">
        {items === null ? <div className="note-loading"><IconSpinner size={20} /></div>
          : items.length === 0 ? <div className="trash-empty">Trash is empty.</div>
            : items.map((t) => (
              <div key={t.path} className="trash-row">
                <div className="trash-row-main">
                  <span className="trash-row-title">{t.title}</span>
                  <span className="trash-row-sub">from {t.trashedFrom || 'Notes'}{fmt(t.trashedAt) && ` · ${fmt(t.trashedAt)}`}</span>
                </div>
                {confirm === t.path ? (
                  <span className="rg-confirm">
                    <span>Delete forever?</span>
                    <button className="btn danger sm" onClick={() => del(t.path)}>Delete forever</button>
                    <button className="btn ghost sm" onClick={() => setConfirm(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <button className="btn ghost sm" onClick={() => restore(t.path)}>Restore</button>
                    <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(t.path)}>Delete forever</button>
                  </>
                )}
              </div>
            ))}
      </div>
    </div>
  )
}
