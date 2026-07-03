import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// revealtask.js reaches the board (flash a widget) and the announcer; mock both so
// each branch is observable. The reveal-a-present-row branch uses the real DOM.
vi.mock('../../client/src/boardbus.js', () => ({ getBoard: vi.fn(() => []), flashWidget: vi.fn() }))
vi.mock('../../client/src/widget-sdk', () => ({ announce: vi.fn() }))

import { revealTaskInDom } from '../../client/src/revealtask.js'
import { getBoard, flashWidget } from '../../client/src/boardbus.js'
import { announce } from '../../client/src/widget-sdk'

describe('revealTaskInDom', () => {
  beforeEach(() => { getBoard.mockReturnValue([]) })
  afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })

  it('reveals a present row (flash class) and matches a numeric id as its DOM string', () => {
    // TaskRow stamps data-task-id={task.id}; a numeric id lands in the DOM as '1'.
    document.body.innerHTML = '<div class="task" data-task-id="1">Call the plumber</div>'
    const out = revealTaskInDom(1) // numeric — must still match the string '1'
    expect(out).toBe('revealed')
    expect(document.querySelector('[data-task-id="1"]').classList.contains('task-flash')).toBe(true)
    expect(flashWidget).not.toHaveBeenCalled()
  })

  it('falls back to flashing a task widget when the task is not a row on the board', () => {
    getBoard.mockReturnValue([{ i: 'w-note', type: 'notes' }, { i: 'w-rem', type: 'reminders' }])
    const out = revealTaskInDom('999')
    expect(out).toBe('flashed')
    // flashes the FIRST task-bearing widget, skipping the non-task 'notes' widget.
    expect(flashWidget).toHaveBeenCalledWith('w-rem')
    expect(announce).toHaveBeenCalled()
  })

  it('announces when there is no task widget on the board to flash', () => {
    getBoard.mockReturnValue([{ i: 'w-note', type: 'notes' }])
    const out = revealTaskInDom('999')
    expect(out).toBe('announced')
    expect(flashWidget).not.toHaveBeenCalled()
    expect(announce).toHaveBeenCalled()
  })
})
