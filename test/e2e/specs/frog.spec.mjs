import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, createTask, isoDaysAgo, isoDaysFromNow } from '../lib.mjs'

// Productive flow: surface the single most important task to start on, complete
// it and get the next one, and scan the Eisenhower matrix.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  const p = 1
  await createTask(request, p, { title: 'Frog A', priority: 5, due_date: isoDaysFromNow(1) })
  await createTask(request, p, { title: 'Task B', priority: 3, due_date: isoDaysAgo(1) })
  await createTask(request, p, { title: 'Task C', priority: 1, due_date: isoDaysFromNow(0) })
  await seedLayout(request, [{ type: 'frog' }])
})

test('picks the top task and advances after completion', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, "Today’s Frog")
  await expect(frame.locator('.frog-title')).toHaveText('Frog A')

  await frame.getByRole('button', { name: 'Complete: Frog A' }).click()
  await expect(frame.locator('.frog-title')).toHaveText('Task B')
})

test('matrix sorts tasks into the right quadrant', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, "Today’s Frog")
  await frame.getByRole('button', { name: 'Matrix' }).click()
  // Task B: important (p3) + urgent (overdue) -> Do first (Q1).
  await expect(frame.locator('.eq-Q1')).toContainText('Task B')
  // Task C: not important (p1) + urgent (due today) -> Delegate (Q3).
  await expect(frame.locator('.eq-Q3')).toContainText('Task C')
})

test('matrix items show priority and due info', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, "Today’s Frog")
  await frame.getByRole('button', { name: 'Matrix' }).click()
  const item = frame.locator('.eq-Q1 .eq-item', { hasText: 'Task B' })
  await expect(item.locator('.pdot')).toBeVisible()
  await expect(item.locator('.chip')).toBeVisible() // overdue due-chip
})
