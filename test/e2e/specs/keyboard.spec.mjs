import { test, expect } from '@playwright/test'
import { gotoApp } from '../lib.mjs'

// Keyboard spine: '?' cheat sheet, Ctrl+K command palette (including running a
// command from it), and Ctrl+]/[ dashboard cycling.
// Every test restores global state in afterEach so the harness stays clean.

test.describe('Keyboard shortcuts', () => {
  test.afterEach(async ({ request }) => {
    // Restore the single default dashboard so dashboard-cycling tests don't
    // leave extra tabs that break subsequent specs.
    await request.put('/api/dashboards', {
      data: { dashboards: [{ id: 'main', name: 'Dashboard' }] },
    })
  })

  test('cheat sheet via ? and palette', async ({ page }) => {
    await gotoApp(page)

    // '?' opens the cheat sheet modal from anywhere on the page.
    await page.keyboard.press('?')
    const heading = page.getByRole('heading', { name: 'Keyboard shortcuts' })
    await expect(heading).toBeVisible()

    // Escape closes it.
    await page.keyboard.press('Escape')
    await expect(heading).toBeHidden()

    // Ctrl+K opens the command palette in command mode (prefilled with '>').
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('combobox', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(palette).toHaveValue('>')

    // Type '>shortcuts' so the 'Keyboard shortcuts' command floats to the top.
    await palette.fill('>shortcuts')
    await page.keyboard.press('Enter')

    // The command runs setHelp(true) which opens the cheat sheet again.
    await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('Ctrl+]/[ cycles dashboards', async ({ page, request }) => {
    // Provision two dashboards. The second id and name must satisfy the server
    // validation rules (id /^[\w-]{1,64}$/, non-empty name, ≤24 dashboards).
    await request.put('/api/dashboards', {
      data: { dashboards: [{ id: 'main', name: 'Dashboard' }, { id: 'd-two', name: 'Second' }] },
    })

    await gotoApp(page)

    // Active tab should be 'Dashboard' (first dashboard).
    const activeTab = page.locator('.dash-tab.on')
    await expect(activeTab).toContainText('Dashboard')

    // Ctrl+] cycles forward → Second.
    await page.keyboard.press('Control+]')
    await expect(activeTab).toContainText('Second')

    // Ctrl+] again wraps around → Dashboard.
    await page.keyboard.press('Control+]')
    await expect(activeTab).toContainText('Dashboard')

    // Ctrl+[ cycles backward → Second.
    await page.keyboard.press('Control+[')
    await expect(activeTab).toContainText('Second')
  })
})
