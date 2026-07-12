import { test, expect } from '@playwright/test'
import { gotoApp, PRIMARY_VIEWPORTS, seedLayout } from '../lib.mjs'

for (const viewport of PRIMARY_VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('desktop controls stay on one row and the widget menu stays reachable', async ({ page, request }) => {
      await seedLayout(request, [{ i: 'overview-shell', type: 'overview', size: { w: 12, h: 8 } }])
      await gotoApp(page)

      const topbar = page.locator('.topbar')
      const actions = topbar.locator('.topbar-actions')
      await expect(actions).toBeVisible()
      const [topbarBox, actionsBox] = await Promise.all([topbar.boundingBox(), actions.boundingBox()])
      expect(topbarBox.height).toBeLessThanOrEqual(64)
      expect(actionsBox.height).toBeLessThanOrEqual(40)

      const controlBoxes = await actions.locator('button, a').evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom }
      }))
      expect(controlBoxes.length).toBeGreaterThanOrEqual(4)
      expect(Math.max(...controlBoxes.map((box) => box.top)) - Math.min(...controlBoxes.map((box) => box.top))).toBeLessThanOrEqual(2)
      expect(Math.max(...controlBoxes.map((box) => box.bottom)) - Math.min(...controlBoxes.map((box) => box.bottom))).toBeLessThanOrEqual(2)

      const trigger = page.getByRole('button', { name: 'Add widget' })
      await trigger.click()
      const menu = page.locator('.add-widget-menu')
      await expect(menu).toBeVisible()
      const menuBox = await menu.boundingBox()
      expect(menuBox.x).toBeGreaterThanOrEqual(16)
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width - 16)
      expect(menuBox.y).toBeGreaterThanOrEqual(16)
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 16)

      const overflow = await menu.evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
      }))
      expect(overflow.overflowY).toBe('auto')
      expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight)

      const pageScroll = await page.evaluate(() => scrollY)
      await menu.hover()
      await page.mouse.wheel(0, 1400)
      await expect.poll(() => menu.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
      expect(await page.evaluate(() => scrollY)).toBe(pageScroll)

      await menu.evaluate((node) => { node.scrollTop = 0 })
      const items = menu.getByRole('menuitem')
      await items.first().focus()
      await page.keyboard.press('End')
      await expect(items.last()).toBeFocused()
      const lastBox = await items.last().boundingBox()
      const focusedMenuBox = await menu.boundingBox()
      expect(lastBox.y).toBeGreaterThanOrEqual(focusedMenuBox.y)
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(focusedMenuBox.y + focusedMenuBox.height)
      expect(await page.evaluate(() => scrollY)).toBe(pageScroll)
    })
  })
}
