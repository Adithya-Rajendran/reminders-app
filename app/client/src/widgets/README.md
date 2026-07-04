# Widget ownership

Widgets should be owned as folders once they need more than a small render file.
Keep widget-specific components, pure layout helpers, CSS, and notes in that
folder so parallel work on one widget does not collide with the host app or with
other widgets.

The Prioritize widget (`triage/`) is the current folder-based reference:

- `TriageWidget.jsx` wires app capabilities and widget-local state.
- `layout.js` holds pure size-tier decisions that component tests can exercise.
- Child components render the callout, matrix, and quadrants.
- `TriageWidget.css` contains only Prioritize styles.

Widgets still import shared behavior only through `../widget-sdk` from top-level
widget files or `../../widget-sdk` from nested widget folders. Keep root widget
files as compatibility shims when moving an existing widget.
