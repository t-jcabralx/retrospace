import test from 'node:test'
import assert from 'node:assert/strict'
import { KINDS, REACTIONS, BADGES, validateItem, validateOp, validateBoardInput } from '../src/lib/validate.js'
import { newUid } from '../src/lib/ids.js'

const base = (kind, data, extra = {}) => ({ id: 'i1', kind, x: 10, y: 20, data, ...extra })

const minimal = {
  note: { text: 'hi', color: 'yellow' },
  text: { text: 'hello' },
  shape: { shape: 'ellipse' },
  connector: { from: 'a', to: 'b' },
  frame: { title: 'Section' },
  image: { src: 'data:image/webp;base64,AAAA' },
  card: { message: 'Congrats!', signer: 'Sam', color: 'pink' },
  shoutout: { toName: 'Ana', message: 'Thanks', badge: 'Teamwork' },
  theme: { title: 'Pace', noteIds: [] },
  action: { action: 'Fix the flaky build' },
}

test('constants', () => {
  assert.deepEqual(REACTIONS, ['🎉', '❤️', '👏', '😂', '🙌', '🔥'])
  assert.deepEqual(BADGES, ['Teamwork', 'Above & Beyond', 'Innovation', 'Customer Hero', 'Thank You'])
  assert.deepEqual([...KINDS].sort(), Object.keys(minimal).sort())
})

test('validateItem accepts each kind minimal shape and fills defaults', () => {
  for (const kind of KINDS) {
    const r = validateItem(base(kind, minimal[kind]))
    assert.equal(r.ok, true, `${kind}: ${r.error}`)
    assert.equal(r.item.z, 0)
    assert.equal(r.item.rot, 0)
    assert.equal(r.item.w, 200)
    assert.equal(r.item.h, 200)
  }
})

test('validateItem rejects bad kind-specific shapes', () => {
  const bad = [
    ['note', {}], ['text', { text: 5 }], ['shape', { shape: 'star' }], ['connector', { from: 'a' }],
    ['frame', {}], ['image', {}], ['image', { src: 'javascript:alert(1)' }], ['card', { message: 'x' }],
    ['shoutout', { toName: 'a', message: 'b', badge: 'Nope' }],
  ]
  for (const [kind, data] of bad) assert.equal(validateItem(base(kind, data)).ok, false, kind)
})

test('validateItem rejects unknown kind, bad id, non-objects', () => {
  assert.equal(validateItem(base('sticker', {})).ok, false)
  assert.equal(validateItem({ ...base('text', { text: 'a' }), id: 'x'.repeat(41) }).ok, false)
  assert.equal(validateItem({ ...base('text', { text: 'a' }), id: '' }).ok, false)
  assert.equal(validateItem(null).ok, false)
  assert.equal(validateItem('x').ok, false)
  assert.equal(validateItem(base('text', 'nope')).ok, false)
  assert.equal(validateItem(base('text', { text: 'a' }, { x: 'far' })).ok, false)
  assert.equal(validateItem(base('text', { text: 'a' }, { x: NaN })).ok, false)
})

test('text limit is 2000 chars, applies to any data string but not urls', () => {
  assert.equal(validateItem(base('text', { text: 'a'.repeat(2000) })).ok, true)
  assert.equal(validateItem(base('text', { text: 'a'.repeat(2001) })).ok, false)
  assert.equal(validateItem(base('card', { ...minimal.card, signer: 'a'.repeat(2001) })).ok, false)
  const gif = 'https://media.tenor.com/' + 'a'.repeat(2500)
  assert.equal(validateItem(base('card', { ...minimal.card, gif })).ok, true)
})

test('data over 8 KB is rejected', () => {
  const data = { text: 'ok', a: 'x'.repeat(2000), b: 'x'.repeat(2000), c: 'x'.repeat(2000), d: 'x'.repeat(2000), e: 'x'.repeat(1000) }
  assert.equal(validateItem(base('text', data)).ok, false)
})

test('image src is capped at 400 KB (card photo 200 KB) and does not count toward the 8 KB data cap', () => {
  const pre = 'data:image/webp;base64,'
  const fits = pre + 'A'.repeat(400 * 1024 - pre.length)
  assert.equal(validateItem(base('image', { src: fits })).ok, true)
  assert.equal(validateItem(base('image', { src: fits + 'A' })).ok, false)
  const photo = pre + 'A'.repeat(200 * 1024 - pre.length)
  assert.equal(validateItem(base('card', { ...minimal.card, image: photo })).ok, true)
  assert.equal(validateItem(base('card', { ...minimal.card, image: photo + 'A' })).ok, false)
})

test('numbers are clamped and unknown top-level keys stripped', () => {
  const r = validateItem(base('text', { text: 'a' }, { x: 1e9, y: -1e9, w: 1, h: 99999, z: 3, rot: 45, authorUid: 'evil', votes: ['x'] }))
  assert.equal(r.ok, true)
  assert.equal(r.item.x, 100000)
  assert.equal(r.item.y, -100000)
  assert.equal(r.item.w, 20)
  assert.equal(r.item.h, 4000)
  assert.equal(r.item.z, 3)
  assert.equal(r.item.rot, 45)
  assert.deepEqual(Object.keys(r.item).sort(), ['data', 'h', 'id', 'kind', 'rot', 'w', 'x', 'y', 'z'])
})

test('validateOp add/update/delete/vote/react', () => {
  const item = base('note', minimal.note)
  const add = validateOp({ op: 'add', item })
  assert.equal(add.ok, true)
  assert.equal(add.op.id, 'i1')
  assert.equal(validateOp({ op: 'add', item: { ...item, kind: 'nope' } }).ok, false)
  assert.equal(validateOp({ op: 'add' }).ok, false)

  assert.equal(validateOp({ op: 'update', patch: { x: 5 } }).ok, false)
  assert.equal(validateOp({ op: 'update', id: 'i1' }).ok, false)
  const upd = validateOp({ op: 'update', id: 'i1', patch: { x: 1e9, evil: 1, data: { text: 'new' } } })
  assert.equal(upd.ok, true)
  assert.deepEqual(upd.op.patch, { x: 100000, data: { text: 'new' } })
  assert.equal(validateOp({ op: 'update', id: 'i1', patch: { data: { text: 'a'.repeat(2001) } } }).ok, false)
  assert.equal(validateOp({ op: 'update', id: 'i1', patch: { w: 'wide' } }).ok, false)

  assert.deepEqual(validateOp({ op: 'delete', id: 'i1' }), { ok: true, op: { op: 'delete', id: 'i1' } })
  assert.equal(validateOp({ op: 'delete' }).ok, false)
  assert.equal(validateOp({ op: 'vote', id: 'i1' }).ok, true)
  assert.equal(validateOp({ op: 'vote' }).ok, false)

  assert.equal(validateOp({ op: 'react', id: 'i1', emoji: '🎉' }).ok, true)
  assert.equal(validateOp({ op: 'react', id: 'i1', emoji: '💩' }).ok, false)
  assert.equal(validateOp({ op: 'react', id: 'i1' }).ok, false)
  assert.equal(validateOp({ op: 'explode', id: 'i1' }).ok, false)
  assert.equal(validateOp(null).ok, false)
})

test('validateBoardInput', () => {
  const ok = validateBoardInput({ type: 'celebration', template: 'birthday', title: '  Sam is 30  ', recipient: { name: 'Sam' } })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.board, { type: 'celebration', template: 'birthday', title: 'Sam is 30', recipient: { name: 'Sam' } })

  const noRecipient = validateBoardInput({ type: 'workshop', template: 'retro', title: 'Sprint 9' })
  assert.equal(noRecipient.ok, true)
  assert.equal(noRecipient.board.recipient, null)

  // who the owner is comes from the session, never the body: a uid or name sent anyway is dropped
  const sneaky = validateBoardInput({ type: 'workshop', template: 'retro', title: 'x', uid: newUid(), name: 'Mallory', ownerId: 'u_1' })
  assert.deepEqual(Object.keys(sneaky.board).sort(), ['recipient', 'template', 'title', 'type'])

  // retro boards are not for anyone: a recipient is ignored, even a malformed one
  const retro = validateBoardInput({ type: 'retro', template: 'retro-wwci', title: 'Sprint 9', recipient: { name: 'Sam' } })
  assert.deepEqual(retro.board, { type: 'retro', template: 'retro-wwci', title: 'Sprint 9', recipient: null })
  assert.equal(validateBoardInput({ type: 'retro', template: 'retro-ssc', title: 'x', recipient: 12 }).board.recipient, null)
  assert.equal(validateBoardInput({ type: 'retro', template: 'retro', title: 'x' }).ok, false, 'a workshop template key does not work under retro')
  assert.equal(validateBoardInput({ type: 'workshop', template: 'retro-ssc', title: 'x' }).ok, false)

  const bad = [
    { type: 'nope', template: 'retro', title: 'x' },
    { type: 'workshop', template: 'birthday', title: 'x' },
    { type: 'workshop', template: 'retro', title: 'x'.repeat(81) },
    { type: 'workshop', template: 'retro', title: '' },
    { type: 'workshop', template: '__proto__', title: 'x' },
    null,
  ]
  for (const b of bad) assert.equal(validateBoardInput(b).ok, false, JSON.stringify(b))
})

test('large URL fields are kind-specific', () => {
  const pre = 'data:image/webp;base64,'
  const big = pre + 'A'.repeat(400 * 1024 - pre.length)
  const mid = pre + 'A'.repeat(150 * 1024)
  assert.equal(validateItem(base('note', { ...minimal.note, src: big })).ok, false)
  assert.equal(validateItem(base('note', { ...minimal.note, src: 'https://x.test/a.png' })).ok, false)
  assert.equal(validateItem(base('text', { text: 'a', gif: big })).ok, false)
  assert.equal(validateItem(base('text', { text: 'a', src: big, gif: big, image: big })).ok, false)
  assert.equal(validateItem(base('shoutout', { ...minimal.shoutout, image: mid })).ok, false)
  assert.equal(validateItem(base('image', { src: mid })).ok, true)
  assert.equal(validateItem(base('image', { src: big + 'A' })).ok, false)
  assert.equal(validateItem(base('image', { src: mid, gif: 'https://x.test/a.gif' })).ok, false)
  assert.equal(validateItem(base('card', { ...minimal.card, image: mid })).ok, true)
  assert.equal(validateItem(base('shoutout', { ...minimal.shoutout, gif: 'https://media.giphy.com/a.gif' })).ok, true)
})

test('card/shoutout gif and image must be http(s) or data:image urls', () => {
  assert.equal(validateItem(base('card', { ...minimal.card, gif: 'javascript:alert(1)' })).ok, false)
  assert.equal(validateItem(base('card', { ...minimal.card, image: 'data:text/html;base64,AAAA' })).ok, false)
  assert.equal(validateItem(base('shoutout', { ...minimal.shoutout, gif: 'javascript:alert(1)' })).ok, false)
})

test('the 400 KB cap is measured in bytes', () => {
  const multi = 'https://x.test/' + 'é'.repeat(250 * 1024) // ~250K chars, ~500K bytes
  assert.equal(validateItem(base('image', { src: multi })).ok, false)
})

test('validateItem does not return the caller data object', () => {
  const data = { text: 'a' }
  const r = validateItem(base('text', data))
  assert.notEqual(r.item.data, data)
  assert.deepEqual(r.item.data, data)
})

test('update patch: large fields capped per key (src 400 KB), rest of data at 8 KB', () => {
  const pre = 'data:image/webp;base64,'
  const big = pre + 'A'.repeat(400 * 1024 - pre.length)
  assert.equal(validateOp({ op: 'update', id: 'i1', patch: { data: { src: big + 'A' } } }).ok, false)
  assert.equal(validateOp({ op: 'update', id: 'i1', patch: { data: { src: big } } }).ok, true)
  const wide = { a: 'x'.repeat(2000), b: 'x'.repeat(2000), c: 'x'.repeat(2000), d: 'x'.repeat(2000), e: 'x'.repeat(1000) }
  assert.equal(validateOp({ op: 'update', id: 'i1', patch: { data: { src: big, ...wide } } }).ok, false)
})

test('validateTitle trims, strips control characters and enforces 80 chars', async () => {
  const { validateTitle } = await import('../src/lib/validate.js')
  assert.deepEqual(validateTitle('  Sprint\n\tretro  '), { ok: true, value: 'Sprint retro' })
  assert.equal(validateTitle('x'.repeat(80)).ok, true)
  assert.deepEqual(validateTitle('x'.repeat(81)), { ok: false, error: 'title exceeds 80 chars' })
  for (const bad of [undefined, null, 42, {}, '', ' \n\t ']) assert.equal(validateTitle(bad).ok, false)
})

test('validateRecipient allows null, cleans the name and enforces 60 chars', async () => {
  const { validateRecipient } = await import('../src/lib/validate.js')
  assert.deepEqual(validateRecipient(null), { ok: true, value: null })
  assert.deepEqual(validateRecipient(undefined), { ok: true, value: null })
  assert.deepEqual(validateRecipient({ name: ' Sam\u0000 Lee ' }), { ok: true, value: { name: 'Sam Lee' } })
  assert.equal(validateRecipient({ name: 'x'.repeat(60) }).ok, true)
  assert.deepEqual(validateRecipient({ name: 'x'.repeat(61) }), { ok: false, error: 'invalid recipient' })
  for (const bad of [{}, { name: 5 }, { name: '  ' }, 'Sam', ['Sam'], 0]) assert.equal(validateRecipient(bad).ok, false)
})

test('validateBoardInput uses the shared title and recipient rules', () => {
  const input = { type: 'wall', template: 'team', title: 'x'.repeat(81) }
  assert.equal(validateBoardInput(input).error, 'title exceeds 80 chars')
  assert.equal(validateBoardInput({ ...input, title: 'ok', recipient: { name: '' } }).error, 'invalid recipient')
  assert.deepEqual(validateBoardInput({ ...input, title: ' ok\n', recipient: { name: ' Sam ' } }).board.recipient, { name: 'Sam' })
})

test('card message is 1-500 chars, signer 1-40, color one of the six note colors', async () => {
  const { checkCardText, MAX_CARD_MESSAGE, MAX_SIGNER } = await import('../src/lib/validate.js')
  const card = (over) => validateItem(base('card', { ...minimal.card, ...over }))
  assert.equal(card({ message: 'a'.repeat(MAX_CARD_MESSAGE) }).ok, true)
  assert.equal(card({ message: 'a'.repeat(MAX_CARD_MESSAGE + 1) }).ok, false)
  assert.equal(card({ message: '' }).ok, false)
  assert.equal(card({ message: '   \n ' }).ok, false)
  assert.equal(card({ message: 'two\nlines' }).ok, true)
  assert.equal(card({ signer: 's'.repeat(MAX_SIGNER) }).ok, true)
  assert.equal(card({ signer: 's'.repeat(MAX_SIGNER + 1) }).ok, false)
  assert.equal(card({ signer: '' }).ok, false)
  assert.equal(card({ signer: '  ' }).ok, false)
  assert.equal(card({ signer: 'Sam\nEvil' }).ok, false)
  for (const color of ['yellow', 'pink', 'green', 'blue', 'purple', 'orange']) assert.equal(card({ color }).ok, true, color)
  assert.equal(card({ color: 'red' }).ok, false)
  assert.equal(card({ color: 'url(javascript:1)' }).ok, false)
  assert.equal(checkCardText('hi', 'Sam') && Object.keys(checkCardText('hi', 'Sam')).length, 0)
  assert.match(checkCardText('', 'Sam').message, /message/i)
  assert.match(checkCardText('hi', '').signer, /name/i)
  assert.match(checkCardText('a'.repeat(501), 'Sam').message, /500/)
  assert.match(checkCardText('hi', 'x'.repeat(41)).signer, /40/)
})

test('card media size hints are optional finite numbers in 1..4000', () => {
  const card = (over) => validateItem(base('card', { ...minimal.card, gif: 'https://media.giphy.com/a.gif', ...over }))
  assert.equal(card({ mediaW: 480, mediaH: 270 }).ok, true)
  assert.equal(card({ mediaW: 0, mediaH: 270 }).ok, false)
  assert.equal(card({ mediaW: 480, mediaH: 5000 }).ok, false)
  assert.equal(card({ mediaW: '480', mediaH: 270 }).ok, false)
  assert.equal(card({ mediaW: Infinity, mediaH: 270 }).ok, false)
})

test('an update that blanks a card message is refused on the merged item', async () => {
  const { planOps } = await import('../src/lib/plan.js')
  const stored = validateItem(base('card', minimal.card)).item
  const items = new Map([[stored.id, { ...stored, authorUid: 'u1', deleted: false, votes: [], reactions: {} }]])
  const actor = { uid: 'u1', name: 'A', isOwner: false }
  const bad = planOps({ code: 'ABCDEF' }, items, [{ op: 'update', id: stored.id, patch: { data: { message: '' } } }], actor, 1)
  assert.equal(bad.applied.length, 0)
  assert.equal(bad.rejected.length, 1)
  const good = planOps({ code: 'ABCDEF' }, items, [{ op: 'update', id: stored.id, patch: { data: { message: 'Edited' } } }], actor, 1)
  assert.equal(good.applied[0].data.message, 'Edited')
})

test('card and shoutout gif must be https: http, data: and javascript: are refused (card.image keeps data:image and http)', () => {
  const card = (data) => validateItem(base('card', { ...minimal.card, ...data })).ok
  assert.equal(card({ gif: 'https://media.giphy.com/a.gif' }), true)
  assert.equal(card({ gif: 'HTTPS://media.giphy.com/a.gif' }), true)
  assert.equal(card({ gif: 'http://media.giphy.com/a.gif' }), false)
  assert.equal(card({ gif: 'javascript:alert(1)' }), false)
  assert.equal(card({ gif: 'data:image/gif;base64,AAAA' }), false)
  assert.equal(card({ gif: '//media.giphy.com/a.gif' }), false)
  assert.equal(card({ image: 'data:image/webp;base64,AAAA' }), true)
  assert.equal(card({ image: 'https://x.test/a.png' }), true)
  assert.equal(validateItem(base('shoutout', { ...minimal.shoutout, gif: 'http://x.test/a.gif' })).ok, false)
  assert.equal(validateItem(base('shoutout', { ...minimal.shoutout, gif: 'javascript:alert(1)' })).ok, false)
  // an update patch is checked the same way once merged with the stored item
  assert.equal(validateOp({ op: 'update', id: 'i1', patch: { data: { gif: 'http://x.test/a.gif' } } }).ok, false)
})
