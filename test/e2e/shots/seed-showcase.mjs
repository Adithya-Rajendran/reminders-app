// Seed the "showcase" board: all 9 widget types, populated with enough data
// that every widget has something real to render (see README.md for the
// exact breakdown). Runs inside a plain node:22-bookworm-slim container
// against the already-provisioned shots-bff (see run.sh/start-bff.sh).
import {
  clearTasks, createTask, patchTask, listTasks,
  clearNotes, createNote,
  clearEvents, createEvent,
  showcaseLayout, putLayout,
  isoIn, isoDaysAgo, isoDaysFromNow,
} from './seedlib.mjs'

async function seedTasks() {
  await clearTasks()

  // 3 overdue
  await createTask({ title: 'Renew passport', due_date: isoDaysAgo(5), priority: 2 })
  await createTask({ title: 'Follow up with vendor', due_date: isoDaysAgo(2), priority: 1, labels: [{ title: 'Work' }] })
  await createTask({ title: 'Return library books', due_date: isoDaysAgo(1) })

  // 4 due today — mixed priority 0-3, some with time_estimate + dread. Two
  // also carry a VALARM reminder (`reminders`) — the Reminders widget filters
  // on THAT field (not due_date), so it needs at least a couple to not be empty.
  await createTask({ title: 'Prep board deck', due_date: isoDaysFromNow(0, 11), priority: 3, time_estimate: 90, dread: 4, labels: [{ title: 'Work' }], reminders: [{ reminder: isoIn(90) }] })
  await createTask({ title: 'Grocery run', due_date: isoDaysFromNow(0, 17), priority: 1 })
  await createTask({ title: 'Call dentist', due_date: isoDaysFromNow(0, 13), priority: 0, reminders: [{ reminder: isoIn(240) }] })
  await createTask({ title: 'Review PR queue', due_date: isoDaysFromNow(0, 15), priority: 2, time_estimate: 45, dread: 2, labels: [{ title: 'Focus' }] })

  // 4 due this week
  await createTask({ title: 'Plan offsite agenda', due_date: isoDaysFromNow(2), priority: 2, labels: [{ title: 'Work' }] })
  await createTask({ title: 'Renew car registration', due_date: isoDaysFromNow(3), priority: 1 })
  await createTask({ title: 'Draft Q3 goals', due_date: isoDaysFromNow(5), priority: 3, labels: [{ title: 'Personal' }] })
  await createTask({ title: 'Book dentist cleaning', due_date: isoDaysFromNow(6) })

  // 3 undated
  await createTask({ title: "Read 'Deep Work'", labels: [{ title: 'Personal' }] })
  await createTask({ title: 'Organize garage' })
  await createTask({ title: 'Learn keyboard shortcuts' })

  // 2 completed (create, then complete — same as the review.spec.mjs pattern)
  for (const title of ['Send invoice #1042', 'Submit expense report']) {
    const t = await createTask({ title })
    await patchTask(t.id, { done: true })
  }

  // 3 with a cue; 2 of those ALSO get flow positions (1 edge), 1 stays queued.
  await createTask({ title: 'Stretch', cue: 'after I wake up' })
  await createTask({ title: 'Check inbox', cue: 'when I sit at my desk' })
  await createTask({ title: 'Walk the dog', cue: 'after dinner' }) // stays queued — no flow

  const all = await listTasks()
  const uidOf = (title) => all.find((t) => t.title === title)?.uid
  const idOf = (title) => all.find((t) => t.title === title)?.id
  const inboxUid = uidOf('Check inbox')
  // Kept well inside a default-sized widget's initial viewport (NODE_W=188 —
  // see CuesWidget.jsx) so both nodes + the edge between them are visible
  // without needing to scroll the flow canvas.
  await patchTask(idOf('Stretch'), { flow: { x: 30, y: 30, to: [inboxUid] } })
  await patchTask(idOf('Check inbox'), { flow: { x: 260, y: 200, to: [] } })

  console.log(`  seeded ${all.length} tasks`)
}

async function seedNotes() {
  await clearNotes()
  await createNote('Quick note', 'Pick up dry cleaning before 6pm.')
  await createNote('Sprint board', `## Sprint tasks

| Task | Owner | Status |
| --- | --- | --- |
| Design review | Ana | Done |
| API migration | Sam | In progress |
| Docs pass | Priya | Todo |

- [ ] Write release notes
- [x] Tag v2.3.0
- [ ] Notify support team
`)
  // A single ~800-char paragraph with NO line breaks — the Notes measure-cap
  // repro (PR 9 adds `.tiptap-content { max-width: var(--measure) }`).
  const longParagraph = 'Meeting notes from the quarterly planning session covering roadmap priorities budget allocation and staffing needs for the next two quarters with input from engineering product design and customer success so that every team has a shared understanding of what is committed versus exploratory and can plan their own sprints accordingly while leaving enough slack for on-call rotations, incident response, and the usual mid-quarter scope changes that always show up right when everyone thought the plan was finally settled and stable for once this year, especially once the holiday freeze and the annual audit both land in the same six-week window as the migration, which is exactly the kind of overlap this recap exists to flag early, before anyone has quietly started three more projects than the team actually has room for this quarter.'
  await createNote('Q3 planning recap', longParagraph)
  console.log('  seeded 3 notes')
}

async function seedEvents() {
  await clearEvents()
  await createEvent('Team sync', isoDaysFromNow(0, 14), isoDaysFromNow(0, 15), false)
  await createEvent('Company offsite', isoDaysFromNow(4), isoDaysFromNow(5), true)
  console.log('  seeded 2 calendar events')
}

await seedTasks()
await seedNotes()
await seedEvents()
await putLayout(showcaseLayout())
console.log('  showcase layout saved')
