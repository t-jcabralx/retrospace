import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { shouldApply, createSync } = await import('../src/client/sync.js')
const { reducer: reduce, initialState } = await import('../src/client/state.js')
const { exportBounds, exportScale, exportFilename, PLACEHOLDER, EXPORT_MAX_SIDE } = await import('../src/ui/exportPng.js')
const { removeError, removeParticipantRequest, listParticipantsRequest } = await import('../src/ui/ownerToolsApi.js')
const { default: ExportMenu, csvHref } = await import('../src/ui/ExportMenu.jsx')
const { default: PeopleSection } = await import('../src/ui/settings/PeopleSection.jsx')

const ME = 'KM-AAAA-BBBB-CCCC'
const PEER = 'KM-DDDD-EEEE-FFFF'
const OWNER = 'KM-OOOO-OOOO-OOOO'
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)) }

describe('kicked envelope (client)', () => {
  test('shouldApply accepts a kicked envelope with an id from someone else, and nothing else', () => {
    assert.equal(shouldApply({ t: 'kicked', from: OWNER, id: PEER }, { uid: ME, cid: 'c1' }), true)
    assert.equal(shouldApply({ t: 'kicked', from: OWNER }, { uid: ME, cid: 'c1' }), false)
    assert.equal(shouldApply({ t: 'kicked', from: OWNER, id: '' }, { uid: ME, cid: 'c1' }), false)
    assert.equal(shouldApply({ t: 'kicked', from: OWNER, id: 5 }, { uid: ME, cid: 'c1' }), false)
    assert.equal(shouldApply({ t: 'kicked', id: PEER }, { uid: ME, cid: 'c1' }), false, 'no sender')
  })

  class ES {
    static last
    constructor() { this.l = {}; this.closed = false; ES.last = this }
    addEventListener(t, f) { (this.l[t] ||= []).push(f) }
    close() { this.closed = true; this.readyState = 2 }
    emit(t, ev = {}) { for (const f of this.l[t] || []) f(ev) }
  }
  const timers = { setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} }
  const fetchImpl = async (url) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (url === '/api/rt/join') return ok({ tok: 't', live: true })
    return ok({ items: [], now: 1 })
  }

  test('a kicked envelope naming ME stops the sync and reports a 403 "removed" denial; naming someone else just reports them', async () => {
    const kicked = [], denied = [], statuses = []
    const sync = createSync({ code: 'ABC234', identity: { uid: ME }, fetchImpl, EventSourceImpl: ES, timers, onKicked: (id) => kicked.push(id), onDenied: (s, m) => denied.push([s, m]), onStatus: (s) => statuses.push(s) })
    await settle()
    const es = ES.last
    es.readyState = 1
    es.emit('open')
    es.emit('message', { data: JSON.stringify({ t: 'kicked', from: OWNER, id: PEER }) })
    assert.deepEqual([kicked, denied, es.closed], [[PEER], [], false])
    es.emit('message', { data: JSON.stringify({ t: 'kicked', from: OWNER, id: ME }) })
    assert.deepEqual(denied, [[403, 'You were removed from this board']])
    assert.equal(es.closed, true)
    assert.equal(sync.status(), 'denied')
    assert.deepEqual(kicked, [PEER], 'my own removal is not announced as someone else\'s')
    sync.close()
  })
})

describe('state: forget-participant', () => {
  test('drops one participant from the people list and leaves the rest', () => {
    const snap = { board: { code: 'ABC234' }, items: [], people: [], participants: [{ uid: ME, name: 'Me' }, { uid: PEER, name: 'Pat' }], viewer: { uid: ME, role: 'guest' } }
    const s = reduce(initialState(snap), { type: 'forget-participant', uid: PEER })
    assert.deepEqual(s.participants.map((p) => p.uid), [ME])
  })
})

describe('exportPng helpers', () => {
  const box = (id, x, y, w, h, extra = {}) => ({ id, kind: 'note', x, y, w, h, ...extra })

  test('bounds: live non-connector items plus 48 px, whole numbers, deleted/connectors ignored, null when empty', () => {
    assert.equal(exportBounds([]), null)
    assert.equal(exportBounds(undefined), null)
    assert.equal(exportBounds([box('d', 0, 0, 10, 10, { deleted: true }), { id: 'c', kind: 'connector', x: 0, y: 0, w: 9999, h: 9999 }]), null)
    assert.deepEqual(exportBounds([box('a', 100, 200, 50, 60), box('b', 400.4, 100, 100, 100)]), { x: 52, y: 52, w: 497, h: 256 })
    assert.deepEqual(exportBounds([box('a', 0, 0, 10, 10)], 0), { x: 0, y: 0, w: 10, h: 10 })
    assert.deepEqual(exportBounds([box('n', -300, -50, 20, 20), box('bad', NaN, 0, 5, 5), null]), { x: -348, y: -98, w: 116, h: 116 })
  })

  test('bounds grow for a rotated item', () => {
    const plain = exportBounds([box('a', 0, 0, 100, 100)], 0)
    const turned = exportBounds([box('a', 0, 0, 100, 100, { rot: 45 })], 0)
    assert.ok(turned.w > plain.w && turned.h > plain.h)
    assert.ok(turned.w <= 143 && turned.w >= 141)
  })

  test('scale: 2x, capped so the long side never passes 4096 px', () => {
    assert.equal(exportScale(500, 300), 2)
    assert.equal(exportScale(2048, 100), 2)
    assert.equal(exportScale(4096, 100), 1)
    const s = exportScale(8000, 3000)
    assert.ok(Math.round(8000 * s) <= EXPORT_MAX_SIDE && s < 1)
    assert.ok(Math.round(100 * exportScale(100, 20000)) >= 1 && Math.round(20000 * exportScale(100, 20000)) <= EXPORT_MAX_SIDE)
    assert.equal(exportScale(0, 0), 2)
  })

  test('filename: sanitised title, local date, never empty', () => {
    const d = new Date(2026, 9, 29, 23, 59)
    assert.equal(exportFilename('Sprint 12 retro!', d), 'Sprint-12-retro-2026-10-29.png')
    assert.equal(exportFilename('../../etc/passwd', d), 'etcpasswd-2026-10-29.png')
    assert.equal(exportFilename('a/b\\c:d*e?"<>|', d), 'abcde-2026-10-29.png')
    assert.equal(exportFilename('Café 日本', d), 'Café-日本-2026-10-29.png')
    assert.equal(exportFilename('', d), 'board-2026-10-29.png')
    assert.equal(exportFilename(undefined, d), 'board-2026-10-29.png')
    assert.equal(exportFilename('!!!', d), 'board-2026-10-29.png')
    assert.ok(exportFilename('x'.repeat(300), d).length <= 60 + '-2026-10-29.png'.length)
  })

  test('the placeholder is a self-contained image', () => {
    assert.match(PLACEHOLDER, /^data:image\/svg\+xml,/)
    assert.ok(!/href|<script/i.test(decodeURIComponent(PLACEHOLDER)))
  })
})

describe('ownerToolsApi', () => {
  test('errors are fit to show', () => {
    assert.match(removeError(0), /Could not reach/)
    assert.match(removeError(401), /Sign in/)
    assert.match(removeError(403), /owner/)
    assert.match(removeError(404), /no longer/)
    assert.match(removeError(429), /Too many/)
    assert.equal(removeError(409, 'Too many people have been removed from this board'), 'Too many people have been removed from this board')
    assert.match(removeError(500), /500/)
  })

  test('remove builds a DELETE with the encoded id and items flag; never throws', async () => {
    const seen = []
    const f = async (url, init) => { seen.push([url, init.method]); return { ok: true, status: 200, json: async () => ({ removed: true, itemsDeleted: 2, changed: [] }) } }
    const r = await removeParticipantRequest('ABC234', 'KM-AAAA-AAAA-AAAA', { deleteItems: true }, f)
    assert.deepEqual(seen, [['/api/boards/ABC234/participants/KM-AAAA-AAAA-AAAA?items=1', 'DELETE']])
    assert.equal(r.ok, true)
    await removeParticipantRequest('ABC234', 'a/b', {}, f)
    assert.equal(seen[1][0], '/api/boards/ABC234/participants/a%2Fb?items=0')
    const bad = await removeParticipantRequest('ABC234', 'x', {}, async () => ({ ok: false, status: 403, json: async () => ({ error: 'Not the owner' }) }))
    assert.deepEqual([bad.ok, bad.status], [false, 403])
    const down = await removeParticipantRequest('ABC234', 'x', {}, async () => { throw new Error('offline') })
    assert.deepEqual([down.ok, down.status], [false, 0])
    assert.deepEqual(await listParticipantsRequest('ABC234', async () => ({ ok: true, status: 200, json: async () => ({ participants: [{ uid: 'a' }] }) })), { ok: true, participants: [{ uid: 'a' }] })
    assert.deepEqual(await listParticipantsRequest('ABC234', async () => { throw new Error('x') }), { ok: false, status: 0 })
    assert.equal((await listParticipantsRequest('ABC234', async () => ({ ok: true, status: 200, json: async () => ({}) }))).ok, false)
  })
})

describe('ExportMenu / PeopleSection markup', () => {
  const ctl = (extra = {}) => ({ code: 'ABC234', isOwner: false, items: [], notify() {}, ...extra })

  test('the closed menu is one button; csv link carries the authors flag only when asked', () => {
    const html = renderToStaticMarkup(createElement(ExportMenu, { ctl: ctl(), title: 'T' }))
    assert.match(html, /aria-haspopup="menu"/)
    assert.match(html, /aria-expanded="false"/)
    assert.doesNotMatch(html, /role="menu"/)
    assert.equal(csvHref('ABC234', false), '/api/boards/ABC234/export?format=csv')
    assert.equal(csvHref('ABC234', true), '/api/boards/ABC234/export?format=csv&authors=1')
  })

  test('PeopleSection lists everyone but me, owner row without a Remove button, counts notes', () => {
    const state = { participants: [{ uid: OWNER, name: 'Dana', kind: 'account', avatar: { bg: 1, body: 1, eyes: 1, mouth: 1, extra: 1 } }, { uid: PEER, name: 'Pat', kind: 'custom', avatar: { bg: 1, body: 1, eyes: 1, mouth: 1, extra: 1 } }, { uid: 'KM-ZZZZ-ZZZZ-ZZZZ', name: 'Zed', kind: 'anonymous', avatar: { bg: 2, body: 2, eyes: 2, mouth: 2, extra: 2 } }] }
    const html = renderToStaticMarkup(createElement(PeopleSection, { ctl: ctl({ uid: ME, state, items: [{ id: 'i', authorUid: PEER }, { id: 'j', authorUid: PEER }, { id: 'k', authorUid: 'KM-ZZZZ-ZZZZ-ZZZZ' }, { id: 'd', authorUid: PEER, deleted: true }], participantRemoved() {} }) }))
    assert.match(html, /Pat/)
    assert.match(html, /2 notes/)
    assert.match(html, /1 note</)
    assert.match(html, /aria-label="Remove Pat"/)
    assert.match(html, /aria-label="Remove Zed"/)
    assert.doesNotMatch(html, /aria-label="Remove Dana"/)
    assert.match(html, /role="status"/)
    assert.match(html, /role="alert"/)
  })
})
