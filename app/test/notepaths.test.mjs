// Unit tests for the note image/drawing path helpers (client/src/notepaths.js).
// Pure module (no Tiptap), so it imports cleanly in Node. Run with:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/notepaths.test.mjs
import { isDrawing, drawingId, sceneNameFor, toDisplay, toDisk, widthOf, withWidth, RES_PREFIX } from '../client/src/notepaths.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- drawing detection ----
ok(isDrawing('/api/notes/resources/x.excalidraw.png'), 'isDrawing: plain')
ok(isDrawing('/api/notes/resources/x.excalidraw.png?v=1'), 'isDrawing: with ?query')
ok(isDrawing('_resources/x.excalidraw.png#w640'), 'isDrawing: with #fragment')
ok(!isDrawing('_resources/photo.png'), 'isDrawing: a normal png is not a drawing')
ok(drawingId('_resources/abc-123.excalidraw.png#w640') === 'abc-123', 'drawingId extracts the id before the fragment')

// ---- scene name resolution (which .excalidraw a drawing image edits) ----
ok(sceneNameFor('/api/notes/resources/abc.excalidraw.png') === 'abc.excalidraw', 'sceneNameFor: new embed -> <id>.excalidraw')
ok(sceneNameFor('/api/notes/resources/abc.excalidraw.png?v=9#w320') === 'abc.excalidraw', 'sceneNameFor: ignores ?query + #fragment')
ok(sceneNameFor('_resources/abc.png') === 'abc.excalidraw', 'sceneNameFor: old embed (<id>.png) -> <id>.excalidraw')
ok(sceneNameFor('_resources/photo.jpg') === 'photo.excalidraw', 'sceneNameFor: any image maps to a candidate scene (existence is checked separately)')
ok(sceneNameFor('') === null, 'sceneNameFor: empty src -> null')

// ---- display <-> disk rewrite ----
ok(toDisplay('![d](_resources/x.png)') === '![d](' + RES_PREFIX + 'x.png)', 'toDisplay rewrites _resources -> API url')
ok(toDisk('![d](' + RES_PREFIX + 'x.png)') === '![d](_resources/x.png)', 'toDisk rewrites API url -> _resources')
ok(toDisk('![d](' + RES_PREFIX + 'x.excalidraw.png?v=99#w640)') === '![d](_resources/x.excalidraw.png#w640)', 'toDisk drops ?query (cache-bust), keeps #fragment (width)')
ok(toDisk('![d](' + RES_PREFIX + 'x.png#w320)') === '![d](_resources/x.png#w320)', 'toDisk keeps a width fragment with no query')
const disk = '![d](_resources/x.excalidraw.png#w480)'
ok(toDisk(toDisplay(disk)) === disk, 'disk -> display -> disk is stable (width survives a round-trip)')
ok(toDisk('[link](https://example.com)') === '[link](https://example.com)', 'toDisk leaves external links alone')
ok(toDisplay('[link](https://example.com)') === '[link](https://example.com)', 'toDisplay leaves external links alone')

// ---- width fragment helpers ----
ok(widthOf('x.png#w640') === 640, 'widthOf reads #w640')
ok(widthOf('x.png') === null, 'widthOf is null with no fragment')
ok(widthOf('x.png?v=1') === null, 'widthOf ignores a ?query (only the fragment carries width)')
ok(withWidth('x.png', 320) === 'x.png#w320', 'withWidth adds a width fragment')
ok(withWidth('x.png#w100', 320) === 'x.png#w320', 'withWidth replaces an existing width')
ok(withWidth('x.png#w100', null) === 'x.png', 'withWidth(null) clears the fragment')

console.log(`\nnotepaths.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
