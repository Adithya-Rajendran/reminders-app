import { test, expect } from '@playwright/test'
import { STATE, gotoApp, seedLayout, widget, clearTasks, createTask, clearNotes } from '../lib.mjs'

const todayAt = (h) => {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

async function seedNote(request, title, body) {
  const c = await request.post('/api/notes', { data: { folder: '', title } })
  expect(c.ok(), `create note -> ${c.status()}`).toBeTruthy()
  const { path } = await c.json()
  const r = await request.put('/api/notes/item', { data: { path, body } })
  expect(r.ok(), `save note -> ${r.status()}`).toBeTruthy()
}

async function expectNoHorizontalOverflow(frame) {
  await expect.poll(async () => frame.evaluate((el) => {
    const nodes = [el, el.querySelector('.widget-body')].filter(Boolean)
    return nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)
  })).toBe(true)
}

test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  await clearNotes(request)
})

const PRIMARY_VIEWPORTS = [
  { name: 'MacBook Pro 14', width: 1512, height: 982 },
  { name: '5k2k monitor', width: 5120, height: 2160 },
]

for (const viewport of PRIMARY_VIEWPORTS) {
  test(`mixed resized widgets keep primary controls visible without horizontal overflow on ${viewport.name}`, async ({ page, request }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await createTask(request, STATE.taskProjectId, { title: 'Critical proposal', due_date: todayAt(10), important: true, priority: 3, clarified: true })
    await createTask(request, STATE.taskProjectId, { title: 'Raw capture' })
    await createTask(request, STATE.taskProjectId, { title: 'Follow up reminder', due_date: todayAt(15), reminders: [{ reminder: todayAt(15) }], clarified: true })
    await seedNote(request, 'Pinned resize note', 'This pinned note stays readable in a compact widget.')

    await seedLayout(request, [
      { type: 'overview', w: 6, h: 5 },
      { type: 'inbox', w: 6, h: 7 },
      { type: 'daily', w: 6, h: 6 },
      { type: 'focus', w: 4, h: 5 },
      { type: 'notepin', w: 4, h: 4 },
      { type: 'reminders', w: 5, h: 5 },
      { type: 'calendar', w: 12, h: 8 },
      { type: 'notes', w: 16, h: 10 },
    ])
    await gotoApp(page)

    const overview = widget(page, 'Overview')
    await expect(overview.getByLabel(/capture a task to the inbox/i)).toBeVisible()
    await expect(overview.getByText('Critical proposal')).toBeVisible()

    const inbox = widget(page, 'Inbox')
    await expect(inbox.getByRole('button', { name: /^Clarify$/i })).toBeVisible()
    await expect(inbox.getByText('Raw capture')).toBeVisible()

    const daily = widget(page, 'Daily Plan')
    await expect(daily.getByText(/today.s focus/i)).toBeVisible()
    await expect(daily.getByLabel('Add a task to today')).toBeVisible()

    const focus = widget(page, 'Focus')
    await expect(focus.getByText('Critical proposal')).toBeVisible()
    await expect(focus.getByRole('button', { name: /start focus/i })).toBeVisible()

    const note = widget(page, 'Note')
    await expect(note.getByText('Pinned resize note')).toBeVisible()
    await expect(note.getByText(/stays readable/i)).toBeVisible()

    const reminders = widget(page, 'Reminders')
    await expect(reminders.getByLabel('Add a reminder')).toBeVisible()

    const calendar = widget(page, 'Calendar')
    await expect(calendar.locator('.fc')).toBeVisible()

    const notes = widget(page, 'Notes')
    await expect(notes.getByText('Pinned resize note')).toBeVisible()

    for (const frame of [overview, inbox, daily, focus, note, reminders, calendar, notes]) {
      await expectNoHorizontalOverflow(frame)
    }
  })
}
