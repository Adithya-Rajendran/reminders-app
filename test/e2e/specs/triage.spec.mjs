import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, createTask, isoDaysAgo, isoDaysFromNow } from '../lib.mjs'

// Prioritize (v2): the "Most important" callout names the single task to do now,
// completing it advances to the next; the Eisenhower matrix buckets by the
// EXPLICIT importance flag × due-proximity urgency. No frog / XP / streaks / tabs.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  const p = 1
  // Important + urgent (overdue) → Do first (Q1) + top of the "Most important" pile.
  await createTask(request, p, { title: 'Ship the release', important: true, due_date: isoDaysAgo(1) })
  // Important + urgent (due today) → Q1 (the next-most-important).
  await createTask(request, p, { title: 'Review the draft', important: true, due_date: isoDaysFromNow(0) })
  // Loud (high priority) but NOT flagged important + urgent → Delegate (Q3), never Q1.
  await createTask(request, p, { title: 'Noisy not important', priority: 5, important: false, due_date: isoDaysAgo(1) })
  await seedLayout(request, [{ type: 'triage' }])
})

test('names the most important task and advances after completion', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Prioritize')
  await expect(frame.locator('.tri-focus-title')).toHaveText('Ship the release')

  await frame.getByRole('button', { name: 'Complete: Ship the release' }).click()
  await expect(frame.locator('.tri-focus-title')).toHaveText('Review the draft')
})

test('matrix buckets by the importance flag, not priority', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Prioritize')
  // Important + urgent → Do first (Q1).
  await expect(frame.locator('.eq-Q1')).toContainText('Ship the release')
  // A high priority WITHOUT the important flag is NOT important → Delegate (Q3).
  await expect(frame.locator('.eq-Q3')).toContainText('Noisy not important')
  await expect(frame.locator('.eq-Q1')).not.toContainText('Noisy not important')
})

// Quadrants hold real (dense) TaskRows — the row acts right where you decide.
test('matrix rows are actionable', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Prioritize')
  const row = frame.locator('.eq-Q1 .task', { hasText: 'Review the draft' })
  await expect(row.getByRole('checkbox', { name: 'Complete: Review the draft' })).toBeVisible()
})

test('complete a task straight from the matrix', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Prioritize')
  await frame.getByRole('checkbox', { name: 'Complete: Review the draft' }).click()
  await expect(frame.locator('.eq-Q1')).not.toContainText('Review the draft')
})
