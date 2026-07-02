import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, waitWidgetReady, clearTasks, listTasks } from '../lib.mjs'

// Global quick-capture: the 'c' hotkey opens QuickCaptureModal from anywhere on
// the page, the input is autofocused, submitting creates a CalDAV task, and the
// guard prevents the overlay from firing while you type into an input field.

const ZERO_DATE = '0001-01-01T00:00:00Z'

test.describe('Quick Capture', () => {
  test.afterEach(async ({ request }) => {
    await clearTasks(request)
  })

  test('c captures with toast', async ({ page, request }) => {
    await clearTasks(request)
    await seedLayout(request, [{ type: 'reminders' }])
    await gotoApp(page)

    // Press 'c' on the body (no input focused) to open the capture overlay.
    await page.keyboard.press('c')
    const input = page.getByLabel('Capture a task')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()

    // Natural-language line with date, priority, and label tokens.
    await input.fill('Email Sam friday 2pm !2 *work')
    await page.keyboard.press('Enter')

    // App-level toast confirms the capture landed in the inbox.
    await expect(page.locator('.app-toast')).toContainText('Captured to Inbox')

    // Overlay closes after submit.
    await expect(page.locator('.capture-overlay')).toBeHidden()

    // CalDAV task should appear within the poll window.
    await expect.poll(async () => {
      const tasks = await listTasks(request)
      return tasks.find((t) => t.title === 'Email Sam')
    }, { timeout: 15000 }).toBeTruthy()

    const tasks = await listTasks(request)
    const task = tasks.find((t) => t.title === 'Email Sam')
    expect(task.priority).toBe(2)
    expect((task.labels || []).some((l) => l.title === 'work')).toBe(true)
    // "friday 2pm" must parse to a real date, not the ZERO_DATE sentinel.
    expect(task.due_date).not.toBe(ZERO_DATE)
  })

  test('typing guard', async ({ page, request }) => {
    await clearTasks(request)
    await seedLayout(request, [{ type: 'reminders' }])
    await gotoApp(page)

    const frame = widget(page, 'Reminders')
    await waitWidgetReady(frame)

    // Focus the Reminders quick-add input, then press 'c'.
    // The hotkey guard must NOT open the capture overlay while typing.
    const quickAdd = frame.getByLabel('Add a reminder')
    await quickAdd.click()
    await page.keyboard.press('c')

    await expect(page.locator('.capture-overlay')).toBeHidden()
    // The letter 'c' should have been typed into the input instead.
    await expect(quickAdd).toHaveValue('c')

    // Blur the input (Escape clears it in most browsers, so blur explicitly)
    await quickAdd.blur()
    // A bare 'c' on the page body now opens the overlay.
    await page.keyboard.press('c')
    await expect(page.locator('.capture-overlay')).toBeVisible()

    // Escape closes it without creating a task.
    await page.keyboard.press('Escape')
    await expect(page.locator('.capture-overlay')).toBeHidden()
  })
})
