import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PriorityDot } from '../../client/src/widget-sdk/ui/PriorityDot.jsx'

// The a11y contract: priority must be conveyed by the glyph's SHAPE (lit-bar count),
// not by colour alone (WCAG 1.4.1). So the number of lit bars must track the level
// independently of any colour — that's what a colour-blind user reads.
const litCount = (container) => container.querySelectorAll('.pbar.on').length

describe('PriorityDot', () => {
  it('lights more bars as priority rises — meaning without relying on colour', () => {
    // pdotClass: 5,4 → p1 (3 bars) · 3 → p2 (2) · 2,1 → p3 (1) · 0 → p4 (0)
    expect(litCount(render(<PriorityDot value={5} />).container)).toBe(3)
    expect(litCount(render(<PriorityDot value={4} />).container)).toBe(3)
    expect(litCount(render(<PriorityDot value={3} />).container)).toBe(2)
    expect(litCount(render(<PriorityDot value={2} />).container)).toBe(1)
    expect(litCount(render(<PriorityDot value={1} />).container)).toBe(1)
    expect(litCount(render(<PriorityDot value={0} />).container)).toBe(0)
  })

  it('always renders exactly three bars (the unlit ones stay visible as shape)', () => {
    const { container } = render(<PriorityDot value={3} />)
    expect(container.querySelectorAll('.pbar').length).toBe(3)
  })

  it('is decorative by default (aria-hidden, no duplicate announcement)', () => {
    const { container } = render(<PriorityDot value={4} />)
    const glyph = container.querySelector('.pbars')
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
    expect(glyph.getAttribute('role')).toBe(null)
  })

  it('carries its own label when standalone (the only priority cue present)', () => {
    const { container } = render(<PriorityDot value={4} standalone />)
    const glyph = container.querySelector('.pbars')
    expect(glyph.getAttribute('role')).toBe('img')
    expect(glyph.getAttribute('aria-label')).toBe('Priority: Urgent')
  })
})
