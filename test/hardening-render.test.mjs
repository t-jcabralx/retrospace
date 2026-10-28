import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFile } from 'node:fs/promises'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: ItemView } = await import('../src/ui/ItemView.jsx')
const { default: BoardErrorBoundary } = await import('../src/ui/BoardErrorBoundary.jsx')
const { default: ErrorPage } = await import('../src/app/error.js')

const noop = () => {}
const view = (item) => renderToStaticMarkup(createElement(ItemView, { item, selected: false, editable: true, onChange: noop, onSelect: noop, label: 'x' }))

test('an item of a kind this build cannot draw renders nothing instead of crashing the board', () => {
  for (const kind of ['topic', 'zzz']) { // shoutout (wall-render.test.mjs) and theme now have renderers
    assert.equal(view({ id: 'i1', kind, x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data: { text: 'hi' } }), '', kind)
  }
  assert.match(view({ id: 'i2', kind: 'note', x: 0, y: 0, w: 100, h: 100, z: 0, rot: 0, data: { text: 'hello', color: 'yellow' } }), /hello/, 'known kinds still draw')
})

test('the board error boundary turns a render error into a panel with a reload button', () => {
  assert.deepEqual(BoardErrorBoundary.getDerivedStateFromError(new Error('boom')), { failed: true })
  const ok = new BoardErrorBoundary({ children: 'fine' })
  assert.equal(ok.render(), 'fine')
  const failed = new BoardErrorBoundary({ children: 'fine' })
  failed.state = { failed: true }
  const html = renderToStaticMarkup(failed.render())
  assert.match(html, /This board hit a problem/)
  assert.match(html, /Reload the board/)
  assert.match(html, /href="\/"/)
})

test('app/error.js is a client error page with a retry button', async () => {
  const src = await readFile(new URL('../src/app/error.js', import.meta.url), 'utf8')
  assert.match(src, /^'use client'/)
  assert.match(renderToStaticMarkup(createElement(ErrorPage, { reset: noop })), /Something went wrong/)
})

test('the board screen wraps the canvas in the error boundary', async () => {
  const src = await readFile(new URL('../src/ui/BoardScreen.jsx', import.meta.url), 'utf8')
  assert.match(src, /<BoardErrorBoundary><Board /)
})
