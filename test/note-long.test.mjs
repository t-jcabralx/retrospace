import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { scrollsInside } from '../src/ui/useViewport.js'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')
const noteEl = (o) => ({ closest: (sel) => (sel === '.bd-note' ? { scrollHeight: 400, clientHeight: 100, scrollTop: 0, ...o } : null) })

test('the wheel scrolls a long note until it reaches its end, then goes back to panning the canvas', () => {
  assert.equal(scrollsInside(noteEl({ scrollTop: 0 }), 40), true) // down, room left
  assert.equal(scrollsInside(noteEl({ scrollTop: 150 }), 40), true)
  assert.equal(scrollsInside(noteEl({ scrollTop: 300 }), 40), false) // at the bottom: the canvas pans
  assert.equal(scrollsInside(noteEl({ scrollTop: 0 }), -40), false) // up, at the top
  assert.equal(scrollsInside(noteEl({ scrollTop: 120 }), -40), true)
  assert.equal(scrollsInside(noteEl({ scrollHeight: 100, clientHeight: 100 }), 40), false) // a note that fits does not take the wheel
  assert.equal(scrollsInside({ closest: () => null }, 40), false) // not over a note
  assert.equal(scrollsInside(noteEl({}), 0), false)
})

test('a long note scrolls, shows a Read all button, and opens the whole text in a dialog that keeps focus', async () => {
  const note = await read('src/ui/items/Note.jsx')
  for (const word of ['Read all', 'Read the whole note', 'role="dialog"', 'useModal', 'Copy the text', 'ResizeObserver', "e.stopPropagation()"]) assert.ok(note.includes(word), word)
  const css = await read('src/ui/board.css')
  assert.match(css, /\.bd-note \{[^}]*overflow-y: auto/)
  assert.match(css, /\.bd-note\.has-foot \{ padding-bottom/)
  assert.ok((await read('src/ui/useViewport.js')).includes('scrollsInside(e.target, e.deltaY)'))
})

test('an anonymous note never shows its author in the reader', async () => {
  assert.ok((await read('src/ui/items/Note.jsx')).includes("item.anon ? '' : item.authorName"))
})
