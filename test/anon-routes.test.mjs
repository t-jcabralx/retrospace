import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { addOps, ann, bob, board, call, fakeUpstash, getStore, makeBoard, opsRoute, patch, personaRoute, published, sinceRoute, snapshot, signUp, note } from './helpers/summary-harness.mjs'
import { buildSummaryInput } from '../src/lib/ai/input.js'
import { buildThemeInput } from '../src/lib/ai/themes.js'
import { buildPrintModel } from '../src/lib/printModel.js'
import { boardCsv } from '../src/lib/csv.js'

process.env.RT_SECRET = 'anon-test-secret' // a fake Redis token must not change what signs the guest cookies

const { GET: exportRoute } = await import('../src/app/api/boards/[code]/export/route.js')
const { POST: resetRoute } = await import('../src/app/api/boards/[code]/votes/reset/route.js')
const { DELETE: kickRoute } = await import('../src/app/api/boards/[code]/participants/[id]/route.js')

const AV = { bg: 3, body: 4, eyes: 5, mouth: 6, extra: 7 }
const ops = (code, cookie, ...o) => call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie, body: { ops: o } })
const anonNote = (id, text = id, extra = {}) => ({ op: 'add', item: { id, kind: 'note', x: 0, y: 200, w: 200, h: 200, data: { text }, anon: true, ...extra } })

// A person on the board with a persona name that can be searched for in raw bytes.
async function person(code, name) {
  const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code })
  const cookie = snap.setCookies.find((c) => c.startsWith('rs_g=')).split(';')[0]
  assert.equal((await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie, body: { persona: { kind: 'custom', name, avatar: AV } } })).status, 200)
  return { cookie, name, uid: (await snapshot(code, cookie)).data.viewer.uid }
}
const ownerId = async (code) => (await snapshot(code, ann.cookie)).data.viewer.uid

async function setup(mode) {
  const code = await makeBoard(ann)
  if (mode) assert.equal((await patch(code, { anonymousNotes: mode }, ann.cookie)).status, 200)
  assert.equal((await patch(code, { retro: { type: 'goto', index: 1 } }, ann.cookie)).status, 200)
  return { code, a: await person(code, 'Zorblax Quillfeather'), b: await person(code, 'Mimsy Wobblethorpe') }
}

// The raw bytes of a response/envelope must hold none of the real author's identity.
function assertNoAuthor(raw, who, label) {
  for (const s of [who.uid, who.name, '"authorAvatar":{', '"bg":3']) assert.ok(!raw.includes(s), `${label}: leaked ${s}`)
}

describe('anonymous notes: every transport, byte level', () => {
  test('snapshot and /since: author, others and owner never see the author; only the author gets mine', async () => {
    const { code, a, b } = await setup()
    await addOps(code, a.cookie, anonNote('an', 'anon text'), note('pn', 300, 200, 'plain text'))
    const views = { author: a.cookie, other: b.cookie, owner: ann.cookie }
    for (const [who, cookie] of Object.entries(views)) {
      for (const [name, r] of [['snapshot', await snapshot(code, cookie)], ['since', await call(sinceRoute, 'GET', `/api/boards/${code}/since?t=0`, { code, cookie })]]) {
        const label = `${name}/${who}`
        const items = r.data.items
        const an = items.find((i) => i.id === 'an')
        const pn = items.find((i) => i.id === 'pn')
        const raw = JSON.stringify(an)
        assertNoAuthor(raw, a, label)
        assert.deepEqual([an.authorUid, an.authorName, an.authorAvatar, an.anon, an.data.text], ['anon', 'Anonymous', null, true, 'anon text'], label)
        assert.equal(an.mine === true, who === 'author', `${label}: mine`)
        if (who !== 'author') assert.ok(!('mine' in an), label)
        assert.equal(pn.authorUid, a.uid, `${label}: plain notes keep their author`)
        assert.ok(!('mine' in pn) && !('anon' in pn))
      }
    }
    assert.equal(JSON.stringify((await snapshot(code, ann.cookie)).data).includes(a.uid), true, 'the plain note and the participant list still name a (control)')
  })

  test('ops response and the published envelope, for add, edit, react, vote and delete', async () => {
    const { code, a, b } = await setup()
    await fakeUpstash(async (cmds) => {
      const add = await ops(code, a.cookie, anonNote('an', 'v1'))
      assert.equal(add.data.applied[0].mine, true)
      assertNoAuthor(add.text.replace(/"mine":true/, ''), a, 'add response (author)')
      const edit = await ops(code, a.cookie, { op: 'update', id: 'an', patch: { data: { text: 'v2' } } })
      assert.equal(edit.data.applied[0].anon, true)
      assert.equal(edit.data.applied[0].data.text, 'v2')
      const react = await ops(code, b.cookie, { op: 'react', id: 'an', emoji: '🎉' })
      assert.ok(!('mine' in react.data.applied[0]))
      assertNoAuthor(react.text, a, 'react response (other)')
      const own = await ops(code, ann.cookie, { op: 'update', id: 'an', patch: { x: 5 } })
      assert.equal(own.status, 200)
      assertNoAuthor(own.text, a, 'owner edit response')
      assert.ok(!('mine' in own.data.applied[0]), 'the owner is not the author')
      const del = await ops(code, a.cookie, { op: 'delete', id: 'an' })
      assert.equal(del.data.applied[0].deleted, true)
      assertNoAuthor(del.text, a, 'delete response')
      const envs = published(cmds).filter((e) => e.t === 'ops')
      assert.equal(envs.length, 5)
      for (const env of envs) {
        const raw = JSON.stringify(env)
        assertNoAuthor(raw, a, 'envelope')
        for (const s of ['"mine"', '"cid"']) assert.ok(!raw.includes(s), `envelope: ${s}`)
        assert.equal(env.from, 'anon')
      }
    })
  })

  test('envelopes of notes that are not anonymous are unchanged', async () => {
    const { code, a } = await setup()
    await fakeUpstash(async (cmds) => {
      assert.equal((await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: a.cookie, body: { cid: 'tab1abcd', ops: [note('pn', 0, 200, 'plain')] } })).status, 200)
      const [env] = published(cmds).filter((e) => e.t === 'ops')
      assert.equal(env.from, a.uid)
      assert.equal(env.cid, 'tab1abcd')
      assert.equal(env.ops[0].authorUid, a.uid)
    })
  })

  test('vote reset envelope and response; participant removal keeps anonymous notes and scrubs everything', async () => {
    const { code, a, b } = await setup()
    await addOps(code, a.cookie, anonNote('an'), note('pn', 300, 200, 'plain'))
    assert.equal((await patch(code, { retro: { type: 'goto', index: 3 } }, ann.cookie)).status, 200) // votes open in the Vote stage
    assert.equal((await patch(code, { vote: { active: true, perPerson: 3 } }, ann.cookie)).status, 200)
    await addOps(code, b.cookie, { op: 'vote', id: 'an' }, { op: 'vote', id: 'pn' })
    await fakeUpstash(async (cmds) => {
      const r = await call(resetRoute, 'POST', `/api/boards/${code}/votes/reset`, { code, cookie: ann.cookie, body: {} })
      assert.equal(r.status, 200)
      const envs = published(cmds).filter((e) => e.t === 'ops')
      const all = envs.flatMap((e) => e.ops)
      assert.equal(all.length, 2)
      const anon = envs.find((e) => e.ops.some((i) => i.id === 'an'))
      assertNoAuthor(JSON.stringify(anon), a, 'reset envelope')
      assert.ok(!JSON.stringify(anon).includes('"mine"'))
      assert.equal(all.find((i) => i.id === 'pn').authorUid, a.uid)
    })
    await fakeUpstash(async (cmds) => {
      const res = await kickRoute(new Request(`http://localhost:3100/api/boards/${code}/participants/${a.uid}?items=1`, { method: 'DELETE', headers: { cookie: ann.cookie, 'x-forwarded-for': '10.7.7.7' } }), { params: Promise.resolve({ code, id: a.uid }) })
      const r = { status: res.status, data: await res.json() }
      assert.equal(r.status, 200)
      assert.equal(r.data.itemsDeleted, 1, 'only the plain note goes; removing a person must not single out their anonymous notes')
      assertNoAuthor(JSON.stringify(r.data.changed.filter((i) => i.anon)), a, 'kick response')
      for (const env of published(cmds).filter((e) => e.t === 'ops')) assertNoAuthor(JSON.stringify(env.ops.filter((i) => i.anon)), a, 'kick envelope')
    })
    const snap = (await snapshot(code, ann.cookie)).data.items
    assert.equal(snap.find((i) => i.id === 'an')?.deleted, false)
    assert.ok(!snap.some((i) => i.id === 'pn' && !i.deleted))
  })

  test('CSV export (authors=1) says Anonymous, print model hides it, AI inputs hold no author data', async () => {
    const { code, a, b } = await setup()
    await addOps(code, a.cookie, anonNote('an', 'secret idea'), note('pn', 300, 200, 'plain idea'))
    await addOps(code, b.cookie, anonNote('bn', 'other secret', { x: 200 }))
    const res = await exportRoute(new Request(`http://localhost:3100/api/boards/${code}/export?format=csv&authors=1`, { headers: { cookie: ann.cookie, 'x-forwarded-for': '10.9.9.9' } }), { params: Promise.resolve({ code }) })
    assert.equal(res.status, 200)
    const csv = await res.text()
    const lines = csv.split('\r\n')
    assert.ok(lines.find((l) => l.includes('secret idea')).endsWith(',Anonymous'))
    assert.ok(lines.find((l) => l.includes('plain idea')).endsWith(a.name))
    for (const who of [b]) for (const s of [who.uid, who.name]) assert.ok(!csv.includes(s), `csv leaked ${s}`)
    const items = await getStore().listItems(code)
    const csv2 = boardCsv({ title: 'T', type: 'retro' }, items, [{ uid: a.uid, name: a.name }, { uid: b.uid, name: b.name }], { authors: true })
    assert.ok(!csv2.includes(b.name) && csv2.includes(a.name))
    const model = JSON.stringify(buildPrintModel({ title: 'T', type: 'retro' }, items, [{ uid: a.uid, name: a.name }, { uid: b.uid, name: b.name }], { authors: true, isOwner: true }))
    assert.ok(!model.includes(b.name) && !model.includes(b.uid) && model.includes(a.name))
    for (const raw of [JSON.stringify(buildSummaryInput(items, { kind: 'retro', boardTitle: 'T' })), JSON.stringify(buildThemeInput(items, { boardTitle: 'T' }))]) {
      for (const who of [a, b]) for (const s of [who.uid, who.name, 'authorUid', 'authorName', 'authorAvatar']) assert.ok(!raw.includes(s), `AI input holds ${s}`)
    }
  })
})

describe('anonymous notes: modes and immutability', () => {
  test('optional: anon only when asked; the flag cannot be toggled by the author afterwards', async () => {
    const { code, a } = await setup('optional')
    await addOps(code, a.cookie, anonNote('an'), note('pn', 300, 200, 'plain'))
    for (const id of ['an', 'pn']) for (const anon of [true, false, null]) {
      const r = await ops(code, a.cookie, { op: 'update', id, patch: { anon } })
      assert.equal(r.data.applied?.length ?? 0, 0)
      assert.match(r.data.rejected[0].error, /anon cannot be changed/)
    }
    const items = (await snapshot(code, a.cookie)).data.items
    assert.deepEqual(['an', 'pn'].map((id) => !!items.find((i) => i.id === id).anon), [true, false])
  })

  test('always forces anon for non-owners on retro boards; the owner follows their own choice', async () => {
    const { code, a } = await setup('always')
    await addOps(code, a.cookie, note('forced', 0, 200, 'x'))
    await addOps(code, ann.cookie, note('owned', 300, 200, 'y'), anonNote('ownedanon', 'z', { x: 600 }))
    const items = (await snapshot(code, ann.cookie)).data.items
    assert.equal(items.find((i) => i.id === 'forced').anon, true)
    assert.equal(items.find((i) => i.id === 'owned').anon, undefined)
    assert.equal(items.find((i) => i.id === 'ownedanon').anon, true)
    assert.equal((await snapshot(code, ann.cookie)).data.board.anonymousNotes, 'always')
    assert.ok(!JSON.stringify(items.find((i) => i.id === 'forced')).includes(a.uid))
  })

  test('never refuses anon: true; other board types behave as never', async () => {
    const { code, a } = await setup('never')
    const r = await ops(code, a.cookie, anonNote('an'))
    assert.equal(r.data.applied.length, 0)
    assert.match(r.data.rejected[0].error, /Anonymous notes are off/)
    const w = await makeBoard(ann, { type: 'workshop', template: 'blank', title: 'W' })
    const g = await person(w, 'Wanda Workshop')
    assert.match((await ops(w, g.cookie, anonNote('x'))).data.rejected[0].error, /Anonymous notes are off/)
    assert.equal((await snapshot(w, g.cookie)).data.board.anonymousNotes, 'never')
  })

  test('kinds: action, theme, frame, connector and shoutout reject anon', async () => {
    const { code, a } = await setup('optional')
    const bad = [
      { kind: 'action', data: { action: 'Fix CI' } },
      { kind: 'theme', data: { title: 'T', noteIds: [] } },
      { kind: 'frame', data: { title: 'F' } },
      { kind: 'connector', data: { from: 'a', to: 'b' } },
      { kind: 'shoutout', data: { toName: 'x', message: 'm', badge: 'Teamwork' } },
    ]
    for (const [n, b] of bad.entries()) {
      const r = await ops(code, a.cookie, { op: 'add', item: { id: `k${n}`, x: 0, y: 0, w: 200, h: 200, anon: true, ...b } })
      assert.equal(r.data.applied?.length ?? 0, 0, b.kind)
      assert.equal(r.data.rejected.length, 1, b.kind)
    }
  })
})

describe('anonymousNotes board setting', () => {
  test('owner only; invalid values 400; guests 401/403; prototype pollution inert', async () => {
    const { code, a } = await setup()
    for (const v of ['yes', true, 1, null, '', 'ALWAYS', ['always'], { x: 1 }]) assert.equal((await patch(code, { anonymousNotes: v }, ann.cookie)).status, 400, JSON.stringify(v))
    assert.ok([401, 403].includes((await patch(code, { anonymousNotes: 'always' }, a.cookie)).status))
    assert.ok([401, 403].includes((await patch(code, { anonymousNotes: 'always' }, undefined)).status))
    assert.ok([401, 403].includes((await patch(code, { anonymousNotes: 'always' }, bob.cookie)).status))
    assert.equal((await patch(code, { anonymousNotes: 'always' }, ann.cookie)).status, 200)
    assert.equal((await snapshot(code, a.cookie)).data.board.anonymousNotes, 'always')
    const bad = await call(board.PATCH, 'PATCH', `/api/boards/${code}`, { code, cookie: ann.cookie, raw: '{"patch":{"__proto__":{"anonymousNotes":"never"},"anonymousNotes":"optional"}}' })
    assert.ok([200, 400].includes(bad.status))
    assert.equal({}.anonymousNotes, undefined)
    const c = await makeBoard(ann, { type: 'workshop', template: 'blank', title: 'W' })
    assert.equal((await patch(c, { anonymousNotes: 'always' }, ann.cookie)).status, 400)
    assert.equal((await patch(c, { anonymousNotes: 'never' }, ann.cookie)).status, 200)
  })
})
