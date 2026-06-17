import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, createTask, isoDaysAgo, isoDaysFromNow } from '../lib.mjs'

// Productive flow: triage everything scheduled by when it's due, and zoom in on
// two-minute wins.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  const p = 1
  await createTask(request, p, { title: 'Overdue item', due_date: isoDaysAgo(2) })
  await createTask(request, p, { title: 'Today item', due_date: isoDaysFromNow(0) })
  await createTask(request, p, { title: 'Tomorrow item', due_date: isoDaysFromNow(1) })
  await createTask(request, p, { title: 'This-week item', due_date: isoDaysFromNow(3) })
  await createTask(request, p, { title: 'Far item', due_date: isoDaysFromNow(10) })
  await createTask(request, p, { title: 'Quick win', due_date: isoDaysFromNow(0), labels: ['2min'] })
  await seedLayout(request, [{ type: 'upcoming' }])
})

test('groups scheduled tasks into time buckets', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Upcoming')
  for (const [label, title] of [['Overdue', 'Overdue item'], ['Today', 'Today item'], ['Tomorrow', 'Tomorrow item'], ['This week', 'This-week item'], ['Later', 'Far item']]) {
    await expect(frame.locator('.group-head', { hasText: label })).toBeVisible()
    await expect(frame.getByText(title, { exact: true })).toBeVisible()
  }
})

test('the 2-minute filter narrows to quick wins', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Upcoming')
  await expect(frame.getByText('Overdue item', { exact: true })).toBeVisible()

  await frame.getByRole('button', { name: /2-min only/ }).click()
  await expect(frame.getByText('Quick win', { exact: true })).toBeVisible()
  await expect(frame.getByText('Overdue item', { exact: true })).toBeHidden()
})
