import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, createTask, isoDaysAgo, isoDaysFromNow } from '../lib.mjs'

// Productive flow: surface the single most important task to start on (the frog
// "boss"), complete it and get the next one, and scan the Eisenhower matrix.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  const p = 1
  await createTask(request, p, { title: 'Frog A', priority: 5, due_date: isoDaysFromNow(1) })
  await createTask(request, p, { title: 'Task B', priority: 3, due_date: isoDaysAgo(1) })
  await createTask(request, p, { title: 'Task C', priority: 1, due_date: isoDaysFromNow(0) })
  await seedLayout(request, [{ type: 'triage' }])
})

test('picks the top task as the frog and advances after completion', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Triage')
  await expect(frame.locator('.tri-boss-title')).toHaveText('Frog A')

  await frame.getByRole('button', { name: 'Complete: Frog A' }).click()
  await expect(frame.locator('.tri-boss-title')).toHaveText('Task B')
})

test('matrix sorts tasks into the right quadrant', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Triage')
  await frame.getByRole('tab', { name: 'Matrix' }).click()
  // Task B: important (p3) + urgent (overdue) -> Do first (Q1).
  await expect(frame.locator('.eq-Q1')).toContainText('Task B')
  // Task C: not important (p1) + urgent (due today) -> Delegate (Q3).
  await expect(frame.locator('.eq-Q3')).toContainText('Task C')
})

// Quadrants now hold real (dense) TaskRows — due info shows and the row acts.
test('matrix rows show due info and are actionable', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Triage')
  await frame.getByRole('tab', { name: 'Matrix' }).click()
  const row = frame.locator('.eq-Q1 .task', { hasText: 'Task B' })
  await expect(row.locator('.due-chip')).toBeVisible() // overdue due-chip (opens the scheduler)
  await expect(row.getByRole('checkbox', { name: 'Complete: Task B' })).toBeVisible()
})

test('complete a task straight from the matrix', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Triage')
  await frame.getByRole('tab', { name: 'Matrix' }).click()
  await frame.getByRole('checkbox', { name: 'Complete: Task B' }).click()
  await expect(frame.locator('.eq-Q1')).not.toContainText('Task B')
})
