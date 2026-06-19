// Widget-contributed Settings panels — light components a widget type adds to the
// Settings modal via its registry `settingsPanel`. Kept on their own SDK entry
// (off the main barrel and off the heavy notes entry) so importing a panel never
// drags in a widget's runtime deps.
export { default as NotesFolderPanel } from '../settings/NotesFolderSection.jsx'
