// Shared "new note" action: create an Untitled note and open it in the Notes
// widget via the notes bus. Lifted out of the command palette so the bare 'n'
// hotkey and the palette run the SAME code path. Failure is announced (the
// palette used to swallow it silently).
import { notesApi } from './api.js'
import { emitOpenNote } from './notesbus.js'
import { announce } from './widget-sdk'

export async function createAndOpenNote() {
  try {
    const n = await notesApi.create('', 'Untitled')
    emitOpenNote(n.path)
  } catch {
    announce('Could not create a note — check your notes connection in Settings.')
  }
}
