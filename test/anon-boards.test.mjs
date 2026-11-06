import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFile } from 'node:fs/promises'
import { planOps } from '../src/lib/plan.js'
import { validateOp } from '../src/lib/validate.js'
import { viewerItem, anonModeOf, ANON_NAME, ANON_BOARD_TYPES } from '../src/lib/anon.js'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: AnonCheck } = await import('../src/ui/AnonCheck.jsx')

const val = (o) => { const r = validateOp(o); assert.ok(r.ok, r.error); return r.op }
const board = (type, over = {}) => ({ code: 'ABC234', type, status: 'open', locked: false, lastTs: 0, ...over })
const guest = { uid: 'uid-real-guest', name: 'Maria Santos', avatar: { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }, isOwner: false }
const owner = { uid: 'uid-owner', name: 'Olive Owner', avatar: null, isOwner: true }
const card = (id, extra = {}, data = {}) => val({ op: 'add', id, item: { id, kind: 'card', x: 0, y: 0, w: 300, h: 200, data: { message: 'Happy birthday!', signer: 'Maria Santos', color: 'pink', ...data }, ...extra } })
const shout = (id, extra = {}) => val({ op: 'add', id, item: { id, kind: 'shoutout', x: 0, y: 0, w: 300, h: 200, data: { toName: 'Sam', message: 'Thanks for the help', badge: 'Teamwork' }, ...extra } })
const note = (id, extra = {}) => val({ op: 'add', id, item: { id, kind: 'note', x: 0, y: 0, w: 200, h: 200, data: { text: id }, ...extra } })
const run = (b, op, actor = guest) => planOps(b, new Map(), [op], actor, 100)

describe('anonymous posting beyond retro boards', () => {
  test('every board where people post offers it, the prize wheel does not', () => {
    assert.deepEqual([...ANON_BOARD_TYPES].sort(), ['celebration', 'retro', 'wall', 'workshop'])
    for (const t of ANON_BOARD_TYPES) assert.equal(anonModeOf({ type: t }), 'optional', t)
    assert.equal(anonModeOf({ type: 'event' }), 'never')
  })

  test('workshop canvas: an anonymous note is stored, shown without its author, and the owner is hidden from too', () => {
    const r = run(board('workshop'), note('n1', { anon: true }))
    assert.equal(r.applied[0].anon, true)
    assert.equal(r.applied[0].authorUid, guest.uid, 'the store keeps the author for edit rights')
    const seen = viewerItem(r.applied[0], { viewerId: null })
    assert.equal(seen.authorName, ANON_NAME)
    assert.ok(!JSON.stringify(seen).includes('Maria') && !JSON.stringify(seen).includes(guest.uid))
  })

  test('celebration board: an anonymous card is signed Anonymous even when a name was typed, and is stored as anonymous', () => {
    const r = run(board('celebration'), card('c1', { anon: true }))
    assert.equal(r.rejected.length, 0)
    assert.equal(r.applied[0].anon, true)
    assert.equal(r.applied[0].data.signer, ANON_NAME, 'the typed name is replaced')
    assert.equal(r.applied[0].data.message, 'Happy birthday!')
    const seen = JSON.stringify(viewerItem(r.applied[0], { viewerId: null }))
    assert.ok(!seen.includes('Maria Santos') && !seen.includes(guest.uid))
  })

  test('an ordinary card keeps the signer that was typed', () => {
    const r = run(board('celebration'), card('c2'))
    assert.equal(r.applied[0].data.signer, 'Maria Santos')
    assert.ok(!('anon' in r.applied[0]))
  })

  test('an edit cannot put a name on an anonymous card', () => {
    const stored = run(board('celebration'), card('c3', { anon: true })).applied[0]
    const edit = planOps(board('celebration'), new Map([['c3', stored]]), [val({ op: 'update', id: 'c3', patch: { data: { signer: 'Maria Santos', message: 'Edited words' } } })], guest, 200)
    assert.equal(edit.applied[0].data.message, 'Edited words')
    assert.equal(edit.applied[0].data.signer, ANON_NAME)
    assert.equal(edit.applied[0].anon, true)
  })

  test('team wall: an anonymous shout-out hides who gave it; a normal one names them', () => {
    const anon = run(board('wall'), shout('s1', { anon: true }))
    assert.equal(anon.applied[0].anon, true)
    const seen = viewerItem(anon.applied[0], { viewerId: null })
    assert.equal(seen.authorName, ANON_NAME)
    assert.equal(seen.data.toName, 'Sam', 'who it is for stays')
    assert.ok(!JSON.stringify(seen).includes('Maria') && !JSON.stringify(seen).includes(guest.uid))
    const plain = run(board('wall'), shout('s2'))
    assert.ok(!('anon' in plain.applied[0]))
    assert.equal(plain.applied[0].authorName, 'Maria Santos')
  })

  test('"always" makes every participant post anonymous on all three boards, and leaves the owner their own choice', () => {
    const cases = [['workshop', note('a')], ['celebration', card('b')], ['wall', shout('c')]]
    for (const [type, op] of cases) {
      const b = board(type, { anonymousNotes: 'always' })
      assert.equal(run(b, op).applied[0].anon, true, `${type}: forced for a guest`)
      assert.ok(!('anon' in run(b, op, owner).applied[0]), `${type}: the owner follows their own choice`)
    }
  })

  test('"never" refuses an anonymous post on all three boards, and still takes a normal one', () => {
    const cases = [['workshop', note('a', { anon: true }), note('a2')], ['celebration', card('b', { anon: true }), card('b2')], ['wall', shout('c', { anon: true }), shout('c2')]]
    for (const [type, anonOp, plainOp] of cases) {
      const b = board(type, { anonymousNotes: 'never' })
      assert.equal(run(b, anonOp).rejected[0].error, 'Anonymous notes are off on this board', type)
      assert.equal(run(b, plainOp).applied.length, 1, type)
    }
  })

  test('under "always" everything that carries a person\'s words is anonymous on a workshop board, as on a retro board; frames and lines are not', () => {
    const b = board('workshop', { anonymousNotes: 'always' })
    const textBox = val({ op: 'add', id: 't1', item: { id: 't1', kind: 'text', x: 0, y: 0, w: 200, h: 50, data: { text: 'plain' } } })
    assert.equal(run(b, textBox).applied[0].anon, true)
    const frame = val({ op: 'add', id: 'f1', item: { id: 'f1', kind: 'frame', x: 0, y: 0, w: 300, h: 300, data: { title: 'Column' } } })
    assert.ok(!('anon' in run(b, frame).applied[0]))
  })
})

describe('the form control', () => {
  const html = (mode, on = false) => renderToStaticMarkup(createElement(AnonCheck, { mode, on, onChange() {} }))

  test('optional: a labelled checkbox that says what it does; checked when on', () => {
    const h = html('optional')
    assert.match(h, /<input[^>]*type="checkbox"/)
    assert.match(h, /Post anonymously/)
    assert.match(h, /hidden from everyone, including the owner/)
    assert.doesNotMatch(h, /checked/)
    assert.match(html('optional', true), /checked/)
    assert.match(h, /<label for="([^"]+)"[\s\S]*<input id="\1"/, 'the label points at the box')
  })

  test('always: a locked notice and no checkbox; never or unknown: nothing', () => {
    assert.match(html('always'), /role="status"[\s\S]*posted anonymously/)
    assert.doesNotMatch(html('always'), /<input/)
    assert.equal(html('never'), '')
    assert.equal(html(undefined), '')
  })
})

describe('wired into the screens', () => {
  const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

  test('the card form and the shout-out form both ask, and send anon: true only when it applies', async () => {
    const cardForm = await read('src/ui/CardComposer.jsx')
    assert.match(cardForm, /<AnonCheck mode=\{mode\} on=\{anon\} onChange=\{setAnon\} \/>/)
    assert.match(cardForm, /if \(anonNow\) op\.item\.anon = true/)
    assert.match(cardForm, /signer: signed/, 'an anonymous card is signed Anonymous')
    const shoutForm = await read('src/ui/ShoutoutComposer.jsx')
    assert.match(shoutForm, /<AnonCheck mode=\{mode\} on=\{anon\} onChange=\{setAnon\} \/>/)
    assert.match(shoutForm, /if \(anonNow\) op\.item\.anon = true/)
    assert.match(shoutForm, /authorName: anonNow \? ANON_NAME : ctl\.persona\?\.name/, 'the preview shows Anonymous when it is ticked')
  })

  test('the board settings offer the choice on every board where people post', async () => {
    const settings = await read('src/ui/BoardSettings.jsx')
    assert.match(settings, /ANON_BOARD_TYPES\.includes\(board\.type\) && <AnonymitySection/)
    assert.doesNotMatch(settings, /board\.type === 'retro' && <AnonymitySection/)
  })
})
