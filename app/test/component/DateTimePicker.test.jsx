import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DateTimePicker from '../../client/src/widget-sdk/ui/DateTimePicker.jsx'

// DateTimePicker renders via createPortal with fixed positioning; jsdom has no
// layout, so getBoundingClientRect on the anchor returns zeros — fine, the
// popover still mounts and places at a clamped position.

// Host provides the anchorRef the picker positions against and restores focus
// to. `open` lets the restore test focus the chip BEFORE the picker mounts,
// matching real usage (the chip is focused when it opens the picker).
function Host({ open = true, ...props }) {
  const anchorRef = useRef(null)
  return (
    <>
      <button ref={anchorRef}>chip</button>
      {open && <DateTimePicker anchorRef={anchorRef} value={null} hasReminder={false} {...props} />}
    </>
  )
}

const day = (n) => screen.getByRole('button', { name: new RegExp(`^\\w+ ${n}, \\d{4}$`) })

describe('DateTimePicker keyboard navigation', () => {
  it('exactly one day button is in the tab order (roving tabindex)', async () => {
    render(<Host onApply={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const days = [...document.querySelectorAll('.dt-grid [data-day]')]
    expect(days.length).toBeGreaterThanOrEqual(28)
    expect(days.filter((el) => el.tabIndex === 0)).toHaveLength(1)
    // With no selection, the tab stop is today.
    expect(days.find((el) => el.tabIndex === 0).dataset.day).toBe(String(new Date().getDate()))
  })

  it('ArrowRight moves the tab stop and DOM focus by one day', async () => {
    render(<Host onApply={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const today = new Date()
    // Anchor the roving stop mid-month to avoid month-boundary hops in this case.
    if (today.getDate() >= 28) {
      // Fall back: drive from day 15 by focusing it directly.
      day(15).focus()
    } else {
      day(today.getDate()).focus()
    }
    const start = Number(document.activeElement.dataset.day)
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(Number(document.activeElement.dataset.day)).toBe(start + 1))
    expect(document.activeElement.tabIndex).toBe(0)
  })

  it('ArrowUp/ArrowDown move by a week; crossing the month edge flips the view month', async () => {
    render(<Host onApply={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const title = () => document.querySelector('.dt-title').textContent
    const before = title()
    day(3).focus()
    await userEvent.keyboard('{ArrowUp}') // 3rd minus 7 days -> previous month
    await waitFor(() => expect(title()).not.toBe(before))
    expect(Number(document.activeElement.dataset.day)).toBeGreaterThanOrEqual(24)
  })

  it('PageDown advances one month, keeping the day (clamped)', async () => {
    render(<Host onApply={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const title = () => document.querySelector('.dt-title').textContent
    const before = title()
    day(15).focus()
    await userEvent.keyboard('{PageDown}')
    await waitFor(() => expect(title()).not.toBe(before))
    expect(Number(document.activeElement.dataset.day)).toBe(15)
  })

  it('clicking the roving day selects it and enables Set', async () => {
    const onApply = vi.fn()
    render(<Host onApply={onApply} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    day(10).focus()
    await userEvent.keyboard('{Enter}') // native button activation selects the day
    const set = screen.getByRole('button', { name: /^set$/i })
    expect(set.disabled).toBe(false)
    await userEvent.click(set)
    expect(onApply).toHaveBeenCalledOnce()
    expect(new Date(onApply.mock.calls[0][0].due_date).getDate()).toBe(10)
  })

  it('closing restores focus to the chip that opened it', async () => {
    const { rerender } = render(<Host open={false} onApply={vi.fn()} onClose={vi.fn()} />)
    screen.getByRole('button', { name: 'chip' }).focus()
    rerender(<Host open onApply={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    // The dialog steals focus on open (Today chip); closing must hand it back
    // to the chip — not to document.body (the pre-fix behavior once the popover
    // had repositioned on scroll).
    await waitFor(() => expect(document.activeElement?.textContent).not.toBe('chip'))
    rerender(<Host open={false} onApply={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(document.activeElement?.textContent).toBe('chip'))
  })
})
