import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuickCaptureModal from '../../client/src/QuickCaptureModal.jsx'

// QuickCaptureModal renders via createPortal into document.body, which jsdom
// supports; testing-library queries document.body, so screen.* works without
// any extra wiring.

describe('QuickCaptureModal', () => {
  it('(a) parses NL input and calls onSubmit then onClose on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<QuickCaptureModal onSubmit={onSubmit} onClose={onClose} inboxReady={true} />)

    const input = screen.getByLabelText(/capture a task/i)
    await userEvent.type(input, 'email Sam friday 2pm !2 *work')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    const [fields] = onSubmit.mock.calls[0]
    expect(fields.title).toBe('email Sam')
    expect(fields.priority).toBe(2)
    expect(fields.due_date).toBeTruthy()
    expect(fields.labels).toEqual(['work'])

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('(b) inboxReady=false: shows settings CTA alert, does not call onSubmit; CTA calls onClose then onOpenSettings', async () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    const onOpenSettings = vi.fn()
    render(
      <QuickCaptureModal
        onSubmit={onSubmit}
        onClose={onClose}
        inboxReady={false}
        onOpenSettings={onOpenSettings}
      />,
    )

    const input = screen.getByLabelText(/capture a task/i)
    await userEvent.type(input, 'buy milk')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    // An alert should appear explaining there's no CalDAV account yet.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(onSubmit).not.toHaveBeenCalled()

    // The CTA button ("Open Settings") should appear inside the alert.
    const cta = screen.getByRole('button', { name: /open settings/i })
    await userEvent.click(cta)

    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('(c) onSubmit rejection: shows extracted error message, modal stays open (onClose not called)', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error(JSON.stringify({ error: 'boom' })))
    const onClose = vi.fn()
    render(<QuickCaptureModal onSubmit={onSubmit} onClose={onClose} inboxReady={true} />)

    const input = screen.getByLabelText(/capture a task/i)
    await userEvent.type(input, 'do a thing')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
