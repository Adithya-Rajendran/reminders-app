import { test, expect } from '@playwright/test'
import { STATE, gotoApp, seedLayout, widget, clearTasks, createTask, isoDaysFromNow } from '../lib.mjs'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function clearEvents(request) {
  const from = isoDaysFromNow(-40), to = isoDaysFromNow(40)
  const r = await request.get(`/api/calendar/events?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`)
  const { events = [] } = await r.json()
  for (const e of events) await request.delete('/api/calendar/events', { data: { accountId: e.accountId, objectUrl: e.objectUrl } })
}
const createEvent = (request, summary, allDay = false) =>
  request.post('/api/calendar/events', { data: { accountId: STATE.eventList.accountId, listUrl: STATE.eventList.listUrl, summary, start: isoDaysFromNow(0, 12), end: isoDaysFromNow(0, 13), allDay } })

test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  await clearEvents(request)
})

test('a scheduled task appears on the calendar', async ({ page, request }) => {
  await createTask(request, 1, { title: 'Dentist task', due_date: isoDaysFromNow(0, 10) })
  await seedLayout(request, [{ type: 'calendar' }])
  await gotoApp(page)
  const frame = widget(page, 'Calendar')
  await expect(frame.getByText('Dentist task', { exact: true })).toBeVisible()
})

test('complete a task from its chip popover', async ({ page, request }) => {
  await createTask(request, 1, { title: 'Dentist task', due_date: isoDaysFromNow(0, 10) })
  await seedLayout(request, [{ type: 'calendar' }])
  await gotoApp(page)
  const frame = widget(page, 'Calendar')

  // Clicking a task chip opens its quick-actions popover (portaled to <body>).
  await frame.locator('.fc-event', { hasText: 'Dentist task' }).click()
  const pop = page.locator('.task-pop')
  await expect(pop).toBeVisible()
  await pop.getByRole('button', { name: 'Complete' }).click()
  await expect(frame.getByText('Dentist task', { exact: true })).toBeHidden()
})

test('create an event from the grid', async ({ page, request }) => {
  await seedLayout(request, [{ type: 'calendar' }])
  await gotoApp(page)
  const frame = widget(page, 'Calendar')

  // FullCalendar fires `select` on a click-drag across day cells. Use Mon–Thu as
  // the start date so the next day is always in the same week row — the calendar
  // uses a Sunday-first layout, so dragging Sat→Sun crosses a row boundary and the
  // select event never fires. Use dragTo() so Playwright fires the full pointer
  // event sequence (pointerover/pointerenter + pointerdown + pointermove + pointerup)
  // that FullCalendar's interactionPlugin requires.
  const start = new Date()
  while (start.getDay() === 0 || start.getDay() >= 5) start.setDate(start.getDate() + 1)
  const next = new Date(start); next.setDate(start.getDate() + 1)
  const startDays = Math.round((start.getTime() - Date.now()) / 86400000)

  const startCell = frame.locator(`td.fc-daygrid-day[data-date="${ymd(start)}"]`)
  const nextCell = frame.locator(`td.fc-daygrid-day[data-date="${ymd(next)}"]`)
  // Ensure FullCalendar has fully mounted and the daygrid cells are ready before dragging.
  await expect(startCell).toBeVisible()
  await expect(nextCell).toBeVisible()

  const aBox = await startCell.boundingBox()
  const bBox = await nextCell.boundingBox()
  // Drag in the lower portion of each cell (70% down) to land below the day-number
  // header on the day-background area where FullCalendar registers selections.
  // sourcePosition / targetPosition are relative to the element's top-left corner.
  await startCell.dragTo(nextCell, {
    sourcePosition: { x: Math.floor(aBox.width / 2), y: Math.floor(aBox.height * 0.7) },
    targetPosition: { x: Math.floor(bBox.width / 2), y: Math.floor(bBox.height * 0.7) },
  })

  const modal = page.locator('.modal', { hasText: 'New event' })
  await expect(modal).toBeVisible()
  await modal.getByPlaceholder('Event title').fill('Team standup')
  await modal.getByRole('button', { name: 'Create' }).click()
  await expect(modal).toBeHidden()

  await expect(frame.getByText('Team standup', { exact: true }).first()).toBeVisible()
  const r = await request.get(`/api/calendar/events?start=${encodeURIComponent(isoDaysFromNow(startDays - 1))}&end=${encodeURIComponent(isoDaysFromNow(startDays + 3))}`)
  expect((await r.json()).events.some((e) => e.title === 'Team standup')).toBe(true)
})

test('edit and delete an event from the grid', async ({ page, request }) => {
  await createEvent(request, 'Old title')
  await seedLayout(request, [{ type: 'calendar' }])
  await gotoApp(page)
  const frame = widget(page, 'Calendar')

  await frame.locator('.fc-event', { hasText: 'Old title' }).click()
  let modal = page.locator('.modal', { hasText: 'Edit event' })
  await expect(modal).toBeVisible()
  await modal.getByPlaceholder('Event title').fill('New title')
  await modal.getByRole('button', { name: 'Save' }).click()
  await expect(modal).toBeHidden()
  await expect(frame.getByText('New title', { exact: true })).toBeVisible()

  await frame.locator('.fc-event', { hasText: 'New title' }).click()
  modal = page.locator('.modal', { hasText: 'Edit event' })
  page.once('dialog', (d) => d.accept()) // confirm() in the delete handler
  await modal.getByRole('button', { name: 'Delete' }).click()
  await expect(modal).toBeHidden()
  await expect(frame.getByText('New title', { exact: true })).toBeHidden()
})
