import { test, expect } from '@playwright/test'
import { STATE, gotoApp, seedLayout, widget, waitWidgetReady, clearTasks, clearDailyPlan, createTask, isoDaysAgo, ymd } from '../lib.mjs'

// Daily Plan: API correctness, UI suggestion → plan roundtrip, and the Focus
// widget chip that reflects a non-empty plan.

test.describe('Daily Plan', () => {
  test.afterEach(async ({ request }) => {
    await clearTasks(request)
    // Clear today's plan so a leftover doesn't bleed into the next test.
    await clearDailyPlan(request)
  })

  test('plan API roundtrip + validation', async ({ request }) => {
    const pid = STATE.taskProjectId
    const a = await createTask(request, pid, { title: 'Task A' })
    const b = await createTask(request, pid, { title: 'Task B' })

    // PUT deduplicates while preserving the first occurrence order.
    const putRes = await request.put('/api/daily-plan', { data: { date: ymd(), ids: [a.id, b.id, a.id] } })
    expect(putRes.ok(), `PUT /api/daily-plan -> ${putRes.status()}`).toBeTruthy()
    const putBody = await putRes.json()
    expect(putBody.ids).toEqual([a.id, b.id])

    // GET returns what was saved.
    const getRes = await request.get(`/api/daily-plan?date=${ymd()}`)
    expect(getRes.ok()).toBeTruthy()
    expect((await getRes.json()).ids).toEqual([a.id, b.id])

    // Malformed date string -> 400.
    const bad1 = await request.get('/api/daily-plan?date=nope')
    expect(bad1.status()).toBe(400)

    // Missing date param -> 400.
    const bad2 = await request.get('/api/daily-plan')
    expect(bad2.status()).toBe(400)

    // Non-array ids body -> 400.
    const bad3 = await request.put('/api/daily-plan', { data: { date: ymd(), ids: 'x' } })
    expect(bad3.status()).toBe(400)
  })

  test('suggestion → plan → focus chip', async ({ request, page }) => {
    await clearTasks(request)

    // Seed an overdue task — the Daily Plan widget surfaces overdue items as the
    // first suggestions so the user can decide whether to carry them forward.
    const task = await createTask(request, STATE.taskProjectId, {
      title: 'Overdue thing',
      due_date: isoDaysAgo(1),
      priority: 3,
    })

    // Two widgets: Daily Plan feeds the Focus widget's "from plan" chip.
    await seedLayout(request, [{ type: 'daily' }, { type: 'focus' }])
    await gotoApp(page)

    const daily = widget(page, 'Daily Plan')
    await waitWidgetReady(daily)

    // Click the suggestion chip to add the overdue task to today's plan.
    await daily.locator('.daily-sg').filter({ hasText: 'Overdue thing' }).click()

    // A planned row appears in the widget.
    await expect(daily.locator('.daily-row').filter({ hasText: 'Overdue thing' })).toBeVisible()

    // The server plan should now contain the task id.
    await expect.poll(async () => {
      const r = await request.get(`/api/daily-plan?date=${ymd()}`)
      return (await r.json()).ids
    }, { timeout: 10000 }).toContain(task.id)

    // Focus widget shows the "from today's plan" chip once a plan exists.
    await expect(widget(page, 'Focus').locator('.focus-plan-chip')).toBeVisible()
  })
})
