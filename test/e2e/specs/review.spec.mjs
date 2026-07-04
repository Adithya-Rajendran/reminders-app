import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, createTask, patchTask, taskProjectId } from '../lib.mjs'

// Productive flow: a weekly feedback loop — see how much got done and tick off
// the weekly review nudge.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  const pid = await taskProjectId(request)
  for (const title of ['Done one', 'Done two', 'Done three']) {
    const t = await createTask(request, pid, { title })
    await patchTask(request, t.id, { done: true })
  }
  await seedLayout(request, [{ type: 'review' }])
})

test('counts this week’s completions and clears the review nudge', async ({ page }) => {
  await gotoApp(page)
  const frame = widget(page, 'Weekly Review')
  await expect(frame.locator('.rv-big')).toHaveText('3')
  await expect(frame.locator('.rv-meta')).toContainText('in 30 days')

  // The weekly review prompt is due (never reviewed) -> run the guided review
  // (get clear -> get current -> reflect); finishing it clears the nudge.
  await expect(frame.locator('.rv-prompt')).toBeVisible()
  await frame.getByRole('button', { name: 'Start review' }).click()
  await frame.getByRole('button', { name: 'Next' }).click()        // get clear -> get current
  await frame.getByRole('button', { name: 'Next' }).click()        // get current -> get creative
  await frame.getByRole('button', { name: 'Finish review' }).click()
  await expect(frame.locator('.rv-reviewed')).toContainText('Reviewed this week')
})
