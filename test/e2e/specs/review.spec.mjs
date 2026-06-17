import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, createTask, patchTask } from '../lib.mjs'

// Productive flow: a weekly feedback loop — see how much got done and tick off
// the weekly review nudge.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  for (const title of ['Done one', 'Done two', 'Done three']) {
    const t = await createTask(request, 1, { title })
    await patchTask(request, t.id, { done: true })
  }
  await seedLayout(request, [{ type: 'review' }])
})

test('counts this week’s completions and clears the review nudge', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Weekly Review')
  await expect(frame.locator('.rv-big')).toHaveText('3')
  await expect(frame.locator('.rv-meta')).toContainText('in 30 days')

  // The weekly review prompt is due (never reviewed) -> mark it and it clears.
  await expect(frame.locator('.rv-prompt')).toBeVisible()
  await frame.getByRole('button', { name: 'Mark reviewed' }).click()
  await expect(frame.locator('.rv-reviewed')).toContainText('Reviewed this week')
})
