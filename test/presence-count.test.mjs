import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/jsx-loader.mjs', import.meta.url)

const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: Presence, PresenceView } = await import('../src/ui/Presence.jsx')

const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }
const store = (peers) => ({ subscribe: () => () => {}, getPeers: () => peers, getCursors: () => [], getSelections: () => [], hasPeers: () => peers.length > 0 })
const peer = (id, name) => ({ id, name, avatar: AV })
const html = (peers) => renderToStaticMarkup(createElement(PresenceView, { peers, me: { name: 'Me', avatar: AV } }))

test('alone, a "1 online" chip says so, and it is not a button', () => {
  const out = html([])
  assert.match(out, /bd-presence-solo/)
  assert.match(out, />1<span class="bd-presence-word"> online<\/span>/)
  assert.match(out, /Only you are here/)
  assert.doesNotMatch(out, /<button/)
})

test('with others here, the button shows how many are online (you included) and names the count for screen readers', () => {
  const out = html([peer('p1', 'Ann'), peer('p2', 'Bob')])
  assert.match(out, /aria-label="3 people here"/)
  assert.match(out, /bd-presence-count[^>]*><i class="bd-presence-dot"><\/i>3<span class="bd-presence-word"> online<\/span>/)
  assert.doesNotMatch(out, /bd-presence-solo/)
})

test('the count is the people here now: one peer makes 2, and more than five show a +N beside the same count', () => {
  assert.match(html([peer('p1', 'Ann')]), /aria-label="2 people here"/)
  const many = html(Array.from({ length: 7 }, (_, i) => peer(`p${i}`, `P${i}`)))
  assert.match(many, /aria-label="8 people here"/)
  assert.match(many, /bd-presence-more">\+2</)
  assert.match(many, /<\/i>8<span/)
})

test('the store-backed Presence renders no roster on the server (there is no presence there), so it shows the alone chip', () => {
  const out = renderToStaticMarkup(createElement(Presence, { presence: store([peer('p1', 'Ann')]), me: { name: 'Me', avatar: AV } }))
  assert.match(out, /bd-presence-solo/)
})
