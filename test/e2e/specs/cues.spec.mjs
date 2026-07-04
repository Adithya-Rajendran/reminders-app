import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearTasks, createTask, listTasks, taskProjectId, isoIn } from '../lib.mjs'

// Productive flow: model a trigger chain — drag reminder cards onto the board,
// link them, and annotate cues — all persisting to X-REMINDERS-FLOW on the VTODO.
test.beforeEach(async ({ request }) => {
  await clearTasks(request)
  const pid = await taskProjectId(request)
  await createTask(request, pid, { title: 'Wake up', reminders: [{ reminder: isoIn(120) }] })
  await createTask(request, pid, { title: 'Go for a run', reminders: [{ reminder: isoIn(180) }] })
  await seedLayout(request, [{ type: 'cues' }])
})

const uidOf = async (request, title) => (await listTasks(request)).find((t) => t.title === title)?.uid
const flowOf = async (request, title) => (await listTasks(request)).find((t) => t.title === title)?.flow

async function placeOnBoard(page, frame, title, dx, dy) {
  const item = frame.locator('.flow-qitem', { hasText: title })
  const ib = await item.boundingBox()
  const cb = await frame.locator('.flow-canvas').boundingBox()
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2)
  await page.mouse.down()
  await page.mouse.move(cb.x + dx, cb.y + dy, { steps: 10 })
  await page.mouse.move(cb.x + dx + 4, cb.y + dy + 4, { steps: 3 })
  await page.mouse.up()
}

test('drag cards onto the board and link them', async ({ page, request }) => {
  await gotoApp(page)
  const frame = widget(page, 'Cues (flow)')
  await expect(frame.locator('.flow-qitem')).toHaveCount(2)

  await placeOnBoard(page, frame, 'Wake up', 140, 110)
  await expect.poll(async () => await flowOf(request, 'Wake up')).not.toBeNull()
  await placeOnBoard(page, frame, 'Go for a run', 460, 300)
  await expect.poll(async () => await flowOf(request, 'Go for a run')).not.toBeNull()

  const wakeUid = await uidOf(request, 'Wake up')
  const runUid = await uidOf(request, 'Go for a run')
  const handle = frame.locator(`.flow-node[data-uid="${wakeUid}"] .flow-handle`)
  const hb = await handle.boundingBox()
  const target = frame.locator(`.flow-node[data-uid="${runUid}"] .flow-node-body`)
  const tb = await target.boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect.poll(async () => (await flowOf(request, 'Wake up'))?.to || []).toContain(runUid)
})

test('add a cue to a card on the board', async ({ page, request }) => {
  await gotoApp(page)
  const frame = widget(page, 'Cues (flow)')
  await placeOnBoard(page, frame, 'Go for a run', 200, 150)
  const runUid = await uidOf(request, 'Go for a run')

  const node = frame.locator(`.flow-node[data-uid="${runUid}"]`)
  await node.locator('.flow-node-body').dblclick()
  const input = node.locator('.flow-cue-input')
  await input.fill('after I wake up')
  await input.press('Enter')

  await expect.poll(async () => (await listTasks(request)).find((t) => t.title === 'Go for a run')?.cue).toBe('after I wake up')
})
