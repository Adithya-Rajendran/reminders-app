import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetConfigForm } from '../../client/src/Dashboard.jsx'
import { resolveWidgetConfig } from '../../client/src/widgets/manifest.js'

// The generic per-instance config form (manifest issue #78): it renders one
// control per typed field descriptor and hands the edited draft back on Save.
// It's pure UI over the schema — it knows the four field types, not any widget —
// so it's tested in isolation from the dashboard it normally lives in.
const SCHEMA = [
  { key: 'quickWinsFirst', label: 'Start with 2-minute wins only', type: 'boolean', default: false },
  { key: 'limit', label: 'Items to preview', type: 'number', default: 5, min: 1, max: 20 },
  { key: 'mode', label: 'Mode', type: 'select', default: 'a', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] },
  { key: 'note', label: 'Note', type: 'text', default: '' },
]

describe('WidgetConfigForm', () => {
  it('renders one labelled control per schema field, seeded with the current values', () => {
    const values = resolveWidgetConfig(SCHEMA, { quickWinsFirst: true, limit: 8, mode: 'b', note: 'hi' })
    render(<WidgetConfigForm schema={SCHEMA} values={values} onSave={() => {}} />)
    expect(screen.getByLabelText('Start with 2-minute wins only')).toBeChecked()
    expect(screen.getByLabelText('Items to preview')).toHaveValue(8)
    expect(screen.getByLabelText('Mode')).toHaveValue('b')
    expect(screen.getByLabelText('Note')).toHaveValue('hi')
  })

  it('stages edits locally and commits the full draft on Save', async () => {
    const onSave = vi.fn()
    const values = resolveWidgetConfig(SCHEMA, undefined) // all defaults
    render(<WidgetConfigForm schema={SCHEMA} values={values} onSave={onSave} />)

    await userEvent.click(screen.getByLabelText('Start with 2-minute wins only'))
    const limit = screen.getByLabelText('Items to preview')
    await userEvent.clear(limit)
    await userEvent.type(limit, '12')
    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'b')

    // Nothing committed until Save (edits are staged in a local draft).
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ quickWinsFirst: true, limit: 12, mode: 'b', note: '' })
  })

  it('enforces a number field\'s declared min/max on the input', () => {
    render(<WidgetConfigForm schema={SCHEMA} values={resolveWidgetConfig(SCHEMA, undefined)} onSave={() => {}} />)
    const limit = screen.getByLabelText('Items to preview')
    expect(limit).toHaveAttribute('min', '1')
    expect(limit).toHaveAttribute('max', '20')
  })
})
