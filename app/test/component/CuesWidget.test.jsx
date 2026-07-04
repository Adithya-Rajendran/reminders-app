import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import CuesWidget from '../../client/src/widgets/CuesWidget.jsx'
import { fakeTasks, fakeGroups } from './fakeCtx.js'
import { WidgetSizeContext } from '../../client/src/widget-sdk'

// Cues renders a flow board from the same shared store via ctx.tasks + ctx.groups.
// The two smoke tests below prove it mounts and reflects the capability; the
// pointer tests drive the down→move→up gestures directly (jsdom has no layout, so
// we mock the canvas rect and elementFromPoint) to pin the wiring that persists a
// dragged node's rounded flow.{x,y} and creates an edge when a link handle is
// dropped on a placed card. The coordinate/anchor MATH itself is unit-tested in
// test/flowgeom.test.mjs — here we only assert the widget calls through correctly.

// A pointer-ish event: jsdom has no PointerEvent, but a MouseEvent carries the
// button/clientX/clientY the handlers read and dispatches under the `pointer*`
// type names React and the window listeners are bound to.
const ptr = (type, { x = 0, y = 0 } = {}) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })

const flush = () => act(async () => { await Promise.resolve() })
const sized = (ui, value) => <WidgetSizeContext.Provider value={value}>{ui}</WidgetSizeContext.Provider>

// jsdom has no elementFromPoint, so vi.spyOn can't wrap it — the drop hit-test's
// input is assigned directly and cleared after each test.
afterEach(() => { vi.restoreAllMocks(); delete document.elementFromPoint })

describe('CuesWidget', () => {
  it('shows the empty state when no reminders/cues are available', async () => {
    render(<CuesWidget tasks={fakeTasks([])} groups={fakeGroups()} group="" />)
    expect(await screen.findByText(/No reminders to map/i)).toBeInTheDocument()
  })

  it('places a flow-positioned task on the board', async () => {
    const cap = fakeTasks([
      { id: 1, uid: 'u1', title: 'Stretch', done: false, cue: 'after coffee', flow: { x: 10, y: 10, to: [] } },
    ])
    render(<CuesWidget tasks={cap} groups={fakeGroups()} group="" />)
    expect(await screen.findByText('Stretch')).toBeInTheDocument()
  })

  it('uses the compact list layout when the measured widget is too narrow for the board', async () => {
    const cap = fakeTasks([
      { id: 1, uid: 'u1', title: 'Stretch', done: false, cue: 'after coffee', flow: { x: 390, y: 125, to: [] } },
      { id: 2, uid: 'u2', title: 'Refill water', done: false, cue: 'after standup' },
    ])
    const { container } = render(sized(
      <CuesWidget tasks={cap} groups={fakeGroups()} group="" />,
      { w: 'md', h: 'md', name: 'standard', width: 540, height: 420 },
    ))

    expect(await screen.findByText(/Placed · 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Queue · 1/i)).toBeInTheDocument()
    expect(container.querySelector('.flow-compact-list')).not.toBeNull()
    expect(container.querySelector('.flow-canvas')).toBeNull()
  })

  it('dragging a placed node persists its rounded flow.{x,y} via the tasks capability', async () => {
    const cap = fakeTasks([
      { id: 1, uid: 'u1', title: 'Stretch', done: false, flow: { x: 10, y: 10, to: [] } },
    ])
    const { container } = render(<CuesWidget tasks={cap} groups={fakeGroups()} group="" />)
    await screen.findByText('Stretch')

    // jsdom returns an all-zero rect and no scroll; the transform then reduces to
    // client coords, and the rect cancels between grab and move, so the final
    // position is base + (moveClient − downClient). A fractional delta proves the
    // Math.round in persistFlow (30.6 → 31, 20.4 → 20).
    const canvas = container.querySelector('.flow-canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })

    const node = container.querySelector('.flow-node[data-uid="u1"]')
    await act(async () => { node.dispatchEvent(ptr('pointerdown', { x: 10, y: 10 })) })
    await act(async () => { window.dispatchEvent(ptr('pointermove', { x: 30.6, y: 20.4 })) })
    await act(async () => { window.dispatchEvent(ptr('pointerup', { x: 30.6, y: 20.4 })) })

    // Optimistic store patch AND the server write both carry the rounded flow.
    const write = cap.calls.update.find(([id]) => id === 1)
    expect(write).toBeTruthy()
    expect(write[1].flow).toMatchObject({ x: 31, y: 20, to: [] })
    expect(Number.isInteger(write[1].flow.x) && Number.isInteger(write[1].flow.y)).toBe(true)
  })

  it('dropping a link handle on another placed node calls addEdge (persists the target uid)', async () => {
    const cap = fakeTasks([
      { id: 1, uid: 'u1', title: 'First', done: false, flow: { x: 10, y: 10, to: [] } },
      { id: 2, uid: 'u2', title: 'Second', done: false, flow: { x: 400, y: 200, to: [] } },
    ])
    const { container } = render(<CuesWidget tasks={cap} groups={fakeGroups()} group="" />)
    await screen.findByText('First')

    const canvas = container.querySelector('.flow-canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })

    // The drop hit-test walks up from whatever is under the release point to the
    // nearest [data-uid]; stub elementFromPoint to hand back the target card's body.
    const target = container.querySelector('.flow-node[data-uid="u2"] .flow-node-title')
    document.elementFromPoint = () => target

    const handle = container.querySelector('.flow-node[data-uid="u1"] .flow-handle')
    await act(async () => { handle.dispatchEvent(ptr('pointerdown', { x: 198, y: 42 })) })
    await act(async () => { window.dispatchEvent(ptr('pointermove', { x: 400, y: 232 })) })
    await act(async () => { window.dispatchEvent(ptr('pointerup', { x: 400, y: 232 })) })

    // addEdge -> persistFlow writes the source node's flow with u2 appended to `to`.
    const write = cap.calls.update.find(([id]) => id === 1)
    expect(write).toBeTruthy()
    expect(write[1].flow.to).toContain('u2')
  })

  it('a drop that misses every card does not create an edge', async () => {
    const cap = fakeTasks([
      { id: 1, uid: 'u1', title: 'First', done: false, flow: { x: 10, y: 10, to: [] } },
    ])
    const { container } = render(<CuesWidget tasks={cap} groups={fakeGroups()} group="" />)
    await screen.findByText('First')

    const canvas = container.querySelector('.flow-canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
    // Released over empty canvas: no ancestor carries a data-uid.
    document.elementFromPoint = () => canvas

    const handle = container.querySelector('.flow-node[data-uid="u1"] .flow-handle')
    await act(async () => { handle.dispatchEvent(ptr('pointerdown', { x: 198, y: 42 })) })
    await act(async () => { window.dispatchEvent(ptr('pointerup', { x: 600, y: 600 })) })

    expect(cap.calls.update.some(([id]) => id === 1)).toBe(false)
    await flush()
  })
})
