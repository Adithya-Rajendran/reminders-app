import { test, expect } from '@playwright/test'
import { BREAKPOINTS, COLS, GRID_V } from '../../../app/client/src/dashlayout.js'
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

async function dragResize(page, item, handle, dx, dy) {
  await expect(item).toBeVisible()
  await item.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {}))))
  await expect(handle).toBeVisible()
  await handle.hover()
  const before = await item.boundingBox()
  expect(before).toBeTruthy()

  // Handles straddle the widget border and can overlap neighboring content.
  // Pick an integer pixel that the browser currently resolves to this handle
  // instead of assuming its geometric center is the actionable point.
  const hitPoint = () => handle.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const fractions = [0.5, 0.25, 0.75, 0.1, 0.9]
    for (const y of fractions) {
      for (const x of fractions) {
        const clientX = Math.round(rect.left + rect.width * x)
        const clientY = Math.round(rect.top + rect.height * y)
        const target = document.elementFromPoint(clientX, clientY)
        if (target === node || node.contains(target)) return { x: clientX, y: clientY }
      }
    }
    return null
  })
  let start = null
  for (let attempt = 0; attempt < 3; attempt++) {
    await handle.hover()
    start = await hitPoint()
    expect(start).toBeTruthy()
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(
      start.x + Math.sign(dx) * 8,
      start.y + Math.sign(dy) * 8,
      { steps: 4 },
    )
    await page.waitForTimeout(50)
    if (await item.evaluate((node) => node.classList.contains('resizing'))) break
    await page.mouse.up()
    await page.evaluate(() => document.getSelection()?.removeAllRanges())
    start = null
  }
  expect(start).toBeTruthy()
  const { x: startX, y: startY } = start
  await expect(item).toHaveClass(/resizing/)
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 })
  const placeholder = page.locator('.react-grid-placeholder')
  await expect(placeholder).toBeVisible()
  const preview = await placeholder.boundingBox()
  expect(Math.abs(preview.width - before.width) + Math.abs(preview.height - before.height)).toBeGreaterThan(20)
  await page.mouse.up()
  await expect(item).not.toHaveClass(/resizing/)
  return { before, preview }
}

test.describe('live aspect-constrained resize', () => {
  test.use({ viewport: { width: 1512, height: 982 } })

  for (const scenario of HANDLES) {
    test(`${scenario.handle} handle persists the previewed aspect-safe layout`, async ({ page, request }) => {
      await seedLayout(request, [
        { i: OVERVIEW.id, type: 'overview', x: 1, size: OVERVIEW.size },
        { i: 'focus-neighbor', type: 'focus', x: 1, size: { w: 7, h: 8 } },
      ])
      await gotoApp(page)

      const grid = page.locator('.react-grid-layout')
      const item = page.locator('.react-grid-item').filter({ has: page.getByText('Overview', { exact: true }) })
      const handle = item.locator(`.react-resizable-handle-${scenario.handle}`)
      const gridBox = await grid.boundingBox()
      expect(gridBox).toBeTruthy()

      const colPitch = (gridBox.width + 16) / COLS.lg
      const rowPitch = 46
      const dx = scenario.dx * colPitch
      const dy = scenario.dy * rowPitch
      await dragResize(page, item, handle, dx, dy)

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

test.describe('ultrawide resize persistence', () => {
  test.use({ viewport: { width: 3840, height: 1620 } })

  test('an edited generated tier becomes authoritative without changing lg', async ({ page, request }) => {
    const layout = {
      version: 1,
      gridV: GRID_V,
      widgets: [
        { i: OVERVIEW.id, type: 'overview' },
        { i: 'focus-neighbor', type: 'focus' },
      ],
      layouts: {
        lg: [
          { i: OVERVIEW.id, x: 1, y: 0, ...OVERVIEW.size },
          { i: 'focus-neighbor', x: 1, y: 10, w: 7, h: 8 },
        ],
      },
    }
    const seeded = await request.put('/api/layouts/main', { data: { layout } })
    expect(seeded.ok(), `seed ultrawide layout -> ${seeded.status()}`).toBeTruthy()
    await gotoApp(page)

    const grid = page.locator('.react-grid-layout')
    const item = page.locator('.react-grid-item').filter({ has: page.getByText('Overview', { exact: true }) })
    const gridBox = await grid.boundingBox()
    expect(gridBox).toBeTruthy()
    const activeTier = Object.entries(BREAKPOINTS)
      .sort((a, b) => b[1] - a[1])
      .find(([, minWidth]) => gridBox.width >= minWidth)?.[0]
    expect(activeTier).toBe('xxl')

    await dragResize(page, item, item.locator('.react-resizable-handle-e'), 300, 0)
    await expect.poll(async () => {
      const response = await request.get('/api/layouts/main')
      const { layout: saved } = await response.json()
      const edited = saved.layouts[activeTier]?.find((entry) => entry.i === OVERVIEW.id)
      return edited ? { saved, edited } : null
    }, { timeout: 5000 }).not.toBeNull()

    const response = await request.get('/api/layouts/main')
    const { layout: saved } = await response.json()
    const edited = saved.layouts[activeTier].find((entry) => entry.i === OVERVIEW.id)
    expect(`${edited.w}x${edited.h}`).not.toBe(`${OVERVIEW.size.w}x${OVERVIEW.size.h}`)
    expect(saved.layouts.lg.find((entry) => entry.i === OVERVIEW.id)).toMatchObject({ x: 1, y: 0, ...OVERVIEW.size })
    for (let i = 0; i < saved.layouts[activeTier].length; i++) {
      for (let j = i + 1; j < saved.layouts[activeTier].length; j++) {
        expect(overlaps(saved.layouts[activeTier][i], saved.layouts[activeTier][j])).toBe(false)
      }
    }

    const settled = await item.boundingBox()
    await page.reload()
    await expect(page.locator('.app')).toBeVisible()
    await page.waitForTimeout(800)
    const reloaded = await item.boundingBox()
    expect(Math.abs(reloaded.width - settled.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(reloaded.height - settled.height)).toBeLessThanOrEqual(1)
    const afterReload = await request.get('/api/layouts/main')
    const afterLayout = (await afterReload.json()).layout
    expect(afterLayout.layouts[activeTier].find((entry) => entry.i === OVERVIEW.id)).toMatchObject({
      x: edited.x, y: edited.y, w: edited.w, h: edited.h,
    })
  })
})
