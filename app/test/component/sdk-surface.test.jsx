import { describe, it, expect } from 'vitest'
import * as sdk from '../../client/src/widget-sdk'
import * as notes from '../../client/src/widget-sdk/notes'

// Tripwire for the widget-SDK public surface (the only thing widgets may import).
// If a refactor accidentally drops an export, this fails — and a deliberate
// surface change must be reflected here on purpose. Keeps the contract honest.
const MAIN_SURFACE = [
  // UI primitives
  'SkeletonRows', 'EmptyState', 'ErrorState', 'UndoBar', 'TaskRow', 'EstimateControl', 'DreadControl', 'fmtEst', 'DateTimePicker', 'GroupPicker', 'GroupList',
  // hooks
  'WidgetSizeContext', 'useWidgetSize', 'useElementSize', 'usePopover', 'useModalRef',
  // sizing
  'atLeastW', 'atMostW', 'atLeastH', 'atMostH', 'DEFAULT_WIDGET_SIZE',
  // task list + storage
  'useTaskList', 'widgetStore', 'loadJson', 'saveJson', 'loadStringSet', 'saveStringSet',
  // pure domain (sampled across the re-exported modules)
  'selectUpcoming', 'selectFrog', 'selectFlowSource', 'selectHabits', 'dueBucket',
  'computeReview', 'computeHabitStats', 'taskXp', 'levelProgress', 'dailyStreak', 'buildTree', 'sortNotes', 'ancestorsOf', 'pushRecent',
  'dueChip', 'timeLabel', 'pdotClass', 'PRIORITIES', 'parseQuickAdd', 'ZERO_DATE', 'isRealDate',
  // icons (sampled)
  'IconBell', 'IconCalendar', 'IconNote', 'IconCue', 'IconFrog',
]

describe('widget-sdk public surface', () => {
  it('exports the documented main-barrel surface', () => {
    const missing = MAIN_SURFACE.filter((name) => !(name in sdk))
    expect(missing).toEqual([])
  })

  it('keeps the heavy Notes editor stack on the separate /notes entry', () => {
    for (const name of ['NoteEditor', 'NoteContextMenu', 'TrashView', 'PromptModal']) {
      expect(name in notes, `${name} on /notes`).toBe(true)
      expect(name in sdk, `${name} absent from main barrel`).toBe(false)
    }
  })
})
