import { test, expect } from '@playwright/test'
import { STATE, gotoApp, seedLayout, widget } from '../lib.mjs'

// Proves the whole chain: Chrome launches, the dev-user header authenticates the
// SPA + every /api call, the BFF serves the built SPA, and the default board
// renders against the live CalDAV backend.
test('app boots authenticated and renders the default widgets', async ({ page, request }) => {
  const me = await request.get('/api/me')
  expect(me.ok()).toBeTruthy()
  expect((await me.json()).sub).toBe(STATE.user)

  await seedLayout(request, [{ type: 'reminders' }, { type: 'upcoming' }, { type: 'calendar' }])
  await gotoApp(page)

  await expect(widget(page, 'Reminders')).toBeVisible()
  await expect(widget(page, 'Upcoming')).toBeVisible()
  await expect(widget(page, 'Calendar')).toBeVisible()
})
