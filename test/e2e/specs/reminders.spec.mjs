import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, listTasks } from '../lib.mjs'

// Productive flow: capture a reminder fast, prioritise it inline, complete it
// (with undo), and break a bigger item into subtasks — all persisting to CalDAV.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  await seedLayout(request, [{ type: 'reminders' }])
})

const addReminder = async (frame, title) => {
  await frame.getByLabel('Add a reminder').fill(title)
  await frame.getByRole('button', { name: 'Add reminder' }).click()
  await expect(frame.getByText(title, { exact: true })).toBeVisible()
}

test('capture a reminder and complete it', async ({ page, request }) => {
  await gotoApp(page)
  const frame = widget(page, 'Reminders')
  await addReminder(frame, 'Drink water')

  // A bare capture is uncategorized by default — no due date, no reminder — and
  // lands in the Inbox / Triage to be processed later (reminders are opt-in).
  const t = (await listTasks(request)).find((x) => x.title === 'Drink water')
  expect(t, 'task persisted to CalDAV').toBeTruthy()
  expect(t.reminders.length, 'uncategorized capture has no reminder').toBe(0)
  expect(t.due_date, 'uncategorized capture has no due date').toBe('0001-01-01T00:00:00Z')

  await frame.getByRole('checkbox', { name: 'Complete: Drink water' }).click()
  await expect(page.locator('.undo-bar')).toContainText('Completed')
  await expect.poll(async () => (await listTasks(request)).find((x) => x.title === 'Drink water')?.done).toBe(true)
})

test('set priority inline and it persists', async ({ page, request }) => {
  await gotoApp(page)
  const frame = widget(page, 'Reminders')
  await addReminder(frame, 'Plan the week')

  const row = frame.locator('.task-wrap', { has: page.getByText('Plan the week', { exact: true }) })
  await row.locator('.pri-dot-btn').click()
  await row.getByRole('menuitem', { name: 'High' }).click()

  await expect.poll(async () => (await listTasks(request)).find((x) => x.title === 'Plan the week')?.priority).toBe(3)
  // Survives a reload (read back from CalDAV, not optimistic state). Priority now
  // renders as the PriorityDot bars glyph (shape + colour); High → the p2 tier.
  await page.reload()
  await expect(frame.locator('.task-wrap', { has: page.getByText('Plan the week', { exact: true }) }).locator('.pbars.p2')).toBeVisible()
})

test('quick-add parses date, priority, label and cue tokens', async ({ page, request }) => {
  await gotoApp(page)
  const frame = widget(page, 'Reminders')
  // "trigger -> task date !priority *label" (same Quick-Add tokens as subtasks).
  await frame.getByLabel('Add a reminder').fill('after standup -> Draft report tomorrow !2 *Focus')
  await frame.getByRole('button', { name: 'Add reminder' }).click()
  await expect(frame.getByText('Draft report', { exact: true })).toBeVisible()

  await expect.poll(async () => {
    const t = (await listTasks(request)).find((x) => x.title === 'Draft report')
    if (!t) return null
    return { priority: t.priority, label: (t.labels || []).some((l) => l.title === 'Focus'), cue: t.cue, dated: t.due_date !== '0001-01-01T00:00:00Z', reminded: (t.reminders || []).length > 0 }
  }).toEqual({ priority: 2, label: true, cue: 'after standup', dated: true, reminded: true })
})

test('break a reminder into subtasks', async ({ page, request }) => {
  await gotoApp(page)
  const frame = widget(page, 'Reminders')
  await addReminder(frame, 'Ship release')

  const row = frame.locator('.task-wrap', { has: page.getByText('Ship release', { exact: true }) }).first()
  await row.getByRole('button', { name: /subtask/ }).first().click()
  await row.getByLabel('Add a subtask').fill('Write changelog')
  await row.getByRole('button', { name: 'Add subtask' }).click()

  await expect(row.getByText('Write changelog', { exact: true })).toBeVisible()
  // The child is linked to its parent via RELATED-TO (task.goal === parent.uid).
  await expect.poll(async () => {
    const tasks = await listTasks(request)
    const parent = tasks.find((x) => x.title === 'Ship release')
    return tasks.some((x) => x.title === 'Write changelog' && x.goal === parent?.uid)
  }).toBe(true)
})
