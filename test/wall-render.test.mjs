import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: ItemView } = await import('../src/ui/ItemView.jsx')
const { default: WallFeed } = await import('../src/ui/WallFeed.jsx')
const { default: PeopleEditor } = await import('../src/ui/PeopleEditor.jsx')
const { default: MilestoneBanner } = await import('../src/ui/MilestoneBanner.jsx')

// compile-check the pieces that need a browser to run
await import('../src/ui/ShoutoutComposer.jsx')
await import('../src/ui/WallBody.jsx')
await import('../src/ui/BoardSettings.jsx')
await import('../src/ui/BoardScreen.jsx')

const shout = (id, at, over = {}) => ({ id, kind: 'shoutout', x: 0, y: 0, w: 320, h: 280, z: 0, rot: 0, authorUid: 'u1', authorName: 'Gus', reactions: {}, data: { toName: 'Ana', message: `msg ${id}`, badge: 'Teamwork', at, ...over } })
const noop = () => {}

test('a shout-out draws on the canvas: badge, name chip, message, author; text is escaped', () => {
  const html = renderToStaticMarkup(createElement(ItemView, { item: shout('a', 1, { message: '<script>x</script>', to: 'p1' }), selected: false, editable: false, onChange: noop, onSelect: noop, label: 'x' }))
  assert.match(html, /Teamwork/)
  assert.match(html, /@Ana/)
  assert.match(html, /Gus/)
  assert.doesNotMatch(html, /<script>/)
})

test('the feed lists shout-outs newest first with a reactions bar (aria-pressed for your own) and a Load more at 30', () => {
  const items = Array.from({ length: 32 }, (_, i) => shout(`i${i}`, i, i === 31 ? { toName: 'Zed' } : {}))
  items[31].reactions = { '🎉': ['me', 'u2'] }
  const ctl = { items, uid: 'me', readOnly: false, canEdit: (i) => i.authorUid === 'me', local: noop, notify: noop, code: 'ABC', state: { people: [] } }
  const html = renderToStaticMarkup(createElement(WallFeed, { ctl }))
  assert.ok(html.indexOf('msg i31') < html.indexOf('msg i30'), 'newest first')
  assert.doesNotMatch(html, /msg i1</) // the 32nd oldest is behind Load more
  assert.match(html, /Load more \(2 left\)/)
  assert.match(html, /aria-pressed="true"[^>]*aria-label="🎉 2 reactions"|aria-label="🎉 2 reactions"[^>]*aria-pressed="true"/)
  assert.match(html, /Give a shout-out/)
  const ro = renderToStaticMarkup(createElement(WallFeed, { ctl: { ...ctl, items: [], readOnly: true } }))
  assert.doesNotMatch(ro, /Give a shout-out/)
  assert.match(ro, /No shout-outs yet/)
})

test('people editor and the milestone banner render without a browser', () => {
  const html = renderToStaticMarkup(createElement(PeopleEditor, { ctl: { code: 'ABC', state: { people: [{ id: 'p', name: 'Ana', birthday: '03-14', startDate: '2020-05-06T00:00:00.000Z' }] } } }))
  assert.match(html, /Add a person/)
  assert.match(html, /value="Ana"/)
  assert.match(html, /value="03-14"/)
  assert.match(html, /value="2020-05-06"/)
  assert.match(renderToStaticMarkup(createElement(MilestoneBanner, { code: 'ABC', ready: false })), /aria-live="polite"/)
})
