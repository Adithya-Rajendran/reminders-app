import { test, expect } from '@playwright/test'
import { COLS } from '../../../app/client/src/dashlayout.js'
import { gotoApp, seedLayout } from '../lib.mjs'

const OVERVIEW = {
  id: 'overview-live',
  size: { w: 12, h: 10 },
  min: { w: 6, h: 5 },
  max: { w: 28, h: 16 },
  aspect: { min: 0.9, max: 2.4 },
}

const HANDLES = [
  { handle: 'e', dx: 13, dy: 0, w: 1, h: 0 },
  { handle: 'w', dx: 4, dy: 0, w: -1, h: 0 },
  { handle: 'n', dx: 0, dy: 4, w: 0, h: -1 },
  { handle: 's', dx: 0, dy: 7, w: 0, h: 1 },
  { handle: 'ne', dx: 5, dy: 4, w: 1, h: -1 },
  { handle: 'nw', dx: 4, dy: 3, w: -1, h: -1 },
  { handle: 'se', dx: 6, dy: 4, w: 1, h: 1 },
  { handle: 'sw', dx: -4, dy: 5, w: 1, h: 1 },
]

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

async function savedOverview(request) {
  const response = await request.get('/api/layouts/main')
  expect(response.ok(), `GET /api/layouts/main -> ${response.status()}`).toBeTruthy()
  const { layout } = await response.json()
  return {
    layout,
    item: layout.layouts.lg.find((item) => item.i === OVERVIEW.id),
  }
}

test.describe('live aspect-constrained resize', () => {
  test.use({ viewport: { width: 1512, height: 982 } })

  for (const scenario of HANDLES) {
    test(`${scenario.handle} handle persists the previewed aspect-safe layout`, async ({ page, request }) => {
      await seedLayout(request, [
        { i: OVERVIEW.id, type: 'overview', x: 8, size: OVERVIEW.size },
        { i: 'focus-neighbor', type: 'focus', x: 8, size: { w: 7, h: 8 } },
      ])
      await gotoApp(page)

      const grid = page.locator('.react-grid-layout')
      const item = page.locator('.react-grid-item').filter({ has: page.getByText('Overview', { exact: true }) })
      const handle = item.locator(`.react-resizable-handle-${scenario.handle}`)
      await expect(item).toBeVisible()
      await expect(handle).toBeAttached()

      const [gridBox, before, handleBox] = await Promise.all([
        grid.boundingBox(),
        item.boundingBox(),
        handle.boundingBox(),
      ])
      expect(gridBox).toBeTruthy()
      expect(before).toBeTruthy()
      expect(handleBox).toBeTruthy()

      const colPitch = (gridBox.width + 16) / COLS.lg
      const rowPitch = 46
      const startX = handleBox.x + handleBox.width / 2
      const startY = handleBox.y + handleBox.height / 2
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX + scenario.dx * colPitch, startY + scenario.dy * rowPitch, { steps: 12 })

      await expect(page.locator('.react-grid-placeholder')).toBeVisible()
      const during = await item.boundingBox()
      expect(during).toBeTruthy()
      if (scenario.w) expect(Math.sign(during.width - before.width)).toBe(scenario.w)
      if (scenario.h) expect(Math.sign(during.height - before.height)).toBe(scenario.h)
      await page.mouse.up()

      await expect.poll(async () => {
        const { item: persisted } = await savedOverview(request)
        return `${persisted.w}x${persisted.h}`
      }, { timeout: 5000 }).not.toBe(`${OVERVIEW.size.w}x${OVERVIEW.size.h}`)

      const firstSave = await savedOverview(request)
      const persisted = firstSave.item
      expect(persisted.w).toBeGreaterThanOrEqual(OVERVIEW.min.w)
      expect(persisted.w).toBeLessThanOrEqual(OVERVIEW.max.w)
      expect(persisted.h).toBeGreaterThanOrEqual(OVERVIEW.min.h)
      expect(persisted.h).toBeLessThanOrEqual(OVERVIEW.max.h)
      if (scenario.w) expect(Math.sign(persisted.w - OVERVIEW.size.w)).toBe(scenario.w)
      if (scenario.h) expect(Math.sign(persisted.h - OVERVIEW.size.h)).toBe(scenario.h)

      // Integer grid rounding can miss a decimal aspect edge by at most one cell.
      const ratio = persisted.w / persisted.h
      expect(ratio).toBeGreaterThanOrEqual(OVERVIEW.aspect.min - (1 / persisted.h))
      expect(ratio).toBeLessThanOrEqual(OVERVIEW.aspect.max + (1 / persisted.h))

      const lg = firstSave.layout.layouts.lg
      for (let i = 0; i < lg.length; i++) {
        for (let j = i + 1; j < lg.length; j++) expect(overlaps(lg[i], lg[j])).toBe(false)
      }

      const savedSize = { w: persisted.w, h: persisted.h, x: persisted.x, y: persisted.y }
      await page.reload()
      await expect(page.locator('.app')).toBeVisible()
      await page.waitForTimeout(800)
      const afterReload = (await savedOverview(request)).item
      expect({ w: afterReload.w, h: afterReload.h, x: afterReload.x, y: afterReload.y }).toEqual(savedSize)
    })
  }
})
