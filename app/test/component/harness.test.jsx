import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

// Smoke test: proves the vitest + jsdom + Testing Library harness is wired up
// (React renders, jest-dom matchers load, the ResizeObserver/matchMedia shims from
// test/setup.js are present). Real widget render tests live alongside this.
describe('component-test harness', () => {
  it('renders React into jsdom and matches with jest-dom', () => {
    render(<div role="status">ready</div>)
    expect(screen.getByRole('status')).toHaveTextContent('ready')
  })

  it('provides the jsdom polyfills widgets rely on', () => {
    expect(typeof globalThis.ResizeObserver).toBe('function')
    expect(typeof window.matchMedia).toBe('function')
    expect(window.matchMedia('(min-width: 1px)').matches).toBe(false)
  })
})
