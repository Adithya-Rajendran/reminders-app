import { test, expect } from '@playwright/test'
import { gotoApp, seedLayout, widget, clearNotes } from '../lib.mjs'

// Productive flow: write a note (autosaving to WebDAV), find it again by its body
// text (server full-text search), and organise it (pin / trash / restore).
const seedNote = async (request, title, body) => {
  const c = await request.post('/api/notes', { data: { folder: '', title } })
  const { path } = await c.json()
  await request.put('/api/notes/item', { data: { path, body } })
  return path
}

test.beforeEach(async ({ request }) => {
  await clearNotes(request)
  await seedLayout(request, [{ type: 'notes' }])
})

test('edit a note in the UI and autosave its body to WebDAV', async ({ page, request }) => {
  const path = await seedNote(request, 'Draft', '')
  await gotoApp(page)
  const frame = widget(page, 'Notes')
  await frame.getByText('Draft', { exact: true }).click()

  const editor = frame.locator('[contenteditable="true"]')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type('Launch checklist for Q3')
  await expect(frame.locator('.note-save-state')).toContainText('Saved', { timeout: 15000 })

  // Read straight from WebDAV through the BFF — the body round-tripped (PUT with etag).
  await expect.poll(async () =>
    (await (await request.get(`/api/notes/item?path=${encodeURIComponent(path)}`)).json()).body,
  ).toContain('Launch checklist for Q3')
})

test('full-text search finds a note by its body', async ({ page, request }) => {
  await seedNote(request, 'Roadmap', 'The quarterly roadmap covers onboarding revamp.')
  await gotoApp(page)
  const frame = widget(page, 'Notes')
  await expect(frame.getByText('Roadmap', { exact: true })).toBeVisible()

  await frame.getByLabel('Search notes').fill('onboarding')
  await expect(frame.getByText('Found in contents')).toBeVisible()
  await expect(frame.locator('.note-hit')).toContainText('Roadmap')
})

test('pin, trash and restore a note', async ({ page, request }) => {
  await seedNote(request, 'Keepsake', 'remember this')
  await gotoApp(page)
  const frame = widget(page, 'Notes')

  // Pin via the row context menu.
  await frame.getByText('Keepsake', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Pin/ }).click()
  await expect(frame.locator('.tree-section', { hasText: 'Pinned' })).toContainText('Keepsake')

  // Trash, then restore from the trash view.
  await frame.getByText('Keepsake', { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Trash|Delete/ }).click()
  await expect.poll(async () => (await (await request.get('/api/notes/trash')).json()).notes.length).toBeGreaterThan(0)

  await frame.getByRole('button', { name: 'Trash' }).click()
  await page.getByRole('button', { name: /Restore/ }).first().click()
  await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes.some((n) => n.title === 'Keepsake')).toBe(true)
})
