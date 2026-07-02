// One always-mounted polite live region for the whole app. Conditionally
// rendered role="status" nodes (the old UndoBar pattern) are inserted into the
// DOM fully formed, which most screen readers never announce; a permanent
// region whose CONTENT changes is announced reliably. Mount <LiveAnnouncer/>
// once in App; call announce(msg) from anywhere (visual components stay plain
// divs and announce as a side effect).
import { useEffect, useState } from 'react'

let push = null // set by the mounted LiveAnnouncer
const queue = []

export function announce(msg) {
  const text = String(msg || '').trim()
  if (!text) return
  if (push) push(text)
  else queue.push(text) // announced once the region mounts (app boot)
}

export function LiveAnnouncer() {
  const [text, setText] = useState('')
  useEffect(() => {
    let timer
    push = (msg) => {
      // Clear-then-set on the next frame so repeating the SAME text (two
      // completes in a row) still registers as a change to the screen reader.
      setText('')
      cancelAnimationFrame(timer)
      timer = requestAnimationFrame(() => setText(msg))
    }
    while (queue.length) push(queue.shift())
    return () => { push = null; cancelAnimationFrame(timer) }
  }, [])
  return (
    <div role="status" aria-live="polite" className="sr-only-live">
      {text}
    </div>
  )
}
