import test from 'node:test'
import assert from 'node:assert/strict'
import { pickGif, checkGifLink, GIPHY_ATTRIBUTION, GIPHY_DISCLOSURE, SEARCH_DEBOUNCE_MS, GIPHY_OPTIONS } from '../src/ui/gif.js'
import { validateItem } from '../src/lib/validate.js'

const result = (images, extra = {}) => ({ id: 'abc', title: 'a gif', url: 'https://giphy.com/gifs/abc', images, user: { username: 'someone' }, analytics: { onload: { url: 'https://x' } }, ...extra })

test('pickGif takes only the fixed-height https url and its size', () => {
  const g = pickGif(result({
    fixed_height: { url: 'https://media0.giphy.com/media/abc/200.gif', width: 356, height: 200, webp: 'https://x/200.webp' },
    downsized: { url: 'https://media0.giphy.com/media/abc/giphy-downsized.gif', width: 300, height: 170 },
  }))
  assert.deepEqual(g, { url: 'https://media0.giphy.com/media/abc/200.gif', w: 356, h: 200 })
  assert.deepEqual(Object.keys(g).sort(), ['h', 'url', 'w'], 'nothing else of the API response is kept')
})

test('pickGif accepts sizes given as strings (the raw API) and rounds them', () => {
  const g = pickGif(result({ fixed_height: { url: 'https://m.giphy.com/a.gif', width: '356', height: '200.4' } }))
  assert.deepEqual(g, { url: 'https://m.giphy.com/a.gif', w: 356, h: 200 })
})

test('pickGif falls back to downsized when fixed_height is missing or not https', () => {
  const down = { url: 'https://m.giphy.com/d.gif', width: 300, height: 170 }
  assert.equal(pickGif(result({ downsized: down })).url, down.url)
  assert.equal(pickGif(result({ fixed_height: { url: '', width: 1, height: 1 }, downsized: down })).url, down.url)
  assert.equal(pickGif(result({ fixed_height: { url: 'http://insecure.example/a.gif', width: 1, height: 1 }, downsized: down })).url, down.url)
  assert.equal(pickGif(result({ fixed_height: { url: 'javascript:alert(1)', width: 1, height: 1 }, downsized: down })).url, down.url)
})

test('pickGif returns null when nothing usable is there', () => {
  for (const bad of [null, undefined, {}, { images: null }, result({}), result({ fixed_height: { url: 'http://x/a.gif' } }), 'str', 42]) assert.equal(pickGif(bad), null)
})

test('pickGif leaves the size out of range or missing as null-safe values', () => {
  const g = pickGif(result({ fixed_height: { url: 'https://m.giphy.com/a.gif' } }))
  assert.deepEqual(g, { url: 'https://m.giphy.com/a.gif', w: null, h: null })
  const huge = pickGif(result({ fixed_height: { url: 'https://m.giphy.com/a.gif', width: 99999, height: -4 } }))
  assert.deepEqual(huge, { url: 'https://m.giphy.com/a.gif', w: null, h: null })
})

test('a picked gif always passes the server card rule', () => {
  const g = pickGif(result({ fixed_height: { url: 'https://media0.giphy.com/media/abc/200.gif', width: 356, height: 200 } }))
  const item = { id: 'c1', kind: 'card', x: 0, y: 0, w: 300, h: 300, data: { message: 'Hi', signer: 'Sam', color: 'pink', gif: g.url, mediaW: g.w, mediaH: g.h } }
  assert.equal(validateItem(item).ok, true)
})

test('checkGifLink accepts https urls the server accepts', () => {
  for (const u of ['https://media.giphy.com/media/abc/giphy.gif', ' https://media.tenor.com/x/y.gif  ', 'HTTPS://EXAMPLE.com/a.png', 'https://example.com/a?b=c&d=e']) {
    const r = checkGifLink(u)
    assert.equal(r.ok, true, u)
    assert.ok(r.url.startsWith('https://') || r.url.startsWith('HTTPS://'))
    assert.equal(validateItem({ id: 'c1', kind: 'card', x: 0, y: 0, data: { message: 'm', signer: 's', color: 'pink', gif: r.url } }).ok, true)
  }
})

test('checkGifLink trims the link it returns', () => {
  assert.equal(checkGifLink('  https://x.test/a.gif \n').url, 'https://x.test/a.gif')
})

test('checkGifLink refuses everything else with a message to show', () => {
  for (const u of ['', '   ', 'http://x.test/a.gif', 'javascript:alert(1)', 'data:image/gif;base64,AAAA', 'ftp://x.test/a.gif', 'x.test/a.gif', 'https://', 'https:// spaced.test/a.gif', 'not a link', '//x.test/a.gif', 'https://x.test/a b.gif']) {
    const r = checkGifLink(u)
    assert.equal(r.ok, false, JSON.stringify(u))
    assert.ok(typeof r.error === 'string' && r.error.length > 5)
  }
  assert.match(checkGifLink('http://x.test/a.gif').error, /https/)
  assert.equal(checkGifLink('https://x.test/' + 'a'.repeat(2100)).ok, false)
  assert.equal(checkGifLink(undefined).ok, false)
  assert.equal(checkGifLink(null).ok, false)
})

test('the picker constants carry the decisions', () => {
  assert.equal(SEARCH_DEBOUNCE_MS, 400)
  assert.deepEqual(GIPHY_OPTIONS, { rating: 'pg-13', lang: 'en' })
  assert.equal(GIPHY_ATTRIBUTION, 'Powered by GIPHY')
  assert.equal(GIPHY_DISCLOSURE, 'Searching sends your query to Giphy.')
})
