import { useRef, useState } from 'react'
import { Excalidraw, serializeAsJSON, exportToBlob } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css' // 0.18+: styles are no longer auto-injected
import ModalFrame from './ModalFrame.jsx'
import { IconX, IconCheck, IconSpinner } from '../widget-sdk/icons.jsx'

// Full Excalidraw editor in a modal. Loaded lazily (the package is ~heavy), so
// it's only fetched the first time a drawing is created or opened. On save it
// hands back the editable scene JSON (.excalidraw) + a PNG preview.
export default function ExcalidrawModal({ initialScene, onSave, onClose }) {
  const apiRef = useRef(null)
  const [saving, setSaving] = useState(false)

  let initialData
  try { initialData = initialScene ? JSON.parse(initialScene) : undefined } catch { initialData = undefined }
  if (initialData) initialData = { elements: initialData.elements || [], appState: { ...(initialData.appState || {}), collaborators: undefined }, files: initialData.files || {} }

  const save = async () => {
    const api = apiRef.current
    if (!api) return
    setSaving(true)
    try {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()
      const json = serializeAsJSON(elements, appState, files, 'local')
      const png = await exportToBlob({
        elements, files, mimeType: 'image/png', exportPadding: 12,
        appState: { ...appState, exportBackground: true, exportWithDarkMode: false, exportScale: 2 },
      })
      await onSave({ json, png })
    } catch (e) { console.error('drawing save failed', e); setSaving(false) }
  }

  return (
    <ModalFrame overlayClass="excali-overlay" modalClass="excali-modal" ariaLabel="Drawing editor" onBackdrop={onClose}>
      <div className="excali-head">
          <span className="excali-title">✏️ Drawing</span>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? <><IconSpinner size={14} /> Saving…</> : <><IconCheck size={15} /> Insert into note</>}
          </button>
          <button className="iconbtn sm" aria-label="Close drawing" title="Close" onClick={onClose}><IconX size={16} /></button>
        </div>
      <div className="excali-canvas">
        <Excalidraw excalidrawAPI={(api) => { apiRef.current = api }} initialData={initialData} />
      </div>
    </ModalFrame>
  )
}
