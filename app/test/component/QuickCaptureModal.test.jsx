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
    // Captures land in the Inbox unclarified — this is the one field capture
    // always sets, so the parsed NL preview and Inbox routing stay in sync.
    expect(fields.clarified).toBe(false)

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('(d) chain-capture ("keep open") submits with clarified:false, clears the input, keeps the modal open', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<QuickCaptureModal onSubmit={onSubmit} onClose={onClose} inboxReady={true} />)

    // Opt into chain-capture via the "keep open" checkbox.
    await userEvent.click(screen.getByRole('checkbox', { name: /keep open/i }))

    const input = screen.getByLabelText(/capture a task/i)
    await userEvent.type(input, 'first thought')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0].clarified).toBe(false)

    // Modal stays open (onClose not called) and the input is cleared for the next thought.
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toHaveValue(''))

    // A second capture goes in the same way, without ever closing the modal.
    await userEvent.type(input, 'second thought')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls[1][0].title).toBe('second thought')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('(e) Shift+Enter chain-captures without the checkbox: submits, clears input, keeps modal open', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<QuickCaptureModal onSubmit={onSubmit} onClose={onClose} inboxReady={true} />)

    const input = screen.getByLabelText(/capture a task/i)
    await userEvent.type(input, 'quick idea')
    // Shift+Enter should submit-and-keep-open; plain Enter would close.
    await userEvent.type(input, '{Shift>}{Enter}{/Shift}')

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0].clarified).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toHaveValue(''))
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
