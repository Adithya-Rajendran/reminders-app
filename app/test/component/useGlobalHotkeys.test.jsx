import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useGlobalHotkeys } from '../../client/src/useGlobalHotkeys.js'

// Tiny probe component: mounts the hook and exposes nothing in the DOM.
// All assertions are on the vi.fn() handlers, driven by KeyboardEvents on document.
function Probe({ onQuickCapture, onNewNote, onHelp, onCommands, onCycleDash, onQuickSwitch }) {
  useGlobalHotkeys({ onQuickCapture, onNewNote, onHelp, onCommands, onCycleDash, onQuickSwitch })
  return null
}

const fire = (key, extras = {}) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extras }))
}

describe('useGlobalHotkeys', () => {
  it("'c' fires onQuickCapture", () => {
    const onQuickCapture = vi.fn()
    render(<Probe onQuickCapture={onQuickCapture} />)
    fire('c')
    expect(onQuickCapture).toHaveBeenCalledOnce()
  })

  it("'c' while an <input> has focus does NOT fire onQuickCapture", () => {
    const onQuickCapture = vi.fn()
    render(
      <>
        <Probe onQuickCapture={onQuickCapture} />
        <input id="trap" />
      </>,
    )
    document.getElementById('trap').focus()
    fire('c')
    expect(onQuickCapture).not.toHaveBeenCalled()
  })

  it("'n' fires onNewNote, with the same typing guard as 'c'", () => {
    const onNewNote = vi.fn()
    render(
      <>
        <Probe onNewNote={onNewNote} />
        <input id="trap-n" />
      </>,
    )
    fire('n')
    expect(onNewNote).toHaveBeenCalledOnce()
    document.getElementById('trap-n').focus()
    fire('n')
    expect(onNewNote).toHaveBeenCalledOnce() // not fired while typing
    document.getElementById('trap-n').blur()
    fire('n', { ctrlKey: true })
    expect(onNewNote).toHaveBeenCalledOnce() // modifier combos are not the hotkey
  })

  it("'?' fires onHelp", () => {
    const onHelp = vi.fn()
    render(<Probe onHelp={onHelp} />)
    // The hook matches on e.key === '?'; shift is naturally held for '?' on most
    // keyboards, and the hook explicitly skips the shift check for this key.
    fire('?', { shiftKey: true })
    expect(onHelp).toHaveBeenCalledOnce()
  })

  it("'?' while an <input> is focused does NOT fire onHelp", () => {
    const onHelp = vi.fn()
    render(
      <>
        <Probe onHelp={onHelp} />
        <input id="trap2" />
      </>,
    )
    document.getElementById('trap2').focus()
    fire('?', { shiftKey: true })
    expect(onHelp).not.toHaveBeenCalled()
  })

  it('ctrl+k fires onCommands', () => {
    const onCommands = vi.fn()
    render(<Probe onCommands={onCommands} />)
    fire('k', { ctrlKey: true })
    expect(onCommands).toHaveBeenCalledOnce()
  })

  it("ctrl+']' fires onCycleDash with +1", () => {
    const onCycleDash = vi.fn()
    render(<Probe onCycleDash={onCycleDash} />)
    fire(']', { ctrlKey: true })
    expect(onCycleDash).toHaveBeenCalledWith(1)
  })

  it("ctrl+'[' fires onCycleDash with -1", () => {
    const onCycleDash = vi.fn()
    render(<Probe onCycleDash={onCycleDash} />)
    fire('[', { ctrlKey: true })
    expect(onCycleDash).toHaveBeenCalledWith(-1)
  })

  it("plain 'c' with ctrlKey does NOT fire onQuickCapture", () => {
    const onQuickCapture = vi.fn()
    render(<Probe onQuickCapture={onQuickCapture} />)
    fire('c', { ctrlKey: true })
    expect(onQuickCapture).not.toHaveBeenCalled()
  })
})
